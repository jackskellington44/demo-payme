-- YouTube music links for full-length playback.
alter table if exists public.music_tracks
  add column if not exists youtube_url text;

create index if not exists idx_music_tracks_group_world_created_youtube
  on public.music_tracks (group_id, world_id, created_at asc)
  where youtube_url is not null;
