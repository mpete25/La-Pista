-- Multi-tenancy is the security story of this product: no query may cross
-- a center boundary, and admin powers must be enforced by RLS rather than
-- by hidden buttons. These tests run as the real `authenticated` and `anon`
-- roles, so the policies — not the owner's bypass — decide the outcome.
\set ON_ERROR_STOP on
begin;

do $$
declare
  c_a uuid := test.make_center('iso-a', 'Center A');
  c_b uuid := test.make_center('iso-b', 'Center B');
  alice uuid := test.make_player('iso-a', 'Alice A');
  bob uuid := test.make_player('iso-b', 'Bob B');
  admin_b uuid := test.make_player('iso-b', 'Admin B', 500, 'center_admin');
  ev_b uuid;
  visible integer;
  denied boolean;
begin
  insert into public.events (center_id, title, starts_at)
  values (c_b, 'B-dag', now() + interval '2 days') returning id into ev_b;

  -- Alice belongs to center A and must not see center B at all.
  perform test.act_as(alice);
  perform set_config('role', 'authenticated', true);

  select count(*) into visible from public.profiles where id = bob;
  perform test.check(visible = 0, 'a player cannot read profiles from another center');

  select count(*) into visible from public.events where id = ev_b;
  perform test.check(visible = 0, 'a player cannot read events from another center');

  select count(*) into visible from public.centers where id = c_b;
  perform test.check(visible = 0, 'a player cannot read another center row');

  select count(*) into visible from public.profiles;
  perform test.check(visible = 1, 'a player sees only their own center roster');

  perform set_config('role', 'postgres', true);
end
$$;

-- A plain player has no admin powers, whatever the UI shows.
do $$
declare
  c_a uuid := (select id from public.centers where slug = 'iso-a');
  alice uuid := (select id from public.profiles where full_name = 'Alice A');
  denied boolean;
  ev uuid;
begin
  perform test.act_as(alice);
  perform set_config('role', 'authenticated', true);

  denied := false;
  begin
    insert into public.events (center_id, title, starts_at)
    values (c_a, 'Ulovlig dag', now() + interval '1 day');
  exception when insufficient_privilege then
    denied := true;
  end;
  perform test.check(denied, 'a player cannot create events');

  denied := false;
  begin
    update public.profiles set points = 9999 where id = alice;
  exception when insufficient_privilege then
    denied := true;
  end;
  perform test.check(denied, 'a player cannot write their own points');

  -- Name and phone are the only self-service columns.
  update public.profiles set full_name = 'Alice Andersen', phone = '+4500000000' where id = alice;
  perform test.check(
    (select full_name from public.profiles where id = alice) = 'Alice Andersen',
    'a player may still edit their own name');

  perform set_config('role', 'postgres', true);
end
$$;

-- Admin RPCs check the role themselves, not just the policy.
do $$
declare
  alice uuid := (select id from public.profiles where full_name = 'Alice Andersen');
  bob uuid := (select id from public.profiles where full_name = 'Bob B');
  admin_b uuid := (select id from public.profiles where full_name = 'Admin B');
  denied text;
begin
  perform test.act_as(alice);
  perform set_config('role', 'authenticated', true);

  denied := null;
  begin
    perform public.admin_set_points(alice, 4000, 'snyd');
  exception when others then
    denied := sqlerrm;
  end;
  perform test.check(denied = 'NOT_ADMIN', 'a player cannot call admin_set_points');

  perform set_config('role', 'postgres', true);

  -- An admin of center B may not reach into center A either.
  perform test.act_as(admin_b);
  perform set_config('role', 'authenticated', true);

  denied := null;
  begin
    perform public.admin_set_points(alice, 4000, 'på tværs af centre');
  exception when others then
    denied := sqlerrm;
  end;
  perform test.check(denied = 'PLAYER_NOT_FOUND',
    'an admin cannot touch a player in another center');

  -- ...but may adjust their own center's players, with an audit row.
  perform public.admin_set_points(bob, 620, 'korrektion efter fejlindtastning');
  perform test.check((select points from public.profiles where id = bob) = 620,
    'an admin can correct points in their own center');
  perform test.check(
    (select count(*) from public.point_adjustments
     where player_id = bob and adjusted_by = admin_b and reason is not null) = 1,
    'every manual point change is audited');

  perform set_config('role', 'postgres', true);
end
$$;

-- Results may only be reported by someone actually on that court.
do $$
declare
  c uuid := test.make_center('iso-c', 'Center C');
  ev uuid;
  on_court uuid := test.make_player('iso-c', 'Paa Banen');
  off_court uuid := test.make_player('iso-c', 'Udenfor');
  others uuid[] := array[
    test.make_player('iso-c', 'Med 1'),
    test.make_player('iso-c', 'Med 2'),
    test.make_player('iso-c', 'Med 3')];
  denied boolean := false;
begin
  insert into public.events (center_id, title, starts_at, status)
  values (c, 'Bane-test', now() - interval '30 minutes', 'in_progress') returning id into ev;

  insert into public.court_assignments (center_id, event_id, court_no, player_id)
  values (c, ev, 1, on_court), (c, ev, 1, others[1]), (c, ev, 1, others[2]), (c, ev, 1, others[3]);

  perform test.act_as(off_court);
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.sets (center_id, event_id, court_no, set_no, team_a, team_b, games_a, games_b)
    values (c, ev, 1, 1, array[on_court, others[1]], array[others[2], others[3]], 6, 3);
  exception when insufficient_privilege then
    denied := true;
  end;
  perform test.check(denied, 'a player not on the court cannot report its results');

  perform set_config('role', 'postgres', true);
end
$$;

-- Anonymous callers cannot reach the RPC surface at all.
do $$
declare
  denied boolean := false;
  ev uuid := (select id from public.events where title = 'Bane-test');
begin
  perform set_config('role', 'anon', true);
  begin
    perform public.join_event(ev);
  exception when insufficient_privilege then
    denied := true;
  end;
  perform test.check(denied, 'anon cannot call join_event');
  perform set_config('role', 'postgres', true);
end
$$;

rollback;
