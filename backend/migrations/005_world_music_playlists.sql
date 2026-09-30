-- World-scoped music playlists.
-- Adds world_id to music_tracks so each world has an isolated playlist.

alter table if exists public.music_tracks
  add column if not exists world_id uuid references public.worlds(id) on delete cascade;

create index if not exists idx_music_tracks_group_world_created_at
  on public.music_tracks (group_id, world_id, created_at asc);

create index if not exists idx_music_tracks_world_created_at
  on public.music_tracks (world_id, created_at asc);
