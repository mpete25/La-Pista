-- La Pista — initial schema
-- Multi-tenant: every row hangs off a center_id. Tenant isolation is enforced
-- with Row Level Security (RLS), never only in the UI. See CLAUDE.md.

-- ============================================================
-- TABLES
-- ============================================================

-- Tenants: one row per padel center.
create table public.centers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  city text,
  created_at timestamptz not null default now()
);

-- Player/admin profile, linked 1:1 to Supabase Auth users.
-- points/wins/losses are ONLY written server-side (Edge Function / triggers);
-- clients get column-level update grants for name/phone only.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  center_id uuid not null references public.centers (id),
  role text not null default 'player' check (role in ('player', 'center_admin')),
  full_name text not null,
  phone text,
  points integer not null default 500,
  wins integer not null default 0,
  losses integer not null default 0,
  joined_at timestamptz not null default now()
);

-- Ranking days. A match day lasts a fixed TIME window (default 2 hours) —
-- time, not set count, decides when it ends.
create table public.events (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers (id),
  title text not null,
  starts_at timestamptz not null,
  duration_minutes integer not null default 120,
  capacity integer not null default 16 check (capacity >= 4),
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'finished', 'cancelled')),
  created_at timestamptz not null default now()
);

-- Sign-ups incl. waitlist. Rows are created via the join_event() function
-- (no direct client INSERT) so capacity/waitlist rules can't be bypassed.
create table public.event_registrations (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers (id),
  event_id uuid not null references public.events (id) on delete cascade,
  player_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'registered'
    check (status in ('registered', 'waitlist', 'offered', 'cancelled')),
  created_at timestamptz not null default now(),
  unique (event_id, player_id)
);

-- Court split on a match day: players sorted by points, 4 per court.
create table public.court_assignments (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers (id),
  event_id uuid not null references public.events (id) on delete cascade,
  court_no integer not null check (court_no >= 1),
  player_id uuid not null references public.profiles (id),
  unique (event_id, player_id)
);

-- One row per played set. Teams are pairs of player ids; partners rotate
-- through the 3 unique combinations across the match day.
create table public.sets (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers (id),
  event_id uuid not null references public.events (id) on delete cascade,
  court_no integer not null check (court_no >= 1),
  set_no integer not null check (set_no >= 1),
  team_a uuid[] not null check (array_length(team_a, 1) = 2),
  team_b uuid[] not null check (array_length(team_b, 1) = 2),
  games_a integer not null check (games_a >= 0),
  games_b integer not null check (games_b >= 0),
  created_at timestamptz not null default now(),
  unique (event_id, court_no, set_no),
  -- DOMAIN RULE (padel, see CLAUDE.md): a set ends 6-0..6-4, 7-5 or 7-6.
  constraint valid_set_score check (
    (greatest(games_a, games_b) = 6 and least(games_a, games_b) between 0 and 4)
    or (greatest(games_a, games_b) = 7 and least(games_a, games_b) in (5, 6))
  )
);

-- Audit trail of rating changes; feeds the profile history/chart.
-- Written ONLY by the server-side point calculation.
create table public.point_adjustments (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers (id),
  event_id uuid not null references public.events (id),
  player_id uuid not null references public.profiles (id),
  delta integer not null,
  points_after integer not null,
  placement integer,
  created_at timestamptz not null default now(),
  unique (event_id, player_id)
);

create index profiles_center_idx on public.profiles (center_id);
create index events_center_starts_idx on public.events (center_id, starts_at);
create index registrations_event_status_idx on public.event_registrations (event_id, status);
create index sets_event_court_idx on public.sets (event_id, court_no);
create index adjustments_player_idx on public.point_adjustments (player_id, created_at);

-- ============================================================
-- HELPER FUNCTIONS (security definer: avoid recursive RLS lookups)
-- ============================================================

create or replace function public.current_center_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select center_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_center_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select role = 'center_admin' from public.profiles where id = auth.uid()),
    false
  );
$$;

