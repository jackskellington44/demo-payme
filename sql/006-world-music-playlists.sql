-- 006-world-music-playlists.sql
-- Run this on your Postgres DB to scope music playlists by world.

alter table if exists public.music_tracks
  add column if not exists world_id uuid references public.worlds(id) on delete cascade;

create index if not exists idx_music_tracks_group_world_created_at
  on public.music_tracks (group_id, world_id, created_at asc);

create index if not exists idx_music_tracks_world_created_at
  on public.music_tracks (world_id, created_at asc);
