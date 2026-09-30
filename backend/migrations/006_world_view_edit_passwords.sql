-- Split world view/edit passwords and make remembered access expire after password changes.

alter table public.worlds
  add column if not exists view_password_hash text,
  add column if not exists edit_password_hash text,
  add column if not exists view_password_updated_at timestamptz,
  add column if not exists edit_password_updated_at timestamptz;

alter table public.world_access
  add column if not exists view_unlocked_at timestamptz,
  add column if not exists edit_unlocked_at timestamptz;

update public.worlds
set
  view_password_hash = coalesce(view_password_hash, password_hash),
  edit_password_hash = coalesce(edit_password_hash, password_hash)
where password_hash is not null;

update public.world_access
set
  view_unlocked_at = coalesce(view_unlocked_at, unlocked_at),
  edit_unlocked_at = coalesce(edit_unlocked_at, unlocked_at)
where unlocked_at is not null;