-- Auto-create a profile when a user signs up. The center is picked from
-- signup metadata (center_slug); new players always start at 500 points
-- via the column default.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  target_center uuid;
begin
  select id into target_center
  from public.centers
  where slug = new.raw_user_meta_data ->> 'center_slug';

  if target_center is null then
    raise exception 'Unknown or missing center_slug in signup metadata';
  end if;

  insert into public.profiles (id, center_id, full_name, phone)
  values (
    new.id,
    target_center,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'Ny spiller'),
    new.raw_user_meta_data ->> 'phone'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Sign up for an event. Server-side so capacity/waitlist can't be bypassed.
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
  select * into ev from public.events where id = p_event_id;

  if ev.id is null or ev.center_id <> public.current_center_id() then
    raise exception 'Event not found';
  end if;
  if ev.status <> 'open' then
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

  insert into public.event_registrations (center_id, event_id, player_id, status)
  values (ev.center_id, p_event_id, auth.uid(), new_status);

  return new_status;
end;
$$;

-- Cancel own registration. Waitlist promotion (SMS offer flow) is handled
-- in a later milestone by an Edge Function.
create or replace function public.leave_event(p_event_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  update public.event_registrations
  set status = 'cancelled'
  where event_id = p_event_id
    and player_id = auth.uid()
    and status in ('registered', 'waitlist', 'offered');
end;
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.centers enable row level security;
alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.event_registrations enable row level security;
alter table public.court_assignments enable row level security;
alter table public.sets enable row level security;
alter table public.point_adjustments enable row level security;

-- centers: members see only their own center
create policy "members read own center"
  on public.centers for select
  using (id = public.current_center_id());

-- profiles: visible within the center (needed for the ranking list)
create policy "members read center profiles"
  on public.profiles for select
  using (center_id = public.current_center_id());

create policy "players update own profile"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- Column-level protection: clients may only touch name/phone.
-- points/wins/losses/role/center_id stay server-side only.
revoke update on table public.profiles from anon, authenticated;
grant update (full_name, phone) on table public.profiles to authenticated;

-- events: read within center; write only for center admins
create policy "members read center events"
  on public.events for select
  using (center_id = public.current_center_id());

create policy "admins insert events"
  on public.events for insert
  with check (public.is_center_admin() and center_id = public.current_center_id());

create policy "admins update events"
  on public.events for update
  using (public.is_center_admin() and center_id = public.current_center_id())
  with check (public.is_center_admin() and center_id = public.current_center_id());

create policy "admins delete events"
  on public.events for delete
  using (public.is_center_admin() and center_id = public.current_center_id());

-- event_registrations: read within center. No INSERT policy on purpose —
-- sign-ups go through join_event()/leave_event(). Admins may manage rows.
create policy "members read center registrations"
  on public.event_registrations for select
  using (center_id = public.current_center_id());

create policy "admins manage registrations"
  on public.event_registrations for all
  using (public.is_center_admin() and center_id = public.current_center_id())
  with check (public.is_center_admin() and center_id = public.current_center_id());

-- court_assignments: read within center; written by admin (or server-side)
create policy "members read center courts"
  on public.court_assignments for select
  using (center_id = public.current_center_id());

create policy "admins manage courts"
  on public.court_assignments for all
  using (public.is_center_admin() and center_id = public.current_center_id())
  with check (public.is_center_admin() and center_id = public.current_center_id());

-- sets: read within center; players on the court may report results;
-- results are immutable for players (no update/delete policy).
create policy "members read center sets"
  on public.sets for select
  using (center_id = public.current_center_id());

create policy "court players insert sets"
  on public.sets for insert
  with check (
    center_id = public.current_center_id()
    and exists (
      select 1 from public.court_assignments ca
      where ca.event_id = sets.event_id
        and ca.court_no = sets.court_no
        and ca.player_id = auth.uid()
    )
  );

create policy "admins delete sets"
  on public.sets for delete
  using (public.is_center_admin() and center_id = public.current_center_id());

-- point_adjustments: read within center; NEVER written by clients
-- (only the server-side point calculation with the service role).
create policy "members read center adjustments"
  on public.point_adjustments for select
  using (center_id = public.current_center_id());
