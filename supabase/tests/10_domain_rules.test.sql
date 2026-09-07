-- The padel domain rules from CLAUDE.md, pinned as tests. These are the
-- rules that must never silently change: set scores, starting points,
-- the level-based court split, the 24h cancellation window and the
-- ELO-inspired points model.
\set ON_ERROR_STOP on
begin;

-- ============================================================
-- Starting points: every new player begins at 500.
-- ============================================================
do $$
declare
  c uuid := test.make_center('rules-a', 'Rules A');
  p uuid := test.make_player('rules-a', 'Ny Spiller');
begin
  perform test.check((select points from public.profiles where id = p) = 500,
    'a new player starts at 500 points');
  perform test.check((select wins + losses from public.profiles where id = p) = 0,
    'a new player has no recorded sets');
end
$$;

-- ============================================================
-- Set scores: 6-0..6-4, 7-5 and 7-6 are the only valid endings.
-- ============================================================
do $$
declare
  c uuid := (select id from public.centers where slug = 'rules-a');
  ev uuid;
  a uuid := test.make_player('rules-a', 'Score A');
  b uuid := test.make_player('rules-a', 'Score B');
  x uuid := test.make_player('rules-a', 'Score C');
  y uuid := test.make_player('rules-a', 'Score D');
  valid   integer[][] := array[[6,0],[6,1],[6,2],[6,3],[6,4],[7,5],[7,6],[0,6],[4,6],[5,7],[6,7]];
  invalid integer[][] := array[[6,5],[5,6],[8,6],[6,6],[7,4],[7,7],[9,7],[5,3],[6,8]];
  i integer;
  ok boolean;
begin
  insert into public.events (center_id, title, starts_at)
  values (c, 'Score-test', now() + interval '1 day')
  returning id into ev;

  for i in 1 .. array_length(valid, 1) loop
    insert into public.sets (center_id, event_id, court_no, set_no, team_a, team_b, games_a, games_b)
    values (c, ev, 1, i, array[a, b], array[x, y], valid[i][1], valid[i][2]);
  end loop;

  for i in 1 .. array_length(invalid, 1) loop
    begin
      insert into public.sets (center_id, event_id, court_no, set_no, team_a, team_b, games_a, games_b)
      values (c, ev, 2, i, array[a, b], array[x, y], invalid[i][1], invalid[i][2]);
      ok := false;
    exception when check_violation then
      ok := true;
    end;
    perform test.check(ok, format('%s-%s must be rejected as a final set score',
      invalid[i][1], invalid[i][2]));
  end loop;
end
$$;

-- ============================================================
-- Sign-up: capacity is respected and the overflow goes on the waitlist.
-- ============================================================
do $$
declare
  c uuid := test.make_center('rules-b', 'Rules B');
  ev uuid;
  p uuid;
  i integer;
  outcome text;
begin
  insert into public.events (center_id, title, starts_at, capacity)
  values (c, 'Fuld dag', now() + interval '3 days', 4)
  returning id into ev;

  for i in 1 .. 6 loop
    p := test.make_player('rules-b', 'Spiller ' || i);
    perform test.act_as(p);
    outcome := public.join_event(ev);
    if i <= 4 then
      perform test.check(outcome = 'registered', format('player %s gets a confirmed spot', i));
    else
      perform test.check(outcome = 'waitlist', format('player %s lands on the waitlist', i));
    end if;
  end loop;

  perform test.check(
    (select count(*) from public.event_registrations where event_id = ev and status = 'registered') = 4,
    'capacity is not exceeded');
  perform test.check(
    (select count(*) from public.event_registrations where event_id = ev and status = 'waitlist') = 2,
    'the overflow is waitlisted');
end
$$;

-- ============================================================
-- 24h rule: a confirmed spot cannot self-cancel inside 24 hours;
-- waitlisted players may leave at any time.
-- ============================================================
do $$
declare
  c uuid := (select id from public.centers where slug = 'rules-b');
  soon uuid;
  later uuid;
  p uuid := test.make_player('rules-b', 'Afbud Anders');
  w uuid := test.make_player('rules-b', 'Venteliste Vera');
  blocked boolean := false;
begin
  insert into public.events (center_id, title, starts_at, capacity)
  values (c, 'I morgen tidlig', now() + interval '6 hours', 4) returning id into soon;
  insert into public.events (center_id, title, starts_at, capacity)
  values (c, 'Om en uge', now() + interval '7 days', 4) returning id into later;

  perform test.act_as(p);
  perform public.join_event(soon);
  begin
    perform public.leave_event(soon);
  exception when others then
    blocked := (sqlerrm = 'CANCEL_WINDOW_CLOSED');
  end;
  perform test.check(blocked, 'a confirmed spot cannot be cancelled within 24h of start');
  perform test.check(
    (select status from public.event_registrations where event_id = soon and player_id = p) = 'registered',
    'the blocked cancellation left the registration untouched');

  perform public.join_event(later);
  perform public.leave_event(later);
  perform test.check(
    (select status from public.event_registrations where event_id = later and player_id = p) = 'cancelled',
    'cancelling more than 24h ahead works');
end
$$;

-- ============================================================
-- Level matching: players sorted by points, four to a court,
-- leftovers get a bye.
-- ============================================================
do $$
declare
  c uuid := test.make_center('rules-c', 'Rules C');
  ev uuid;
  admin_id uuid := test.make_player('rules-c', 'Admin Anna', 500, 'center_admin');
  p uuid;
  i integer;
  court1 integer[];
  court2 integer[];
