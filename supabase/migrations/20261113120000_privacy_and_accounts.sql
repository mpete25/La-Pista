-- Privacy (GDPR) and self-service accounts.
--
-- 1. Phone numbers are private. Until now every player could read every
--    other player's phone number through the API (the profiles SELECT policy
--    returns whole rows). Column privileges now hide `phone` and the new
--    consent columns; a player reads their own through my_private_profile(),
--    a center admin reads their players' through admin_player_contacts().
-- 2. SMS consent. Signup records an explicit opt-in, players can change it
--    in their profile, and queue_sms() only queues for players who opted in.
-- 3. Players can download their data (export_my_data) and delete their own
--    account (delete_my_account), which also removes the login itself.
--    admin_delete_player now removes the login too, closing the gap noted
--    in 20260706180000.

-- ============================================================
-- Consent columns
-- ============================================================

alter table public.profiles
  add column sms_consent boolean not null default false,
  add column sms_consent_at timestamptz,
  add column privacy_accepted_at timestamptz;

comment on column public.profiles.sms_consent is
  'Player opted in to SMS notifications. queue_sms() skips players without it.';
comment on column public.profiles.privacy_accepted_at is
  'When the player accepted the privacy policy at signup.';

-- ============================================================
-- Column-level read access on profiles
-- ============================================================
-- RLS still decides WHICH rows (own center only); column grants decide
-- WHICH columns. Everything a ranking list needs stays readable.

revoke select on table public.profiles from anon, authenticated;
grant select (id, center_id, role, full_name, points, wins, losses, joined_at)
  on table public.profiles to authenticated;

-- Self-service writes are unchanged (name/phone). Consent goes through
-- set_sms_consent() so the timestamp is always set server-side.

-- ============================================================
-- Signup: record consent from the signup form
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  target_center uuid;
  wants_sms boolean := coalesce((new.raw_user_meta_data ->> 'sms_consent')::boolean, false);
  accepted_privacy boolean := coalesce((new.raw_user_meta_data ->> 'privacy_accepted')::boolean, false);
begin
  select id into target_center
  from public.centers
  where slug = new.raw_user_meta_data ->> 'center_slug';

  if target_center is null then
    raise exception 'Unknown or missing center_slug in signup metadata';
  end if;

  insert into public.profiles (id, center_id, full_name, phone, sms_consent, sms_consent_at, privacy_accepted_at)
  values (
    new.id,
    target_center,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'Ny spiller'),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'phone', '')), ''),
    wants_sms,
    case when wants_sms then now() end,
    case when accepted_privacy then now() end
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ============================================================
-- SMS: only to players who opted in
-- ============================================================

create or replace function public.queue_sms(
  p_center_id uuid,
  p_player_id uuid,
  p_event_id uuid,
  p_kind text,
  p_body text
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  target_phone text;
begin
  select nullif(trim(coalesce(phone, '')), '') into target_phone
  from public.profiles
  where id = p_player_id and sms_consent;

  -- No number or no consent: nothing to send. The in-app state is still
  -- correct (the offer shows in the app), so this is not an error.
  if target_phone is null then
    return;
  end if;

  insert into public.sms_outbox (center_id, player_id, event_id, phone, body, kind)
  values (p_center_id, p_player_id, p_event_id, target_phone, p_body, p_kind);
end;
$$;

-- ============================================================
-- Reading private fields
-- ============================================================

create or replace function public.my_private_profile()
returns table (phone text, sms_consent boolean, sms_consent_at timestamptz, privacy_accepted_at timestamptz)
language sql stable security definer
set search_path = public
as $$
  select p.phone, p.sms_consent, p.sms_consent_at, p.privacy_accepted_at
  from public.profiles p
  where p.id = auth.uid();
$$;

create or replace function public.admin_player_contacts()
returns table (player_id uuid, phone text, sms_consent boolean)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.is_center_admin() then
    raise exception 'NOT_ADMIN';
  end if;
  return query
    select p.id, p.phone, p.sms_consent
    from public.profiles p
    where p.center_id = public.current_center_id();
end;
$$;

create or replace function public.set_sms_consent(p_consent boolean)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  update public.profiles
  set sms_consent = coalesce(p_consent, false),
      sms_consent_at = case when coalesce(p_consent, false) then now() end
  where id = auth.uid();
end;
$$;

-- ============================================================
-- Right of access: everything we hold about the caller
-- ============================================================

create or replace function public.export_my_data()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  return jsonb_build_object(
    'exported_at', now(),
    'account', (
      select jsonb_build_object('email', u.email, 'created_at', u.created_at)
      from auth.users u where u.id = uid),
    'profile', (
      select to_jsonb(p) - 'center_id'
             || jsonb_build_object('center', (select c.name from public.centers c where c.id = p.center_id))
      from public.profiles p where p.id = uid),
    'registrations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'event', e.title, 'starts_at', e.starts_at,
               'status', r.status, 'created_at', r.created_at)
             order by e.starts_at)
      from public.event_registrations r
      join public.events e on e.id = r.event_id
      where r.player_id = uid), '[]'::jsonb),
    'sets', coalesce((
      select jsonb_agg(jsonb_build_object(
               'event', e.title, 'court_no', s.court_no, 'set_no', s.set_no,
               'my_team', case when uid = any (s.team_a) then 'a' else 'b' end,
               'games_a', s.games_a, 'games_b', s.games_b, 'created_at', s.created_at)
             order by s.created_at)
      from public.sets s
      join public.events e on e.id = s.event_id
      where uid = any (s.team_a) or uid = any (s.team_b)), '[]'::jsonb),
    'point_history', coalesce((
      select jsonb_agg(jsonb_build_object(
               'delta', a.delta, 'points_after', a.points_after,
               'placement', a.placement, 'reason', a.reason, 'created_at', a.created_at)
             order by a.created_at)
      from public.point_adjustments a where a.player_id = uid), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
               'direction', case when m.sender_id = uid then 'sent' else 'received' end,
               'other_player', (select full_name from public.profiles o
                                where o.id = case when m.sender_id = uid then m.recipient_id else m.sender_id end),
               'body', m.body, 'created_at', m.created_at, 'read_at', m.read_at)
             order by m.created_at)
      from public.messages m
      where m.sender_id = uid or m.recipient_id = uid), '[]'::jsonb),
    'sms', coalesce((
      select jsonb_agg(jsonb_build_object(
               'phone', o.phone, 'body', o.body, 'status', o.status,
               'created_at', o.created_at, 'sent_at', o.sent_at)
             order by o.created_at)
      from public.sms_outbox o where o.player_id = uid), '[]'::jsonb)
  );
