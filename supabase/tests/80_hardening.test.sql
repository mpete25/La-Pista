-- Pre-launch hardening: results cannot be forged or flooded, sign-ups can
-- be repeated, free-text fields are bounded, messages are rate limited.
\set ON_ERROR_STOP on
begin;

do $$
declare
  c uuid := test.make_center('hard-a', 'Hardening A');
  a uuid := test.make_player('hard-a', 'Anna Aa', 700);
  b uuid := test.make_player('hard-a', 'Bo Bb', 650);
  x uuid := test.make_player('hard-a', 'Xenia Xx', 600);
  y uuid := test.make_player('hard-a', 'Yrsa Yy', 550);
  ev uuid;
  denied boolean;
  n integer;
begin
  insert into public.events (center_id, title, starts_at, capacity)
  values (c, 'Hærdning', now() + interval '5 minutes', 4) returning id into ev;
  insert into public.event_registrations (center_id, event_id, player_id, status)
  values (c, ev, a, 'registered'), (c, ev, b, 'registered'), (c, ev, x, 'registered'), (c, ev, y, 'registered');

  perform test.act_as(a);
  perform set_config('role', 'authenticated', true);
  perform public.start_matchday(ev);
  perform set_config('role', 'postgres', true);
  perform test.check((select started_at is not null from public.events where id = ev),
    'starting a match day records when it started');

  -- Forged results: a player on the court cannot write sets directly.
  perform set_config('role', 'authenticated', true);
  denied := false;
  begin
    insert into public.sets (center_id, event_id, court_no, set_no, team_a, team_b, games_a, games_b)
    values (c, ev, 1, 99, array[a, a], array[b, gen_random_uuid()], 6, 0);
  exception when insufficient_privilege then denied := true;
  end;
  perform test.check(denied, 'a court player cannot insert a set directly');

  -- Flooding: the first set is fine, a second one seconds later is not.
  perform public.report_set(ev, 1, array[a, b], array[x, y], 6, 3);
  denied := false;
  begin
    perform public.report_set(ev, 1, array[a, x], array[b, y], 6, 0);
  exception when others then denied := sqlerrm like 'TOO_MANY_SETS%';
  end;
  perform test.check(denied, 'sets cannot be reported faster than they can be played');
  perform set_config('role', 'postgres', true);

  -- Half an hour in, catching up on several sets in a row is fine.
  update public.events set started_at = now() - interval '30 minutes' where id = ev;
  perform set_config('role', 'authenticated', true);
  perform public.report_set(ev, 1, array[a, x], array[b, y], 7, 5);
  perform public.report_set(ev, 1, array[a, y], array[b, x], 6, 4);
  select count(*) into n from public.sets where event_id = ev;
  perform test.check(n = 3, 'forgotten sets can be entered back to back later in the day');

  -- Once a court is settled, no more results.
  perform public.finish_court(ev, 1);
  denied := false;
  begin
    perform public.report_set(ev, 1, array[a, b], array[x, y], 6, 0);
  exception when others then denied := sqlerrm like 'EVENT_NOT_IN_PROGRESS%' or sqlerrm like 'ALREADY_FINISHED%';
  end;
  perform test.check(denied, 'a finished court accepts no more sets');
  perform set_config('role', 'postgres', true);
end
$$;

-- Cancelling and signing up again works, and goes to the back of the line.
do $$
declare
  c uuid := (select id from public.centers where slug = 'hard-a');
  a uuid := (select id from public.profiles where full_name = 'Anna Aa');
  b uuid := (select id from public.profiles where full_name = 'Bo Bb');
  x uuid := (select id from public.profiles where full_name = 'Xenia Xx');
  filler uuid;
  ev uuid;
  denied boolean;
  i integer;
begin
  insert into public.events (center_id, title, starts_at, capacity)
  values (c, 'Genindmeldt', now() + interval '5 days', 4) returning id into ev;
  for i in 1..4 loop
    filler := test.make_player('hard-a', 'Fyld ' || i);
    insert into public.event_registrations (center_id, event_id, player_id, status) values (c, ev, filler, 'registered');
  end loop;

  perform test.act_as(a); perform set_config('role', 'authenticated', true);
  perform test.check(public.join_event(ev) = 'waitlist', 'a full day puts the player on the waitlist');
  perform set_config('role', 'postgres', true);
  perform test.act_as(b); perform set_config('role', 'authenticated', true);
  perform public.join_event(ev);
  perform set_config('role', 'postgres', true);

  perform test.act_as(a); perform set_config('role', 'authenticated', true);
  perform public.leave_event(ev);
  perform test.check(public.join_event(ev) = 'waitlist', 'a player can sign up again after cancelling');
  perform set_config('role', 'postgres', true);

  perform test.check(
    (select player_id from public.event_registrations where event_id = ev and status = 'waitlist' order by seq limit 1) = b,
    're-joining goes to the back of the waitlist');

  -- No sign-ups once the day has started.
  update public.events set starts_at = now() - interval '1 minute' where id = ev;
  perform test.act_as(x); perform set_config('role', 'authenticated', true);
  denied := false;
  begin perform public.join_event(ev);
  exception when others then denied := sqlerrm like '%not open%';
  end;
  perform set_config('role', 'postgres', true);
  perform test.check(denied, 'nobody can sign up after the start time');
