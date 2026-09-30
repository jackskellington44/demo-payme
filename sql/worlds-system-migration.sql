-- Worlds system migration for demo0
-- Run in Supabase SQL editor.

begin;

create extension if not exists pgcrypto;

alter table public.worlds
  add column if not exists parent_world_id uuid references public.worlds(id) on delete set null,
  add column if not exists password_hash text,
  add column if not exists update_mode text default 'auto',
  add column if not exists last_updated_at timestamptz;

create index if not exists idx_worlds_parent_created
  on public.worlds (parent_world_id, created_at desc);

create table if not exists public.world_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  world_id uuid not null references public.worlds(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  unique (user_id, world_id)
);

create index if not exists idx_world_access_user_world
  on public.world_access (user_id, world_id);

create table if not exists public.updates (
  id uuid primary key default gen_random_uuid(),
  version text not null,
  description text,
  released_at timestamptz not null default now()
);

create or replace function public.verify_world_password(p_world_id uuid, p_password text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.worlds w
    where w.id = p_world_id
      and w.password_hash is not null
      and crypt(coalesce(p_password, ''), w.password_hash) = w.password_hash
  );
$$;

create or replace function public.grant_world_access(p_world_id uuid, p_password text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_allowed boolean;
begin
  if v_user_id is null then
    return false;
  end if;

  select public.verify_world_password(p_world_id, p_password)
    into v_allowed;

  if not coalesce(v_allowed, false) then
    return false;
  end if;

  insert into public.world_access (user_id, world_id, unlocked_at)
  values (v_user_id, p_world_id, now())
  on conflict (user_id, world_id)
  do update set unlocked_at = excluded.unlocked_at;

  return true;
end;
$$;

create or replace function public.set_world_password(p_world_id uuid, p_password text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    return false;
  end if;

  update public.worlds
  set password_hash = case
    when coalesce(trim(p_password), '') = '' then null
    else crypt(p_password, gen_salt('bf'))
  end
  where id = p_world_id
    and user_id = v_user_id;

  return found;
end;
$$;

commit;

-- Starter-world seed placeholders:
-- Insert the five demo starter worlds here once the source values are copied over
-- from the demo1, demo2, demo4, demo5, and demo7 site configs.
--
-- Example shape:
-- insert into public.worlds (
--   id, name, creator_id, parent_world_id, group_id, password_hash,
--   background_url, font_family, font_color, ui_color, is_public_view, is_public_edit,
--   update_mode, last_updated_at, created_at
-- ) values (...);
--
-- Then stamp posts:
-- update public.posts set world_id = '<starter-world-id>' where group_id = 'group1';
