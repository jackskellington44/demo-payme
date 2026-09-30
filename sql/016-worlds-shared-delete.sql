-- 016-worlds-shared-delete.sql
-- Any signed-in user may delete any world (worlds already have RLS enabled,
-- so only a delete policy is added; existing select/insert/update rules are untouched).

drop policy if exists "worlds_delete_any_authenticated" on public.worlds;
create policy "worlds_delete_any_authenticated"
  on public.worlds for delete
  to authenticated
  using (true);

notify pgrst, 'reload schema';
