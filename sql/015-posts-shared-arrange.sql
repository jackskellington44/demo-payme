-- 015-posts-shared-arrange.sql
-- Any signed-in user may move (x/y) or delete any post.
-- Changing a post's content is still limited to its owner (or an admin).

alter table public.posts enable row level security;

drop policy if exists "posts_update_any_authenticated" on public.posts;
create policy "posts_update_any_authenticated"
  on public.posts for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "posts_delete_any_authenticated" on public.posts;
create policy "posts_delete_any_authenticated"
  on public.posts for delete
  to authenticated
  using (true);

-- Non-owners may only change position; everything else must stay the same.
create or replace function public.posts_guard_non_owner_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
     or new.user_id is not distinct from auth.uid()
     or old.user_id is not distinct from auth.uid()
     or exists (select 1 from public.users u where u.id = auth.uid() and u.is_admin) then
    return new;
  end if;

  if (to_jsonb(new) - 'x' - 'y') is distinct from (to_jsonb(old) - 'x' - 'y') then
    raise exception 'Only the post owner can edit this post (moving is allowed).';
  end if;

  return new;
end;
$$;

drop trigger if exists posts_guard_non_owner_update on public.posts;
create trigger posts_guard_non_owner_update
  before update on public.posts
  for each row execute function public.posts_guard_non_owner_update();

notify pgrst, 'reload schema';