end;
$$;

-- ============================================================
-- Right to erasure
-- ============================================================

-- Shared by self-service and admin deletion. Removes the login; the
-- profile and everything hanging off it cascade from auth.users. The SMS
-- log only nulls player_id on delete, so its rows (which hold the phone
-- number) are removed explicitly. Sets keep their score rows: they are
-- other players' results too, and only hold an opaque id.
create or replace function public.erase_player(p_player_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  delete from public.sms_outbox where player_id = p_player_id;
  delete from auth.users where id = p_player_id;
  -- Belt and braces in case the profile outlived its login.
  delete from public.profiles where id = p_player_id;
end;
$$;

revoke execute on function public.erase_player(uuid) from public, anon, authenticated;

create or replace function public.delete_my_account()
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  me public.profiles%rowtype;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- Removing a player mid-match-day would break the court for three others.
  if exists (
    select 1 from public.court_assignments ca
    join public.events e on e.id = ca.event_id
    where ca.player_id = me.id and e.status = 'in_progress'
  ) then
    raise exception 'ACTIVE_MATCHDAY';
  end if;

  -- A center must never be left without an admin.
  if me.role = 'center_admin' and not exists (
    select 1 from public.profiles
    where center_id = me.center_id and role = 'center_admin' and id <> me.id
  ) then
    raise exception 'LAST_ADMIN';
  end if;

  perform public.erase_player(me.id);
end;
$$;

create or replace function public.admin_delete_player(p_player_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  target public.profiles%rowtype;
begin
  if not public.is_center_admin() then
    raise exception 'NOT_ADMIN';
  end if;
  if p_player_id = auth.uid() then
    raise exception 'CANNOT_DELETE_SELF';
  end if;
  select * into target from public.profiles where id = p_player_id;
  if target.id is null or target.center_id <> public.current_center_id() then
    raise exception 'PLAYER_NOT_FOUND';
  end if;

  perform public.erase_player(p_player_id);
end;
$$;

-- ============================================================
-- Grants: signed-in users only; each function checks the caller itself.
-- ============================================================

revoke execute on function public.my_private_profile() from public, anon, authenticated;
grant execute on function public.my_private_profile() to authenticated;
revoke execute on function public.admin_player_contacts() from public, anon, authenticated;
grant execute on function public.admin_player_contacts() to authenticated;
revoke execute on function public.set_sms_consent(boolean) from public, anon, authenticated;
grant execute on function public.set_sms_consent(boolean) to authenticated;
revoke execute on function public.export_my_data() from public, anon, authenticated;
grant execute on function public.export_my_data() to authenticated;
revoke execute on function public.delete_my_account() from public, anon, authenticated;
grant execute on function public.delete_my_account() to authenticated;
revoke execute on function public.admin_delete_player(uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_player(uuid) to authenticated;
