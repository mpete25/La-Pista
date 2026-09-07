-- Minimal stand-in for the pieces of a hosted Supabase project that our
-- migrations depend on. Lets the schema, the RLS policies and the RPCs run
-- against a plain PostgreSQL 16 instance — in CI and on a laptop — without
-- pulling the full Supabase container stack.
--
-- Only the seams are faked: the API roles, auth.users, auth.uid() and the
-- realtime publication. Everything else is the real thing, so RLS is
-- exercised exactly as it is in production.

-- API roles. Supabase creates these; service_role bypasses RLS.
-- Roles are cluster-wide, so create them only if the cluster is reused.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;

-- Supabase's default posture: the API roles reach new objects in public,
-- and RLS (not grants) decides what they may read. Migration 3 deliberately
-- narrows the function half of this.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- auth schema: just enough for the profile trigger and auth.uid().
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- In production this reads the verified JWT. In tests the session GUC
-- stands in for it: select set_config('request.jwt.claim.sub', <uuid>, true).
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;

-- Realtime publication (messages are added to it by migration).
drop publication if exists supabase_realtime;
create publication supabase_realtime;
