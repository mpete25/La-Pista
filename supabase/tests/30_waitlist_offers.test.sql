-- The waitlist has to be fair and it has to be safe: a freed spot goes to
-- the player who has waited longest, one spot is never offered to two
-- players at once, and an unanswered offer moves on instead of parking
-- the spot until the match day starts.
\set ON_ERROR_STOP on
begin;

-- A cancellation more than 24h out offers the spot to the first in line.
do $$
declare
  c uuid := test.make_center('wl-a', 'Waitlist A');
  ev uuid;
  holder uuid := test.make_player('wl-a', 'Holder Hans');
  first_wait uuid := test.make_player('wl-a', 'Foerste Frida');
  second_wait uuid := test.make_player('wl-a', 'Anden Anders');
  filler uuid;
  i integer;
begin
  insert into public.events (center_id, title, starts_at, capacity)
  values (c, 'Ventelistedag', now() + interval '5 days', 4) returning id into ev;

  perform test.act_as(holder);
  perform public.join_event(ev);
  for i in 1 .. 3 loop
    filler := test.make_player('wl-a', 'Fylder ' || i);
    perform test.act_as(filler);
    perform public.join_event(ev);
  end loop;

  -- Two more join a full event and queue up in order.
  perform test.act_as(first_wait);
  perform test.check(public.join_event(ev) = 'waitlist', 'the fifth player is waitlisted');
  perform test.act_as(second_wait);
  perform test.check(public.join_event(ev) = 'waitlist', 'the sixth player is waitlisted');

  -- The holder drops out well ahead of the day.
  perform test.act_as(holder);
  perform public.leave_event(ev);

  perform test.check(
    (select status from public.event_registrations where event_id = ev and player_id = first_wait) = 'offered',
    'the freed spot is offered to the player who waited longest');
  perform test.check(
    (select status from public.event_registrations where event_id = ev and player_id = second_wait) = 'waitlist',
    'the next player keeps waiting — one spot is offered once');
  perform test.check(
    (select count(*) from public.sms_outbox
     where event_id = ev and player_id = first_wait and kind = 'waitlist_offer' and status = 'pending') = 1,
    'an SMS offer is queued for the promoted player');
  perform test.check(
    (select offer_expires_at from public.event_registrations
     where event_id = ev and player_id = first_wait) is not null,
    'the offer carries a deadline');

  -- An offered spot still counts as taken, so nobody else can grab it.
  filler := test.make_player('wl-a', 'Sent Ankommet');
  perform test.act_as(filler);
  perform test.check(public.join_event(ev) = 'waitlist',
    'an offered spot is not free for someone else to take');
end
$$;

-- Accepting turns the offer into a confirmed spot.
do $$
declare
  ev uuid := (select id from public.events where title = 'Ventelistedag');
  first_wait uuid := (select id from public.profiles where full_name = 'Foerste Frida');
begin
  perform test.act_as(first_wait);
  perform public.accept_offer(ev);
  perform test.check(
    (select status from public.event_registrations where event_id = ev and player_id = first_wait) = 'registered',
    'accepting an offer confirms the spot');
  perform test.check(
    (select count(*) from public.event_registrations where event_id = ev and status = 'registered') = 4,
    'the event is full again');
end
$$;

-- Declining passes the spot straight to the next player.
do $$
declare
  c uuid := test.make_center('wl-b', 'Waitlist B');
  ev uuid;
  holder uuid := test.make_player('wl-b', 'Holder To');
  a uuid := test.make_player('wl-b', 'Vente A');
  b uuid := test.make_player('wl-b', 'Vente B');
  filler uuid;
  i integer;
begin
  insert into public.events (center_id, title, starts_at, capacity)
  values (c, 'Afslagsdag', now() + interval '5 days', 4) returning id into ev;

  perform test.act_as(holder);
  perform public.join_event(ev);
  for i in 1 .. 3 loop
    filler := test.make_player('wl-b', 'Fylder B' || i);
    perform test.act_as(filler);
    perform public.join_event(ev);
  end loop;
  perform test.act_as(a); perform public.join_event(ev);
  perform test.act_as(b); perform public.join_event(ev);

  perform test.act_as(holder);
  perform public.leave_event(ev);

  perform test.act_as(a);
  perform public.decline_offer(ev);

  perform test.check(
    (select status from public.event_registrations where event_id = ev and player_id = a) = 'cancelled',
    'declining releases the spot');
  perform test.check(
    (select status from public.event_registrations where event_id = ev and player_id = b) = 'offered',
    'the spot moves on to the next player in line');
  perform test.check(
    (select count(*) from public.sms_outbox where event_id = ev and kind = 'waitlist_offer') = 2,
    'each offer sends exactly one SMS');
end
$$;

-- An expired offer must not hold the spot hostage.
do $$
declare
  c uuid := test.make_center('wl-c', 'Waitlist C');
  ev uuid;
  holder uuid := test.make_player('wl-c', 'Holder Tre');
  slow uuid := test.make_player('wl-c', 'Langsom Lars');
  next_up uuid := test.make_player('wl-c', 'Klar Karla');
  filler uuid;
  i integer;
  expired integer;
