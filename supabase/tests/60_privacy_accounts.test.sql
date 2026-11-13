-- Privacy: phone numbers are private, SMS needs consent, players can export
-- and delete their own data.
\set ON_ERROR_STOP on
begin;

-- Phone numbers and consent are readable only by their owner and admins.
do $$
declare
  c uuid := test.make_center('priv-a', 'Privacy A');
  other_c uuid := test.make_center('priv-b', 'Privacy B');
  alice uuid := test.make_player('priv-a', 'Alice Privat', p_phone => '+4511111111');
  bob uuid := test.make_player('priv-a', 'Bob Privat', p_phone => '+4522222222');
  admin_a uuid := test.make_player('priv-a', 'Admin Privat', p_role => 'center_admin');
  outsider uuid := test.make_player('priv-b', 'Ude Privat', p_phone => '+4533333333');
  denied boolean;
  n integer;
begin
  perform test.act_as(alice);
  perform set_config('role', 'authenticated', true);

  denied := false;
  begin
    perform phone from public.profiles where id = bob;
  exception when insufficient_privilege then denied := true;
  end;
  perform test.check(denied, 'a player cannot read another player''s phone number');

  perform test.check(
    (select points from public.profiles where id = bob) = 500,
    'the ranking columns are still readable');

  perform test.check(
    (select phone from public.my_private_profile()) = '+4511111111',
    'a player reads their own phone number');

  denied := false;
  begin
    perform * from public.admin_player_contacts();
  exception when others then denied := sqlerrm like 'NOT_ADMIN%';
  end;
  perform test.check(denied, 'a player cannot list contact details');

  perform test.act_as(admin_a);
  select count(*) into n from public.admin_player_contacts();
  perform test.check(n = 3, 'an admin lists contacts for their own center only');
  perform test.check(
    not exists (select 1 from public.admin_player_contacts() where player_id = outsider),
    'an admin never sees another center''s contacts');

  perform set_config('role', 'postgres', true);
end
$$;

-- SMS is only queued for players who opted in.
do $$
declare
  c uuid := (select id from public.centers where slug = 'priv-a');
  alice uuid := (select id from public.profiles where full_name = 'Alice Privat');
  silent uuid := gen_random_uuid();
begin
  perform public.queue_sms(c, alice, null, 'event_cancelled', 'med samtykke');
  perform test.check(
    (select count(*) from public.sms_outbox where player_id = alice) = 1,
    'an opted-in player gets SMS');

  perform test.act_as(alice);
  perform set_config('role', 'authenticated', true);
  perform public.set_sms_consent(false);
  perform set_config('role', 'postgres', true);

  perform test.check(
    (select not sms_consent and sms_consent_at is null from public.profiles where id = alice),
    'a player can withdraw SMS consent');
  perform public.queue_sms(c, alice, null, 'event_cancelled', 'uden samtykke');
  perform test.check(
    (select count(*) from public.sms_outbox where player_id = alice) = 1,
    'no SMS is queued after consent is withdrawn');

  -- A signup that did not tick the box starts without consent.
  insert into auth.users (id, email, raw_user_meta_data)
  values (silent, 'silent@test.dk',
          jsonb_build_object('center_slug', 'priv-a', 'full_name', 'Stille Sofie', 'phone', '+4544444444'));
  perform test.check(
    (select not sms_consent and privacy_accepted_at is null from public.profiles where id = silent),
    'consent defaults to off when the signup did not opt in');
end
$$;

-- Export holds the caller's data and nobody else's.
do $$
declare
  c uuid := (select id from public.centers where slug = 'priv-a');
  alice uuid := (select id from public.profiles where full_name = 'Alice Privat');
  bob uuid := (select id from public.profiles where full_name = 'Bob Privat');
  admin_a uuid := (select id from public.profiles where full_name = 'Admin Privat');
  export jsonb;
