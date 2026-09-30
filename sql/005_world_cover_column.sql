-- Adds optional dedicated cover URL for world cards.
-- Existing worlds continue to work because UI falls back to background_url.

begin;

alter table public.worlds
  add column if not exists cover_url text;

commit;
