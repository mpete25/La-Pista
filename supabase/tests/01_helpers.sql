-- Helpers for the SQL test suite. Applied after the migrations, since they
-- lean on the real schema. Everything lives in a `test` schema so it can
-- never be mistaken for production code.

create schema if not exists test;

-- Creates a tenant and returns its id.
create or replace function test.make_center(p_slug text, p_name text default 'Test Center')
returns uuid
language sql
as $$
  insert into public.centers (slug, name, city)
  values (p_slug, p_name, 'Testby')
  on conflict (slug) do update set name = excluded.name
  returning id;
$$;

-- Creates an auth user, which fires the profile trigger, then applies the
-- optional point/role overrides that only the server may set.
create or replace function test.make_player(
  p_center_slug text,
  p_name text,
  p_points integer default null,
  p_role text default 'player',
  p_phone text default '+4512345678'
)
returns uuid
language plpgsql
as $$
declare
  uid uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (
    uid,
    replace(lower(p_name), ' ', '.') || '.' || left(uid::text, 8) || '@test.dk',
    jsonb_build_object('center_slug', p_center_slug, 'full_name', p_name, 'phone', p_phone)
  );

  update public.profiles
  set points = coalesce(p_points, points),
      role = p_role
  where id = uid;

  return uid;
end;
$$;

-- Stands in for the verified JWT subject. Session-scoped, like a logged-in
-- client: pair it with `set role authenticated` to exercise RLS.
create or replace function test.act_as(p_uid uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), false)::void;
$$;

-- Fails the test file with a readable message.
create or replace function test.check(p_condition boolean, p_what text)
returns void
language plpgsql
as $$
begin
  if p_condition is not true then
    raise exception 'ASSERTION FAILED: %', p_what;
  end if;
end;
$$;

grant usage on schema test to anon, authenticated, service_role;
grant execute on all functions in schema test to anon, authenticated, service_role;