begin
  insert into public.events (center_id, title, starts_at, capacity)
  values (c, 'Udloebsdag', now() + interval '5 days', 4) returning id into ev;

  perform test.act_as(holder);
  perform public.join_event(ev);
  for i in 1 .. 3 loop
    filler := test.make_player('wl-c', 'Fylder C' || i);
    perform test.act_as(filler);
    perform public.join_event(ev);
  end loop;
  perform test.act_as(slow); perform public.join_event(ev);
  perform test.act_as(next_up); perform public.join_event(ev);

  perform test.act_as(holder);
  perform public.leave_event(ev);

  -- Wind the deadline back instead of waiting six hours.
  update public.event_registrations
  set offer_expires_at = now() - interval '1 minute'
  where event_id = ev and player_id = slow;

  -- The stale offer can no longer be accepted.
  perform test.act_as(slow);
  begin
    perform public.accept_offer(ev);
    perform test.check(false, 'an expired offer must not be acceptable');
  exception when others then
    perform test.check(sqlerrm = 'OFFER_EXPIRED', 'accepting an expired offer is rejected');
  end;

  expired := public.expire_offers();
  perform test.check(expired = 1, 'the expiry job processed the stale offer');
  perform test.check(
    (select status from public.event_registrations where event_id = ev and player_id = slow) = 'cancelled',
    'the stale offer is released');
  perform test.check(
    (select status from public.event_registrations where event_id = ev and player_id = next_up) = 'offered',
    'the spot is offered to the next player');
end
$$;

-- Admin actions keep the waitlist moving too.
do $$
declare
  c uuid := test.make_center('wl-d', 'Waitlist D');
  ev uuid;
  admin_id uuid := test.make_player('wl-d', 'Admin Dorte', 500, 'center_admin');
  inside uuid := test.make_player('wl-d', 'Inde Ida');
  waiting uuid := test.make_player('wl-d', 'Vente Villy');
  waiting2 uuid := test.make_player('wl-d', 'Vente Wanda');
  filler uuid;
  i integer;
  notified integer;
begin
  -- Starts in 6 hours: inside the 24h window, so only an admin can free it.
  insert into public.events (center_id, title, starts_at, capacity)
  values (c, 'Admin-dag', now() + interval '6 hours', 4) returning id into ev;

  perform test.act_as(inside);
  perform public.join_event(ev);
  for i in 1 .. 3 loop
    filler := test.make_player('wl-d', 'Fylder D' || i);
    perform test.act_as(filler);
    perform public.join_event(ev);
  end loop;
  perform test.act_as(waiting); perform public.join_event(ev);
  perform test.act_as(waiting2); perform public.join_event(ev);

  -- The player rings the center; the admin removes them.
  perform test.act_as(admin_id);
  perform public.admin_remove_registration(ev, inside);

  perform test.check(
    (select status from public.event_registrations where event_id = ev and player_id = inside) = 'cancelled',
    'an admin can free a spot inside the 24h window');
  perform test.check(
    (select status from public.event_registrations where event_id = ev and player_id = waiting) = 'offered',
    'the freed spot is offered on');

  -- Raising the capacity pulls the next player in as well.
  perform public.admin_set_capacity(ev, 8);
  perform test.check(
    (select status from public.event_registrations where event_id = ev and player_id = waiting2) = 'offered',
    'raising the capacity promotes from the waitlist');

  -- Cancelling the day notifies everyone still holding or waiting.
  notified := public.admin_cancel_event(ev);
  perform test.check(notified = 5, format('everyone still involved is notified (got %s)', notified));
  perform test.check(
    (select status from public.events where id = ev) = 'cancelled',
    'the event is cancelled');
  perform test.check(
    (select count(*) from public.event_registrations where event_id = ev and status <> 'cancelled') = 0,
    'no registration survives a cancelled day');
  perform test.check(
    (select count(*) from public.sms_outbox where event_id = ev and kind = 'event_cancelled') = 5,
    'a cancellation SMS is queued per affected player');
end
$$;

-- A player without a phone number still gets the in-app state; there is
-- simply nothing to send.
do $$
declare
  c uuid := test.make_center('wl-e', 'Waitlist E');
  ev uuid;
  holder uuid := test.make_player('wl-e', 'Holder Fem');
  no_phone uuid := test.make_player('wl-e', 'Uden Telefon', 500, 'player', null);
  filler uuid;
  i integer;
begin
  insert into public.events (center_id, title, starts_at, capacity)
  values (c, 'Uden-telefon-dag', now() + interval '5 days', 4) returning id into ev;

  perform test.act_as(holder);
  perform public.join_event(ev);
  for i in 1 .. 3 loop
    filler := test.make_player('wl-e', 'Fylder E' || i);
    perform test.act_as(filler);
    perform public.join_event(ev);
  end loop;
  perform test.act_as(no_phone); perform public.join_event(ev);

  perform test.act_as(holder);
  perform public.leave_event(ev);

  perform test.check(
    (select status from public.event_registrations where event_id = ev and player_id = no_phone) = 'offered',
    'a player without a phone is still promoted');
  perform test.check(
    (select count(*) from public.sms_outbox where event_id = ev) = 0,
    'no SMS row is queued when there is no number to send to');
end
$$;

-- Players cannot reach the internal machinery.
do $$
declare
  ev uuid := (select id from public.events where title = 'Ventelistedag');
  someone uuid := (select id from public.profiles where full_name = 'Anden Anders');
  denied boolean;
begin
  perform test.act_as(someone);
  perform set_config('role', 'authenticated', true);

  denied := false;
  begin
    perform public.promote_waitlist(ev);
  exception when insufficient_privilege then denied := true;
  end;
  perform test.check(denied, 'a player cannot trigger waitlist promotion directly');

  denied := false;
  begin
    perform public.expire_offers();
  exception when insufficient_privilege then denied := true;
  end;
  perform test.check(denied, 'a player cannot run the expiry job');

  denied := false;
  begin
    insert into public.sms_outbox (center_id, phone, body, kind)
    values ((select center_id from public.profiles where id = someone), '+4512345678', 'hej', 'waitlist_offer');
  exception when insufficient_privilege then denied := true;
  end;
  perform test.check(denied, 'a player cannot queue an SMS');

  perform set_config('role', 'postgres', true);
end
$$;

rollback;
