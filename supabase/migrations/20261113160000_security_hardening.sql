-- Security hardening found in the pre-launch audit. Each item was first
-- reproduced against the test database (see 80_hardening.test.sql).
--
-- 1. Fake sets. The initial schema let any player on a court INSERT into
--    `sets` directly. That bypassed report_set() entirely: made-up teams,
--    players who are not on the court, any set number, even for a day that
--    is not running. Since points are computed from sets, that is a way to
--    manipulate the ranking. Sets are now written only by report_set().
-- 2. Set flooding. report_set() accepted any number of sets instantly, so
--    one player could report twenty 6-0 wins in a second. Sets are now
--    limited to what can physically have been played since the day started.
-- 3. Re-joining. A player who cancelled could never sign up for that day
--    again (unique-key error). join_event() now reuses the cancelled row.
-- 4. Free-text fields. Names and phone numbers accepted anything of any
--    length. They are now bounded and shape-checked.
-- 5. Message flooding. A simple per-sender rate limit.
-- 6. SMS texts: proper Danish letters (æøå are in the GSM alphabet; the
--    en dash was not, and silently made every SMS cost more), and the link
--    now points at the center's own address instead of a page that does
--    not exist.

-- ============================================================
-- 1. Sets are written by report_set() only
-- ============================================================
drop policy if exists "court players insert sets" on public.sets;
revoke insert, update on table public.sets from anon, authenticated;

-- ============================================================
-- 2. A day knows when it started; sets are limited by elapsed time
-- ============================================================
alter table public.events add column started_at timestamptz;

create or replace function public.stamp_event_started()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'in_progress' and new.started_at is null then
    new.started_at := now();
  end if;
  return new;
end;
$$;

create trigger events_stamp_started
  before insert or update of status on public.events
  for each row execute function public.stamp_event_started();

revoke execute on function public.stamp_event_started() from public, anon, authenticated;

-- Days already running when this migration lands.
update public.events set started_at = least(starts_at, now())
where status = 'in_progress' and started_at is null;

-- The fastest realistic set is a handful of minutes. Allowing one set per
-- five minutes since the day started (plus one) never blocks honest play —
-- including entering two sets back to back after forgetting one — but
-- stops a burst of invented results.
create or replace function public.report_set(
  p_event_id uuid,
  p_court_no integer,
  p_team_a uuid[],
  p_team_b uuid[],
  p_games_a integer,
  p_games_b integer
)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  ev public.events%rowtype;
  court_players uuid[];
  all_four uuid[];
  played integer;
  allowed integer;
  next_set integer;
begin
  select * into ev from public.events where id = p_event_id;
  if ev.id is null or ev.center_id is distinct from public.current_center_id() then
    raise exception 'EVENT_NOT_FOUND';
  end if;
  if ev.status <> 'in_progress' then
    raise exception 'EVENT_NOT_IN_PROGRESS';
  end if;

  select array_agg(player_id) into court_players
  from public.court_assignments
  where event_id = p_event_id and court_no = p_court_no;

  if court_players is null or not (auth.uid() = any (court_players)) then
    raise exception 'NOT_ON_COURT';
  end if;

  -- A court that has been settled is closed for new results.
  if exists (
    select 1 from public.point_adjustments
    where event_id = p_event_id and player_id = any (court_players)
  ) then
    raise exception 'ALREADY_FINISHED';
  end if;

  if array_length(p_team_a, 1) is distinct from 2 or array_length(p_team_b, 1) is distinct from 2 then
    raise exception 'INVALID_TEAMS';
  end if;
  all_four := p_team_a || p_team_b;
  if (select count(distinct x) from unnest(all_four) x) <> 4
     or exists (select 1 from unnest(all_four) x where not (x = any (court_players))) then
    raise exception 'INVALID_TEAMS';
  end if;

  -- Serialise reports for this court so the count below is exact.
  perform pg_advisory_xact_lock(hashtextextended(p_event_id::text || ':' || p_court_no::text, 0));

  select count(*), coalesce(max(set_no), 0) + 1 into played, next_set
  from public.sets
  where event_id = p_event_id and court_no = p_court_no;

  allowed := least(
    24,
    1 + floor(extract(epoch from (now() - coalesce(ev.started_at, ev.starts_at))) / 300)::integer
  );
  if played >= greatest(allowed, 1) then
    raise exception 'TOO_MANY_SETS';
  end if;

  insert into public.sets (center_id, event_id, court_no, set_no, team_a, team_b, games_a, games_b)
  values (ev.center_id, p_event_id, p_court_no, next_set, p_team_a, p_team_b, p_games_a, p_games_b);

  return next_set;
