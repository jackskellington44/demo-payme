-- ============================================================
-- 010-users-auto-music-enabled.sql
-- Adds a per-user preference for automatic playlist start.
-- ============================================================

alter table public.users
  add column if not exists auto_music_enabled boolean not null default true;

comment on column public.users.auto_music_enabled is
  'When false, world/main playlist changes do not auto-start playback.';
