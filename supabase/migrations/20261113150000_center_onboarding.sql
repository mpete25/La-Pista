-- Onboarding a new center (tenant) without hand-written SQL.
--
-- These are platform operations, not center operations: only the service
-- role may call them (scripts/create-center.mjs, run by the platform
-- owner). No signed-in player or center admin can reach them.

create or replace function public.platform_create_center(p_slug text, p_name text, p_city text default null)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  clean_slug text := lower(trim(coalesce(p_slug, '')));
  new_id uuid;
begin
  -- The slug becomes a subdomain (<slug>.lapista.dk), so keep it DNS-safe.
  if clean_slug !~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$' then
    raise exception 'INVALID_SLUG: use a-z, 0-9 and dashes (max 40)';
  end if;
  if clean_slug in ('www', 'app', 'api', 'admin', 'mail') then
    raise exception 'RESERVED_SLUG';
  end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then
    raise exception 'NAME_REQUIRED';
  end if;

  insert into public.centers (slug, name, city)
  values (clean_slug, trim(p_name), nullif(trim(coalesce(p_city, '')), ''))
  returning id into new_id;
  return new_id;
end;
$$;

-- Makes an existing user (by e-mail) admin or player of their center.
create or replace function public.platform_set_role(p_email text, p_role text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  uid uuid;
begin
  if p_role not in ('player', 'center_admin') then
    raise exception 'INVALID_ROLE';
  end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then
    raise exception 'USER_NOT_FOUND';
  end if;
  update public.profiles set role = p_role where id = uid;
  if not found then
    raise exception 'PROFILE_NOT_FOUND';
  end if;
  return uid;
end;
$$;

revoke execute on function public.platform_create_center(text, text, text) from public, anon, authenticated;
grant execute on function public.platform_create_center(text, text, text) to service_role;
revoke execute on function public.platform_set_role(text, text) from public, anon, authenticated;
grant execute on function public.platform_set_role(text, text) to service_role;