end;
$$;

revoke execute on function public.report_set(uuid, integer, uuid[], uuid[], integer, integer) from public, anon, authenticated;
grant execute on function public.report_set(uuid, integer, uuid[], uuid[], integer, integer) to authenticated;

-- ============================================================
-- 3. join_event: re-joining after a cancellation, and no late sign-ups
-- ============================================================
create or replace function public.join_event(p_event_id uuid)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  ev public.events%rowtype;
  taken integer;
  new_status text;
begin
  -- Lock the event so two simultaneous sign-ups cannot both take the last spot.
  select * into ev from public.events where id = p_event_id for update;

  if ev.id is null or ev.center_id is distinct from public.current_center_id() then
    raise exception 'Event not found';
  end if;
  if ev.status <> 'open' or ev.starts_at <= now() then
    raise exception 'Event is not open for registration';
  end if;
  if exists (
    select 1 from public.event_registrations
    where event_id = p_event_id and player_id = auth.uid()
      and status in ('registered', 'waitlist', 'offered')
  ) then
    raise exception 'Already registered';
  end if;

  select count(*) into taken
  from public.event_registrations
  where event_id = p_event_id and status in ('registered', 'offered');

  new_status := case when taken < ev.capacity then 'registered' else 'waitlist' end;

  -- A cancelled sign-up is reused. It goes to the back of the queue: seq
  -- takes a fresh value, so cancelling and re-joining never jumps the line.
  insert into public.event_registrations (center_id, event_id, player_id, status)
  values (ev.center_id, p_event_id, auth.uid(), new_status)
  on conflict (event_id, player_id) do update
    set status = excluded.status,
        offered_at = null,
        offer_expires_at = null,
        created_at = now(),
        seq = default;

  return new_status;
end;
$$;

revoke execute on function public.join_event(uuid) from public, anon, authenticated;
grant execute on function public.join_event(uuid) to authenticated;

-- ============================================================
-- 4. Bounded, shape-checked names and phone numbers
-- ============================================================
-- Rows that predate the rules are cleaned the same way a new signup is:
-- separators in a phone number become spaces, and a number that still is
-- not usable is dropped (an unusable number could never receive an SMS
-- anyway); names lose markup and are trimmed. Without this, the first
-- point update on such a row would fail the new constraints.
update public.profiles
set phone = nullif(btrim(regexp_replace(regexp_replace(phone, '[-().]', ' ', 'g'), '\s+', ' ', 'g')), '')
where phone is not null and phone !~ '^\+?[0-9][0-9 ]{6,18}$';

update public.profiles
set phone = null, sms_consent = false, sms_consent_at = null
where phone is not null and phone !~ '^\+?[0-9][0-9 ]{6,18}$';

update public.profiles
set full_name = left(btrim(regexp_replace(full_name, '[<>[:cntrl:]]', '', 'g')), 80)
where length(btrim(full_name)) not between 2 and 80 or full_name ~ '[<>[:cntrl:]]' or full_name <> btrim(full_name);

update public.profiles set full_name = 'Ny spiller' where length(btrim(full_name)) < 2;

alter table public.profiles
  add constraint profiles_full_name_shape
    check (length(btrim(full_name)) between 2 and 80 and full_name !~ '[<>[:cntrl:]]'),
  add constraint profiles_phone_shape
    check (phone is null or phone ~ '^\+?[0-9][0-9 ]{6,18}$');

-- A signup must not fail because of a sloppy optional field: an unusable
-- phone number is dropped (and with it the SMS opt-in), a name is trimmed.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  target_center uuid;
  clean_name text := left(btrim(regexp_replace(coalesce(new.raw_user_meta_data ->> 'full_name', ''), '[<>[:cntrl:]]', '', 'g')), 80);
  clean_phone text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'phone', '')), '');
  wants_sms boolean := coalesce((new.raw_user_meta_data ->> 'sms_consent')::boolean, false);
  accepted_privacy boolean := coalesce((new.raw_user_meta_data ->> 'privacy_accepted')::boolean, false);
