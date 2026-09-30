-- Hot-path indexes for self-hosted production performance.
-- Safe to re-run; each index is guarded and created with IF NOT EXISTS.

do $$
begin
  if to_regclass('public.posts') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'posts' and column_name = 'deleted_at')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'posts' and column_name = 'group_id')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'posts' and column_name = 'created_at') then
    execute 'create index if not exists idx_posts_not_deleted_group_created_at
      on public.posts (group_id, created_at desc)
      where deleted_at is null';
  end if;

  if to_regclass('public.posts') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'posts' and column_name = 'deleted_at')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'posts' and column_name = 'group_id')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'posts' and column_name = 'world_id')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'posts' and column_name = 'created_at') then
    execute 'create index if not exists idx_posts_not_deleted_group_world_created_at
      on public.posts (group_id, world_id, created_at desc)
      where deleted_at is null';
  end if;

  if to_regclass('public.posts') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'posts' and column_name = 'deleted_at')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'posts' and column_name = 'group_id')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'posts' and column_name = 'user_id')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'posts' and column_name = 'created_at') then
    execute 'create index if not exists idx_posts_not_deleted_group_user_created_at
      on public.posts (group_id, user_id, created_at desc)
      where deleted_at is null';
  end if;

  if to_regclass('public.posts') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'posts' and column_name = 'deleted_at')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'posts' and column_name = 'group_id')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'posts' and column_name = 'category')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'posts' and column_name = 'created_at') then
    execute 'create index if not exists idx_posts_not_deleted_group_category_created_at
      on public.posts (group_id, category, created_at desc)
      where deleted_at is null';
  end if;
end $$;

do $$
begin
  if to_regclass('public.comments') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'comments' and column_name = 'post_id')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'comments' and column_name = 'created_at') then
    execute 'create index if not exists idx_comments_post_created_at
      on public.comments (post_id, created_at asc)';
  end if;

  if to_regclass('public.notifications') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name = 'recipient_user_id')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name = 'group_id')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name = 'created_at') then
    execute 'create index if not exists idx_notifications_recipient_group_created_at
      on public.notifications (recipient_user_id, group_id, created_at desc)';
  end if;

  if to_regclass('public.notifications') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name = 'group_id')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name = 'type')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name = 'post_id')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name = 'actor_user_id')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name = 'recipient_user_id') then
    execute 'create index if not exists idx_notifications_thread_lookup
      on public.notifications (group_id, type, post_id, actor_user_id, recipient_user_id)';
  end if;

  if to_regclass('public.post_links') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'post_links' and column_name = 'group_id')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'post_links' and column_name = 'a_post_id') then
    execute 'create index if not exists idx_post_links_group_a_post
      on public.post_links (group_id, a_post_id)';
  end if;

  if to_regclass('public.post_links') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'post_links' and column_name = 'group_id')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'post_links' and column_name = 'b_post_id') then
    execute 'create index if not exists idx_post_links_group_b_post
      on public.post_links (group_id, b_post_id)';
  end if;

  if to_regclass('public.world_access') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'world_access' and column_name = 'world_id')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'world_access' and column_name = 'user_id') then
    execute 'create index if not exists idx_world_access_world_user
      on public.world_access (world_id, user_id)';
  end if;

  if to_regclass('public.users') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'username') then
    execute 'create index if not exists idx_users_username_lookup
      on public.users (username)';
  end if;
end $$;