begin
  insert into public.events (center_id, title, starts_at, capacity)
  values (c, 'Niveaudag', now() + interval '2 hours', 16) returning id into ev;

  -- Nine players on descending ratings: 900, 880, ... 740.
  for i in 0 .. 8 loop
    p := test.make_player('rules-c', 'Rated ' || i, 900 - i * 20);
    perform test.act_as(p);
    perform public.join_event(ev);
  end loop;

  perform test.act_as(admin_id);
  perform public.start_matchday(ev);

  perform test.check(
    (select count(*) from public.court_assignments where event_id = ev) = 8,
    'nine players fill two courts and one gets a bye');
  perform test.check(
    (select count(distinct court_no) from public.court_assignments where event_id = ev) = 2,
    'exactly two courts are opened');

  select array_agg(pr.points order by pr.points desc) into court1
  from public.court_assignments ca join public.profiles pr on pr.id = ca.player_id
  where ca.event_id = ev and ca.court_no = 1;
  select array_agg(pr.points order by pr.points desc) into court2
  from public.court_assignments ca join public.profiles pr on pr.id = ca.player_id
  where ca.event_id = ev and ca.court_no = 2;

  perform test.check(court1 = array[900, 880, 860, 840],
    'court 1 holds the four highest rated players');
  perform test.check(court2 = array[820, 800, 780, 760],
    'court 2 holds the next four');
  perform test.check(
    (select status from public.events where id = ev) = 'in_progress',
    'starting the matchday moves the event to in_progress');
end
$$;

-- ============================================================
-- Points model: delta = 24 * (own_games/(own+opp) - expected), per set.
-- ============================================================
do $$
declare
  c uuid := test.make_center('rules-d', 'Rules D');
  ev uuid;
  a uuid := test.make_player('rules-d', 'Even One', 500);
  b uuid := test.make_player('rules-d', 'Even Two', 500);
  x uuid := test.make_player('rules-d', 'Even Three', 500);
  y uuid := test.make_player('rules-d', 'Even Four', 500);
begin
  insert into public.events (center_id, title, starts_at, capacity, status)
  values (c, 'Pointdag', now() - interval '1 hour', 16, 'in_progress') returning id into ev;

  insert into public.court_assignments (center_id, event_id, court_no, player_id)
  values (c, ev, 1, a), (c, ev, 1, b), (c, ev, 1, x), (c, ev, 1, y);

  -- Equal ratings, one set 6-2: S = 6/8 = .75, E = .5, delta = 24 * .25 = 6.
  insert into public.sets (center_id, event_id, court_no, set_no, team_a, team_b, games_a, games_b)
  values (c, ev, 1, 1, array[a, b], array[x, y], 6, 2);

  perform test.act_as(a);
  perform public.finish_court(ev, 1);

  perform test.check((select points from public.profiles where id = a) = 506,
    'the winning pair of an even 6-2 gains 6 points');
  perform test.check((select points from public.profiles where id = b) = 506,
    'both winners gain the same');
  perform test.check((select points from public.profiles where id = x) = 494,
    'the losing pair drops 6 points');
  perform test.check((select points from public.profiles where id = y) = 494,
    'both losers drop the same');
  perform test.check(
    (select wins from public.profiles where id = a) = 1
    and (select losses from public.profiles where id = x) = 1,
    'wins and losses are recorded per set');
  perform test.check(
    (select count(*) from public.point_adjustments where event_id = ev) = 4,
    'every player on the court gets an audit row');
  perform test.check(
    (select points_after from public.point_adjustments where event_id = ev and player_id = a) = 506,
    'the audit row records the rating after the day');
end
$$;

-- A favourite that wins narrowly still loses rating: that is the whole
-- point of scoring on games rather than on the win itself.
do $$
declare
  c uuid := (select id from public.centers where slug = 'rules-d');
  ev uuid;
  a uuid := test.make_player('rules-d', 'Favourite One', 600);
  b uuid := test.make_player('rules-d', 'Favourite Two', 600);
  x uuid := test.make_player('rules-d', 'Underdog One', 400);
  y uuid := test.make_player('rules-d', 'Underdog Two', 400);
  delta_fav integer;
  delta_dog integer;
begin
  insert into public.events (center_id, title, starts_at, capacity, status)
  values (c, 'Favoritdag', now() - interval '1 hour', 16, 'in_progress') returning id into ev;

  insert into public.court_assignments (center_id, event_id, court_no, player_id)
  values (c, ev, 1, a), (c, ev, 1, b), (c, ev, 1, x), (c, ev, 1, y);

  -- E for the favourites = 1/(1+10^((400-600)/400)) = 0.7597.
  -- S = 6/10 = 0.6, so delta = 24 * (0.6 - 0.7597) = -3.83 -> -4.
  insert into public.sets (center_id, event_id, court_no, set_no, team_a, team_b, games_a, games_b)
  values (c, ev, 1, 1, array[a, b], array[x, y], 6, 4);

  perform test.act_as(a);
  perform public.finish_court(ev, 1);

  select delta into delta_fav from public.point_adjustments where event_id = ev and player_id = a;
  select delta into delta_dog from public.point_adjustments where event_id = ev and player_id = x;

  perform test.check(delta_fav = -4,
    format('a favourite winning only 6-4 still loses rating (got %s)', delta_fav));
  perform test.check(delta_dog = 4,
    format('the underdogs gain despite losing the set (got %s)', delta_dog));
  perform test.check((select wins from public.profiles where id = a) = 1,
    'the set is still recorded as a win');
end
$$;

rollback;
