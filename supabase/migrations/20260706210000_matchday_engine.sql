-- Server-side matchday engine: court split, set reporting and the
-- ELO-inspired point calculation (K=24, D=400, per set — see CLAUDE.md).
-- Points are ONLY ever written here (and in the audited admin function),
-- never by clients.

-- ============================================================
-- start_matchday: first caller locks the level-based court split.
-- Players may call from 15 minutes before start; admins anytime.
-- Idempotent: once assignments exist, subsequent calls are no-ops.
-- ============================================================
create or replace function public.start_matchday(p_event_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  ev public.events%rowtype;
  is_participant boolean;
  rec record;
  n integer := 0;
begin
  select * into ev from public.events where id = p_event_id;
  if ev.id is null or ev.center_id <> public.current_center_id() then
    raise exception 'EVENT_NOT_FOUND';
  end if;
  if ev.status not in ('open', 'in_progress') then
    raise exception 'EVENT_NOT_OPEN';
  end if;

  select exists (
    select 1 from public.event_registrations
    where event_id = p_event_id and player_id = auth.uid() and status = 'registered'
  ) into is_participant;
  if not is_participant and not public.is_center_admin() then
    raise exception 'NOT_PARTICIPANT';
  end if;

  if not public.is_center_admin() and now() < ev.starts_at - interval '15 minutes' then
    raise exception 'TOO_EARLY';
  end if;

  if exists (select 1 from public.court_assignments where event_id = p_event_id) then
    return; -- split already locked by an earlier caller
  end if;

  -- Level match: sort registered players by points, groups of 4.
  -- Leftover players (registered count not divisible by 4) get a bye.
  for rec in
    select r.player_id,
           row_number() over (order by pr.points desc, pr.joined_at asc, pr.id asc) - 1 as rn,
           count(*) over () as total
    from public.event_registrations r
    join public.profiles pr on pr.id = r.player_id
    where r.event_id = p_event_id and r.status = 'registered'
  loop
    if rec.rn < (rec.total / 4) * 4 then
      insert into public.court_assignments (center_id, event_id, court_no, player_id)
      values (ev.center_id, p_event_id, (rec.rn / 4)::integer + 1, rec.player_id);
      n := n + 1;
    end if;
  end loop;

  if n = 0 then
    raise exception 'NOT_ENOUGH_PLAYERS';
  end if;

  update public.events set status = 'in_progress' where id = p_event_id;
end;
$$;

revoke execute on function public.start_matchday(uuid) from public, anon, authenticated;
grant execute on function public.start_matchday(uuid) to authenticated;

-- ============================================================
-- report_set: any of the four players on the court reports a set.
-- The set-score domain rule is enforced by the sets table constraint.
-- ============================================================
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
  next_set integer;
begin
  select * into ev from public.events where id = p_event_id;
  if ev.id is null or ev.center_id <> public.current_center_id() then
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

  if array_length(p_team_a, 1) is distinct from 2 or array_length(p_team_b, 1) is distinct from 2 then
    raise exception 'INVALID_TEAMS';
  end if;
  all_four := p_team_a || p_team_b;
  if (select count(distinct x) from unnest(all_four) x) <> 4
     or exists (select 1 from unnest(all_four) x where not (x = any (court_players))) then
    raise exception 'INVALID_TEAMS';
  end if;

  select coalesce(max(set_no), 0) + 1 into next_set
  from public.sets
  where event_id = p_event_id and court_no = p_court_no;

  insert into public.sets (center_id, event_id, court_no, set_no, team_a, team_b, games_a, games_b)
  values (ev.center_id, p_event_id, p_court_no, next_set, p_team_a, p_team_b, p_games_a, p_games_b);

  return next_set;
end;
$$;

revoke execute on function public.report_set(uuid, integer, uuid[], uuid[], integer, integer) from public, anon, authenticated;
grant execute on function public.report_set(uuid, integer, uuid[], uuid[], integer, integer) to authenticated;

-- ============================================================
-- finish_court: ends the day for one court and applies the point model.
--   expected E = 1 / (1 + 10^((opp_avg - own_avg) / 400))
--   actual   S = own_games / (own_games + opp_games)
--   delta    = 24 * (S - E), summed over the day's sets, rounded once.
-- Ratings are snapshotted at finish time (points never move mid-day).
-- Guarded against double application via existing adjustments.
-- ============================================================
create or replace function public.finish_court(p_event_id uuid, p_court_no integer)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  ev public.events%rowtype;
  players uuid[];
  pts numeric[] := array[]::numeric[];
  deltas numeric[] := array[0, 0, 0, 0];
  wins_arr integer[] := array[0, 0, 0, 0];
  s record;
  pid uuid;
  partner uuid;
  i integer;
  j integer;
  n_sets integer := 0;
  own_games integer;
  opp_games integer;
  own_avg numeric;
  opp_avg numeric;
  e numeric;
  sc numeric;
  d integer;
  place integer;
begin
  select * into ev from public.events where id = p_event_id;
  if ev.id is null or ev.center_id <> public.current_center_id() then
    raise exception 'EVENT_NOT_FOUND';
  end if;
  if ev.status <> 'in_progress' then
    raise exception 'EVENT_NOT_IN_PROGRESS';
  end if;

  select array_agg(player_id order by player_id) into players
  from public.court_assignments
  where event_id = p_event_id and court_no = p_court_no;

  if players is null or array_length(players, 1) <> 4 then
    raise exception 'COURT_NOT_FOUND';
  end if;
  if not (auth.uid() = any (players)) and not public.is_center_admin() then
    raise exception 'NOT_ON_COURT';
  end if;
  if exists (
    select 1 from public.point_adjustments
    where event_id = p_event_id and player_id = any (players)
  ) then
    raise exception 'ALREADY_FINISHED';
  end if;

  foreach pid in array players loop
    pts := pts || (select points::numeric from public.profiles where id = pid);
  end loop;

  for s in
    select * from public.sets
    where event_id = p_event_id and court_no = p_court_no
    order by set_no
  loop
    n_sets := n_sets + 1;
    for i in 1..4 loop
      pid := players[i];
      if pid = any (s.team_a) then
        own_games := s.games_a; opp_games := s.games_b;
        select x into partner from unnest(s.team_a) x where x <> pid;
        own_avg := (pts[i] + pts[array_position(players, partner)]) / 2;
        opp_avg := (pts[array_position(players, s.team_b[1])] + pts[array_position(players, s.team_b[2])]) / 2;
      elsif pid = any (s.team_b) then
        own_games := s.games_b; opp_games := s.games_a;
        select x into partner from unnest(s.team_b) x where x <> pid;
        own_avg := (pts[i] + pts[array_position(players, partner)]) / 2;
        opp_avg := (pts[array_position(players, s.team_a[1])] + pts[array_position(players, s.team_a[2])]) / 2;
      else
        continue;
      end if;
      e := 1 / (1 + power(10::numeric, (opp_avg - own_avg) / 400));
      sc := own_games::numeric / (own_games + opp_games);
      deltas[i] := deltas[i] + 24 * (sc - e);
      if own_games > opp_games then
        wins_arr[i] := wins_arr[i] + 1;
      end if;
    end loop;
  end loop;

  if n_sets = 0 then
    raise exception 'NO_SETS';
  end if;

  for i in 1..4 loop
    d := round(deltas[i])::integer;
    place := 1;
    for j in 1..4 loop
      if deltas[j] > deltas[i] then place := place + 1; end if;
    end loop;

    update public.profiles
    set points = points + d,
        wins = wins + wins_arr[i],
        losses = losses + (n_sets - wins_arr[i])
    where id = players[i];

    insert into public.point_adjustments
      (center_id, event_id, player_id, delta, points_after, placement)
    values
      (ev.center_id, p_event_id, players[i], d, pts[i]::integer + d, place);
  end loop;

  -- Close the event once every assigned player has been settled.
  if not exists (
    select 1 from public.court_assignments ca
    where ca.event_id = p_event_id
      and not exists (
        select 1 from public.point_adjustments pa
        where pa.event_id = p_event_id and pa.player_id = ca.player_id
      )
  ) then
    update public.events set status = 'finished' where id = p_event_id;
  end if;
end;
$$;

revoke execute on function public.finish_court(uuid, integer) from public, anon, authenticated;
grant execute on function public.finish_court(uuid, integer) to authenticated;
