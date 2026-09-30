-- Worlds/post performance index + query-audit script for Supabase (Postgres)
-- Run in Supabase SQL editor.

begin;

-- POSTS: main feed and world feed
create index if not exists idx_posts_group_world_created
  on public.posts (group_id, world_id, created_at desc);

-- POSTS: fast world-only filtering + sort
create index if not exists idx_posts_world_created
  on public.posts (world_id, created_at desc)
  where world_id is not null;

-- POSTS: common filters in main feed
create index if not exists idx_posts_group_user_created
  on public.posts (group_id, user_id, created_at desc);

create index if not exists idx_posts_group_category_created
  on public.posts (group_id, category, created_at desc);

-- WORLDS: listing and user/category filters
create index if not exists idx_worlds_created
  on public.worlds (created_at desc);

create index if not exists idx_worlds_user_created
  on public.worlds (user_id, created_at desc);

create index if not exists idx_worlds_category_created
  on public.worlds (category, created_at desc);

-- LINKS: group filter + endpoint lookups
create index if not exists idx_post_links_group_a
  on public.post_links (group_id, a_post_id);

create index if not exists idx_post_links_group_b
  on public.post_links (group_id, b_post_id);

-- CATEGORIES: performance index (non-unique, safe even with duplicate data)
create index if not exists idx_categories_group_name
  on public.categories (group_id, name);

-- COMMENTS + NOTIFICATIONS: modal + activity streams
create index if not exists idx_comments_post_created
  on public.comments (post_id, created_at asc);

create index if not exists idx_notifications_recipient_created
  on public.notifications (recipient_user_id, created_at desc);

commit;

-- =============================================
-- QUERY AUDIT (run after indexes are created)
-- =============================================
-- This section uses sample values selected from your own tables,
-- so it does not require :placeholders or hardcoded UUID literals.

explain (analyze, buffers)
select *
from public.posts
where group_id = 'group0'
  and world_id is null
order by created_at desc;

explain (analyze, buffers)
select *
from public.posts
where group_id = 'group0'
  and world_id = (
    select p.world_id
    from public.posts p
    where p.group_id = 'group0'
      and p.world_id is not null
    order by p.created_at desc
    limit 1
  )
order by created_at desc;

explain (analyze, buffers)
select id, user_id, name, description, category, background_url, custom_code_url,
       font_family, font_color, ui_color, is_public_view, is_public_edit, created_at
from public.worlds
where user_id = (
  select w.user_id
  from public.worlds w
  where w.user_id is not null
  order by w.created_at desc
  limit 1
)
order by created_at desc;

explain (analyze, buffers)
select id, user_id, name, description, category, background_url, custom_code_url,
       font_family, font_color, ui_color, is_public_view, is_public_edit, created_at
from public.worlds
where category = (
  select w.category
  from public.worlds w
  where coalesce(trim(w.category), '') <> ''
  order by w.created_at desc
  limit 1
)
order by created_at desc;

-- OR-style link lookup (real app shape)
explain (analyze, buffers)
select id, a_post_id, b_post_id
from public.post_links
where group_id = 'group0'
  and (
    a_post_id in (
      select p.id
      from public.posts p
      where p.group_id = 'group0'
      order by p.created_at desc
      limit 2
    )
    or b_post_id in (
      select p.id
      from public.posts p
      where p.group_id = 'group0'
      order by p.created_at desc
      limit 2
    )
  );

-- Optional alternative for comparison: two targeted probes + union
explain (analyze, buffers)
with sample_posts as (
  select p.id
  from public.posts p
  where p.group_id = 'group0'
  order by p.created_at desc
  limit 2
)
select id, a_post_id, b_post_id
from public.post_links
where group_id = 'group0'
  and a_post_id in (select id from sample_posts)
union
select id, a_post_id, b_post_id
from public.post_links
where group_id = 'group0'
  and b_post_id in (select id from sample_posts);

-- =============================================
-- OPTIONAL STRICT UNIQUENESS FOR categories
-- =============================================
-- Keep this optional if you have duplicates or FK dependencies.
-- 1) Inspect duplicates first:
-- select group_id, name, count(*) as duplicates
-- from public.categories
-- group by group_id, name
-- having count(*) > 1
-- order by duplicates desc, group_id, name;
--
-- 2) If needed, inspect foreign keys referencing categories before cleanup:
-- select conname, conrelid::regclass as referencing_table
-- from pg_constraint
-- where contype = 'f'
--   and confrelid = 'public.categories'::regclass;
--
-- 3) Only after data cleanup, enforce uniqueness:
-- create unique index if not exists idx_categories_group_name_unique
--   on public.categories (group_id, name);

analyze public.posts;
analyze public.worlds;
analyze public.post_links;
analyze public.categories;
analyze public.comments;
analyze public.notifications;
