-- 014-supabase-catch-up.sql
-- Brings the Supabase database up to date with migrations 005-013 that were only
-- applied to the self-hosted Postgres, and recreates the world-password RPCs with
-- the signatures the frontend calls. Safe to re-run.

create extension if not exists pgcrypto with schema extensions;

-- 005 / 009 / 012: worlds
alter table public.worlds
  add column if not exists cover_url text,
  add column if not exists background_color text,
  add column if not exists view_password_hash text,
  add column if not exists edit_password_hash text,
  add column if not exists view_password_updated_at timestamptz,
  add column if not exists edit_password_updated_at timestamptz;

update public.worlds
set view_password_hash = coalesce(view_password_hash, password_hash),
    edit_password_hash = coalesce(edit_password_hash, password_hash)
where password_hash is not null;

-- 012: world_access
alter table public.world_access
  add column if not exists view_unlocked_at timestamptz,
  add column if not exists edit_unlocked_at timestamptz;

update public.world_access
set view_unlocked_at = coalesce(view_unlocked_at, unlocked_at),
    edit_unlocked_at = coalesce(edit_unlocked_at, unlocked_at)
where unlocked_at is not null;

-- 006 / 011: music_tracks
alter table public.music_tracks
  add column if not exists world_id uuid references public.worlds(id) on delete cascade,
  add column if not exists playlist_order integer;

with ranked as (
  select id,
         row_number() over (partition by group_id, world_id order by created_at asc, id asc) - 1 as next_order
  from public.music_tracks
)
update public.music_tracks mt
set playlist_order = ranked.next_order
from ranked
where mt.id = ranked.id and mt.playlist_order is null;

create index if not exists idx_music_tracks_group_world_playlist_order
  on public.music_tracks (group_id, world_id, playlist_order asc, created_at asc);

-- 010: users
alter table public.users
  add column if not exists auto_music_enabled boolean not null default true;

-- 013: categories
alter table public.categories
  add column if not exists world_id uuid references public.worlds(id) on delete cascade;

create index if not exists categories_group_world_name_idx
  on public.categories (group_id, world_id, lower(name));

-- World password RPCs: drop every existing overload, then recreate.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('verify_world_password', 'grant_world_access', 'set_world_password')
  loop
    execute format('drop function %s', r.sig);
  end loop;
end $$;

create function public.verify_world_password(p_world_id uuid, p_password text, p_mode text default 'view')
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  select case when lower(coalesce(p_mode, 'view')) = 'edit'
              then coalesce(edit_password_hash, password_hash)
              else coalesce(view_password_hash, password_hash) end
    into v_hash
  from public.worlds
  where id = p_world_id;

  if v_hash is null then
    return false;
  end if;

  return crypt(coalesce(p_password, ''), v_hash) = v_hash;
end;
$$;

create function public.grant_world_access(p_world_id uuid, p_password text, p_mode text default 'view')
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_edit boolean := lower(coalesce(p_mode, 'view')) = 'edit';
begin
  if auth.uid() is null then
    return false;
  end if;

  if not public.verify_world_password(p_world_id, p_password, p_mode) then
    return false;
  end if;

  insert into public.world_access (user_id, world_id, unlocked_at, view_unlocked_at, edit_unlocked_at)
  values (
    auth.uid(), p_world_id, now(),
    case when v_edit then null else now() end,
    case when v_edit then now() else null end
  )
  on conflict (user_id, world_id) do update
  set unlocked_at = now(),
      view_unlocked_at = case when v_edit then public.world_access.view_unlocked_at else now() end,
      edit_unlocked_at = case when v_edit then now() else public.world_access.edit_unlocked_at end;

  return true;
end;
$$;

create function public.set_world_password(
  p_world_id uuid,
  p_view_password text default '',
  p_edit_password text default '',
  p_view_public boolean default true,
  p_edit_public boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_view text := trim(coalesce(p_view_password, ''));
  v_edit text := trim(coalesce(p_edit_password, ''));
begin
  if auth.uid() is null then
    return false;
  end if;

  update public.worlds
  set
    view_password_hash = case
      when p_view_public then null
      when v_view <> '' then crypt(v_view, gen_salt('bf'))
      else view_password_hash end,
    view_password_updated_at = case
      when p_view_public or v_view <> '' then now()
      else view_password_updated_at end,
    edit_password_hash = case
      when p_edit_public then null
      when v_edit <> '' then crypt(v_edit, gen_salt('bf'))
      else edit_password_hash end,
    edit_password_updated_at = case
      when p_edit_public or v_edit <> '' then now()
      else edit_password_updated_at end,
    -- legacy column is superseded by the split hashes
    password_hash = null
  where id = p_world_id
    and user_id = auth.uid();

  return found;
end;
$$;

grant execute on function public.verify_world_password(uuid, text, text) to anon, authenticated;
grant execute on function public.grant_world_access(uuid, text, text) to authenticated;
grant execute on function public.set_world_password(uuid, text, text, boolean, boolean) to authenticated;

notify pgrst, 'reload schema';
