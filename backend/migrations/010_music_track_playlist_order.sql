alter table if exists public.music_tracks
  add column if not exists playlist_order integer;

with ranked as (
  select
    id,
    row_number() over (
      partition by group_id, world_id
      order by created_at asc, id asc
    ) - 1 as next_playlist_order
  from public.music_tracks
)
update public.music_tracks mt
set playlist_order = ranked.next_playlist_order
from ranked
where mt.id = ranked.id
  and mt.playlist_order is null;

create index if not exists idx_music_tracks_group_world_playlist_order
  on public.music_tracks (group_id, world_id, playlist_order asc, created_at asc);