begin
  select id into target_center
  from public.centers
  where slug = new.raw_user_meta_data ->> 'center_slug';

  if target_center is null then
    raise exception 'Unknown or missing center_slug in signup metadata';
  end if;

  if clean_phone is not null and clean_phone !~ '^\+?[0-9][0-9 ]{6,18}$' then
    clean_phone := null;
  end if;
  if clean_phone is null then
    wants_sms := false;
  end if;
  if length(clean_name) < 2 then
    clean_name := 'Ny spiller';
  end if;

  insert into public.profiles (id, center_id, full_name, phone, sms_consent, sms_consent_at, privacy_accepted_at)
  values (
    new.id, target_center, clean_name, clean_phone,
    wants_sms,
    case when wants_sms then now() end,
    case when accepted_privacy then now() end
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Consent without a number makes no sense; refuse it server-side too.
create or replace function public.set_sms_consent(p_consent boolean)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  wants boolean := coalesce(p_consent, false);
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if wants and not exists (
    select 1 from public.profiles where id = auth.uid() and phone is not null
  ) then
    raise exception 'PHONE_REQUIRED';
  end if;
  update public.profiles
  set sms_consent = wants,
      sms_consent_at = case when wants then now() end
  where id = auth.uid();
end;
$$;

-- ============================================================
-- 5. Message rate limit
-- ============================================================
create or replace function public.limit_message_rate()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if (select count(*) from public.messages
      where sender_id = new.sender_id and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'RATE_LIMITED';
  end if;
  return new;
end;
$$;

create trigger messages_rate_limit
  before insert on public.messages
  for each row execute function public.limit_message_rate();

revoke execute on function public.limit_message_rate() from public, anon, authenticated;

-- ============================================================
-- 6. SMS texts and the link back into the app
-- ============================================================
-- Where this center's app lives, e.g. https://padel-lounge.lapista.dk.
-- Used for links in SMS. Without it the SMS carries no link.
alter table public.centers add column app_url text
  check (app_url is null or app_url ~ '^https://[^[:space:]]+$');

create or replace function public.sms_offer_body(p_event_id uuid, p_player_id uuid)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  ev public.events%rowtype;
  first_name text;
  starts text;
  deadline text;
  base_url text;
  link text := '';
begin
  select * into ev from public.events where id = p_event_id;
  select split_part(full_name, ' ', 1) into first_name from public.profiles where id = p_player_id;
  select app_url into base_url from public.centers where id = ev.center_id;

  starts := to_char(ev.starts_at at time zone 'Europe/Copenhagen', 'DD.MM. "kl." HH24:MI');
  deadline := to_char(
    least(now() + public.offer_window(), ev.starts_at) at time zone 'Europe/Copenhagen',
    'DD.MM. "kl." HH24:MI');

  if base_url is not null then
    link := ': ' || base_url || case when position('?' in base_url) > 0 then '&' else '?' end || 'event=' || ev.id;
  end if;

  -- GSM-7 characters only (æøå are fine; dashes other than "-" are not),
  -- so the text is billed as a normal SMS.
  return format(
    'Hej %s! Der er blevet en plads ledig til %s %s. Pladsen er din indtil %s - bekræft i appen under Kampe%s',
    first_name, ev.title, starts, deadline, link);
end;
$$;

revoke execute on function public.sms_offer_body(uuid, uuid) from public, anon, authenticated;

create or replace function public.admin_cancel_event(p_event_id uuid)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  ev public.events%rowtype;
  reg record;
  notified integer := 0;
  starts text;
begin
  if not public.is_center_admin() then
    raise exception 'NOT_ADMIN';
  end if;
  select * into ev from public.events where id = p_event_id;
  if ev.id is null or ev.center_id is distinct from public.current_center_id() then
    raise exception 'EVENT_NOT_FOUND';
  end if;
  if ev.status = 'cancelled' then
    return 0;
  end if;

  starts := to_char(ev.starts_at at time zone 'Europe/Copenhagen', 'DD.MM. "kl." HH24:MI');

  for reg in
    select r.player_id, p.full_name
    from public.event_registrations r
    join public.profiles p on p.id = r.player_id
    where r.event_id = p_event_id and r.status in ('registered', 'waitlist', 'offered')
  loop
    perform public.queue_sms(
      ev.center_id, reg.player_id, ev.id, 'event_cancelled',
      format('Hej %s. %s %s er desværre aflyst. Vi ses næste gang!',
        split_part(reg.full_name, ' ', 1), ev.title, starts));
    notified := notified + 1;
  end loop;

  update public.events set status = 'cancelled' where id = p_event_id;
  update public.event_registrations
  set status = 'cancelled', offered_at = null, offer_expires_at = null
  where event_id = p_event_id and status in ('registered', 'waitlist', 'offered');

  return notified;
end;
$$;

revoke execute on function public.admin_cancel_event(uuid) from public, anon, authenticated;
grant execute on function public.admin_cancel_event(uuid) to authenticated;

-- The center's own address is public branding, like its name.
grant select (app_url) on table public.centers to anon;
