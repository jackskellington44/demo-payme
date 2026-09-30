-- Remove YouTube-backed rows that were added during migration/testing.
-- Safe to run multiple times.

begin;

-- Optional safety snapshot (table persists after commit):
-- create table if not exists music_tracks_youtube_backup as
-- select * from public.music_tracks where false;
--
-- insert into public.music_tracks_youtube_backup
-- select *
-- from public.music_tracks
-- where coalesce(youtube_url, '') <> ''
--    or lower(coalesce(soundcloud_url, '')) like '%youtube.com%'
--    or lower(coalesce(soundcloud_url, '')) like '%youtu.be%';

delete from public.music_tracks
where coalesce(youtube_url, '') <> ''
   or lower(coalesce(soundcloud_url, '')) like '%youtube.com%'
   or lower(coalesce(soundcloud_url, '')) like '%youtu.be%';

commit;

-- Optional schema rollback (run only if you want to remove YouTube schema support too):
-- begin;
-- drop index if exists public.idx_music_tracks_youtube_url;
-- alter table public.music_tracks drop column if exists youtube_url;
-- commit;