end
$$;

-- Names and phone numbers are bounded and shape-checked.
do $$
declare
  a uuid := (select id from public.profiles where full_name = 'Anna Aa');
  sloppy uuid := gen_random_uuid();
  denied boolean;
begin
  perform test.act_as(a); perform set_config('role', 'authenticated', true);
  denied := false;
  begin update public.profiles set full_name = repeat('x', 5000) where id = a;
  exception when check_violation then denied := true; end;
  perform test.check(denied, 'an over-long name is rejected');

  denied := false;
  begin update public.profiles set full_name = '<b>Anna</b>' where id = a;
  exception when check_violation then denied := true; end;
  perform test.check(denied, 'markup in a name is rejected');

  denied := false;
  begin update public.profiles set phone = 'ring til mig' where id = a;
  exception when check_violation then denied := true; end;
  perform test.check(denied, 'a phone number must look like one');

  update public.profiles set phone = '+45 20 12 34 56' where id = a;
  update public.profiles set phone = null where id = a;
  denied := false;
  begin perform public.set_sms_consent(true);
  exception when others then denied := sqlerrm like 'PHONE_REQUIRED%'; end;
  perform test.check(denied, 'SMS consent needs a phone number');
  perform set_config('role', 'postgres', true);

  -- A sloppy signup still succeeds; the junk is dropped.
  insert into auth.users (id, email, raw_user_meta_data)
  values (sloppy, 'sloppy@test.dk', jsonb_build_object(
    'center_slug', 'hard-a', 'full_name', '  <i>Sjusket Søren</i>  ', 'phone', 'har ingen', 'sms_consent', true));
  perform test.check(
    (select full_name = 'iSjusket Søren/i' and phone is null and not sms_consent from public.profiles where id = sloppy),
    'a signup with junk in optional fields is cleaned, not refused');
end
$$;

-- Messages are rate limited per sender.
do $$
declare
  c uuid := (select id from public.centers where slug = 'hard-a');
  a uuid := (select id from public.profiles where full_name = 'Anna Aa');
  b uuid := (select id from public.profiles where full_name = 'Bo Bb');
  denied boolean := false;
  i integer;
begin
  perform test.act_as(a); perform set_config('role', 'authenticated', true);
  begin
    for i in 1..25 loop
      insert into public.messages (center_id, sender_id, recipient_id, body) values (c, a, b, 'spam ' || i);
    end loop;
  exception when others then denied := sqlerrm like 'RATE_LIMITED%';
  end;
  perform set_config('role', 'postgres', true);
  perform test.check(denied, 'a sender cannot flood another player with messages');
end
$$;

-- SMS texts: Danish letters, plain GSM characters, and a working link.
do $$
declare
  c uuid := (select id from public.centers where slug = 'hard-a');
  a uuid := (select id from public.profiles where full_name = 'Anna Aa');
  ev uuid := (select id from public.events where title = 'Genindmeldt');
  body text;
begin
  body := public.sms_offer_body(ev, a);
  perform test.check(body like '%bekræft%' and body not like '%http%', 'without an app address the SMS carries no link');
  perform test.check(body !~ '[–—]', 'the SMS uses no characters outside the GSM alphabet');

  update public.centers set app_url = 'https://hard-a.lapista.dk' where id = c;
  body := public.sms_offer_body(ev, a);
  perform test.check(body like '%https://hard-a.lapista.dk?event=' || ev || '%', 'the SMS links to the event on the center''s own address');

  update public.centers set app_url = 'https://la-pista.vercel.app/?center=hard-a' where id = c;
  body := public.sms_offer_body(ev, a);
  perform test.check(body like '%?center=hard-a&event=' || ev || '%', 'an address that already has a query string is extended correctly');
end
$$;

rollback;
