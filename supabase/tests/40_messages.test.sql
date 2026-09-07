-- A message is between exactly two players in one center. Nobody else may
-- read it, nobody may send as somebody else, and text is never rewritten.
\set ON_ERROR_STOP on
begin;

do $$
declare
  c uuid := test.make_center('msg-a', 'Message A');
  other_c uuid := test.make_center('msg-b', 'Message B');
  alice uuid := test.make_player('msg-a', 'Alice Afsender');
  bob uuid := test.make_player('msg-a', 'Bob Modtager');
  nosy uuid := test.make_player('msg-a', 'Nysgerrig Nils');
  outsider uuid := test.make_player('msg-b', 'Ude Otto');
  denied boolean;
  visible integer;
begin
  perform test.act_as(alice);
  perform set_config('role', 'authenticated', true);

  insert into public.messages (center_id, sender_id, recipient_id, body)
  values (c, alice, bob, 'Skal vi spille torsdag?');

  perform test.check(
    (select count(*) from public.messages where sender_id = alice) = 1,
    'a player can message someone in their own center');

  -- Sending as somebody else is the obvious attack; the policy blocks it.
  denied := false;
  begin
    insert into public.messages (center_id, sender_id, recipient_id, body)
    values (c, bob, nosy, 'Skrevet i Bobs navn');
  exception when insufficient_privilege then denied := true;
  end;
  perform test.check(denied, 'a player cannot send a message as another player');

  -- Nor across a center boundary.
  denied := false;
  begin
    insert into public.messages (center_id, sender_id, recipient_id, body)
    values (c, alice, outsider, 'Hej nabo');
  exception when insufficient_privilege then denied := true;
  end;
  perform test.check(denied, 'a player cannot message someone in another center');

  perform set_config('role', 'postgres', true);
end
$$;

-- Only the two participants can read the thread.
do $$
declare
  alice uuid := (select id from public.profiles where full_name = 'Alice Afsender');
  bob uuid := (select id from public.profiles where full_name = 'Bob Modtager');
  nosy uuid := (select id from public.profiles where full_name = 'Nysgerrig Nils');
  visible integer;
begin
  perform test.act_as(bob);
  perform set_config('role', 'authenticated', true);
  select count(*) into visible from public.messages;
  perform test.check(visible = 1, 'the recipient sees the message');
  perform set_config('role', 'postgres', true);

  perform test.act_as(nosy);
  perform set_config('role', 'authenticated', true);
  select count(*) into visible from public.messages;
  perform test.check(visible = 0, 'a bystander in the same center sees nothing');
  perform set_config('role', 'postgres', true);
end
$$;

-- Marking read is the recipient's job, and the only thing an update may do.
do $$
declare
  alice uuid := (select id from public.profiles where full_name = 'Alice Afsender');
  bob uuid := (select id from public.profiles where full_name = 'Bob Modtager');
  denied boolean;
begin
  perform test.act_as(bob);
  perform set_config('role', 'authenticated', true);

  update public.messages set read_at = now() where sender_id = alice;
  perform test.check(
    (select read_at from public.messages where sender_id = alice) is not null,
    'the recipient can mark a message read');

  denied := false;
  begin
    update public.messages set body = 'noget helt andet' where sender_id = alice;
  exception when insufficient_privilege then denied := true;
  end;
  perform test.check(denied, 'a message body cannot be rewritten');

  perform set_config('role', 'postgres', true);

  -- The sender does not get to mark their own message as read.
  perform test.act_as(alice);
  perform set_config('role', 'authenticated', true);
  update public.messages set read_at = null where sender_id = alice;
  perform test.check(
    (select read_at from public.messages where sender_id = alice) is not null,
    'the sender cannot change the read state');
  perform set_config('role', 'postgres', true);
end
$$;

-- Shape rules that should never reach the UI.
do $$
declare
  c uuid := (select id from public.centers where slug = 'msg-a');
  alice uuid := (select id from public.profiles where full_name = 'Alice Afsender');
  bob uuid := (select id from public.profiles where full_name = 'Bob Modtager');
  rejected boolean;
begin
  rejected := false;
  begin
    insert into public.messages (center_id, sender_id, recipient_id, body)
    values (c, alice, alice, 'Kære mig selv');
  exception when check_violation then rejected := true;
  end;
  perform test.check(rejected, 'a message to yourself is rejected');

  rejected := false;
  begin
    insert into public.messages (center_id, sender_id, recipient_id, body)
    values (c, alice, bob, '   ');
  exception when check_violation then rejected := true;
  end;
  perform test.check(rejected, 'an empty message is rejected');
end
$$;

rollback;