begin
  insert into public.messages (center_id, sender_id, recipient_id, body) values (c, alice, bob, 'Hej Bob');
  insert into public.messages (center_id, sender_id, recipient_id, body) values (c, bob, admin_a, 'Privat til admin');

  perform test.act_as(alice);
  perform set_config('role', 'authenticated', true);
  export := public.export_my_data();
  perform set_config('role', 'postgres', true);

  perform test.check(export -> 'profile' ->> 'full_name' = 'Alice Privat', 'the export holds the profile');
  perform test.check(export -> 'profile' ->> 'phone' = '+4511111111', 'the export holds the phone number');
  perform test.check(jsonb_array_length(export -> 'messages') = 1, 'the export holds only the caller''s messages');
  perform test.check(jsonb_array_length(export -> 'sms') = 1, 'the export holds the caller''s SMS log');
end
$$;

-- Deleting your own account removes the login and everything personal.
do $$
declare
  c uuid := (select id from public.centers where slug = 'priv-a');
  alice uuid := (select id from public.profiles where full_name = 'Alice Privat');
  bob uuid := (select id from public.profiles where full_name = 'Bob Privat');
  admin_a uuid := (select id from public.profiles where full_name = 'Admin Privat');
  denied boolean;
begin
  perform test.act_as(alice);
  perform set_config('role', 'authenticated', true);
  perform public.delete_my_account();
  perform set_config('role', 'postgres', true);

  perform test.check(not exists (select 1 from auth.users where id = alice), 'the login is deleted');
  perform test.check(not exists (select 1 from public.profiles where id = alice), 'the profile is deleted');
  perform test.check(not exists (select 1 from public.sms_outbox where player_id = alice), 'the SMS log rows are deleted');
  perform test.check(not exists (select 1 from public.messages where sender_id = alice), 'the messages are deleted');
  perform test.check(exists (select 1 from public.profiles where id = bob), 'other players are untouched');

  -- The last admin cannot leave the center without an admin.
  perform test.act_as(admin_a);
  perform set_config('role', 'authenticated', true);
  denied := false;
  begin
    perform public.delete_my_account();
  exception when others then denied := sqlerrm like 'LAST_ADMIN%';
  end;
  perform set_config('role', 'postgres', true);
  perform test.check(denied, 'the last admin of a center cannot delete their account');

  -- Not in the middle of a match day: three other players depend on you.
  insert into public.events (id, center_id, title, starts_at, status)
  values ('00000000-0000-0000-0000-0000000000e1', c, 'Igang', now(), 'in_progress');
  insert into public.court_assignments (center_id, event_id, court_no, player_id)
  values (c, '00000000-0000-0000-0000-0000000000e1', 1, bob);
  perform test.act_as(bob);
  perform set_config('role', 'authenticated', true);
  denied := false;
  begin
    perform public.delete_my_account();
  exception when others then denied := sqlerrm like 'ACTIVE_MATCHDAY%';
  end;
  perform set_config('role', 'postgres', true);
  perform test.check(denied, 'a player cannot delete their account during a running match day');
end
$$;

-- An admin deleting a player removes the login too.
do $$
declare
  admin_a uuid := (select id from public.profiles where full_name = 'Admin Privat');
  victim uuid := test.make_player('priv-a', 'Slettes Snart');
  outsider uuid := (select id from public.profiles where full_name = 'Ude Privat');
  denied boolean;
begin
  perform test.act_as(admin_a);
  perform set_config('role', 'authenticated', true);
  perform public.admin_delete_player(victim);

  denied := false;
  begin
    perform public.admin_delete_player(outsider);
  exception when others then denied := sqlerrm like 'PLAYER_NOT_FOUND%';
  end;
  perform set_config('role', 'postgres', true);

  perform test.check(not exists (select 1 from auth.users where id = victim), 'admin deletion removes the login');
  perform test.check(denied, 'an admin cannot delete a player in another center');
  perform test.check(exists (select 1 from auth.users where id = outsider), 'the other center''s player is untouched');
end
$$;

-- Anonymous visitors cannot call any of it.
do $$
declare
  denied boolean := false;
begin
  perform test.act_as(null);
  perform set_config('role', 'anon', true);
  begin
    perform public.delete_my_account();
  exception when insufficient_privilege then denied := true;
  end;
  perform set_config('role', 'postgres', true);
  perform test.check(denied, 'anon cannot call delete_my_account');
end
$$;

rollback;
