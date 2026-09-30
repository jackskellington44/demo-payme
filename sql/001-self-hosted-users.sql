-- ============================================================
-- 001-self-hosted-users.sql
-- Creates the users table for self-hosted auth (no Supabase
-- auth dependency) and re-points world_access FK to it.
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists public.users (
  id            uuid        primary key default gen_random_uuid(),
  username      text        not null unique,
  password_hash text        not null,
  pfp           text,
  pfp_url       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_users_username on public.users (username);

-- Drop old FK if it exists, re-add pointing to public.users
alter table public.world_access
  drop constraint if exists world_access_user_id_fkey;

alter table public.world_access
  add constraint world_access_user_id_fkey
  foreign key (user_id) references public.users(id) on delete cascade;
