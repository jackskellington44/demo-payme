-- Scope categories to the main world or a specific world.

begin;

alter table public.categories
  add column if not exists world_id uuid references public.worlds(id) on delete cascade;

create index if not exists categories_group_world_name_idx
  on public.categories (group_id, world_id, lower(name));

commit;
