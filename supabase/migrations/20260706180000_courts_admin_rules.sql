-- Courts, admin player management, and the 24h cancellation rule.
-- Approved by the product owner 2026-07-06 (incl. audited admin point edits).

-- ============================================================
-- COURTS (per center, e.g. D1..D8 — names editable per tenant)
-- ============================================================

create table public.courts (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers (id),
  name text not null,
  sort_order integer not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (center_id, name)
);
create index courts_center_sort_idx on public.courts (center_id, sort_order);

-- Which courts are reserved for a given ranking day.
create table public.event_courts (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers (id),
  event_id uuid not null references public.events (id) on delete cascade,
  court_id uuid not null references public.courts (id),
  unique (event_id, court_id)
);

alter table public.courts enable row level security;
alter table public.event_courts enable row level security;

create policy "members read courts"
  on public.courts for select
  using (center_id = public.current_center_id());

create policy "admins manage courts"
  on public.courts for all
  using (public.is_center_admin() and center_id = public.current_center_id())
  with check (public.is_center_admin() and center_id = public.current_center_id());

create policy "members read event courts"
  on public.event_courts for select
  using (center_id = public.current_center_id());

create policy "admins manage event courts"
  on public.event_courts for all
  using (public.is_center_admin() and center_id = public.current_center_id())
  with check (public.is_center_admin() and center_id = public.current_center_id());

-- Seed D1..D8 for the demo tenant (Padel Lounge). Idempotent.
insert into public.courts (center_id, name, sort_order)
select c.id, 'D' || n, n
from public.centers c, generate_series(1, 8) as n
where c.slug = 'padel-lounge-aalborg'
on conflict (center_id, name) do nothing;

-- ============================================================
-- 24H CANCELLATION RULE
-- Confirmed spots cannot self-cancel within 24h of start; the player
-- must contact the center, and an admin removes them from the panel.
-- Waitlist/offered spots may leave at any time.
-- ============================================================

create or replace function public.leave_event(p_event_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  ev public.events%rowtype;
  reg public.event_registrations%rowtype;
begin
  select * into ev from public.events where id = p_event_id;
  if ev.id is null then
    raise exception 'EVENT_NOT_FOUND';
  end if;

  select * into reg from public.event_registrations
  where event_id = p_event_id and player_id = auth.uid()
    and status in ('registered', 'waitlist', 'offered');
  if reg.id is null then
    return;
  end if;

  if reg.status = 'registered' and ev.starts_at <= now() + interval '24 hours' then
    raise exception 'CANCEL_WINDOW_CLOSED';
  end if;

  update public.event_registrations set status = 'cancelled' where id = reg.id;
end;
$$;

-- ============================================================
-- MANUAL POINT ADJUSTMENTS (audited) + ADMIN PLAYER MANAGEMENT
-- point_adjustments doubles as the audit log: event_id becomes nullable
-- (null = manual adjustment) and we record who adjusted and why.
-- ============================================================

alter table public.point_adjustments alter column event_id drop not null;
alter table public.point_adjustments add column reason text;
alter table public.point_adjustments add column adjusted_by uuid references public.profiles (id) on delete set null;

-- Allow deleting a profile without orphaning FK references.
alter table public.point_adjustments drop constraint point_adjustments_player_id_fkey;
alter table public.point_adjustments add constraint point_adjustments_player_id_fkey
  foreign key (player_id) references public.profiles (id) on delete cascade;
alter table public.court_assignments drop constraint court_assignments_player_id_fkey;
alter table public.court_assignments add constraint court_assignments_player_id_fkey
  foreign key (player_id) references public.profiles (id) on delete cascade;

-- Admin RPCs are security definer: they bypass the column-level grants that
-- protect points from ordinary clients, but verify the admin role and the
-- tenant boundary themselves. Every point change writes an audit row.

create or replace function public.admin_update_player(p_player_id uuid, p_full_name text, p_phone text)
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
  select * into target from public.profiles where id = p_player_id;
  if target.id is null or target.center_id <> public.current_center_id() then
    raise exception 'PLAYER_NOT_FOUND';
  end if;

  update public.profiles set
    full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
    phone = nullif(trim(coalesce(p_phone, '')), '')
  where id = p_player_id;
end;
$$;

create or replace function public.admin_set_points(p_player_id uuid, p_points integer, p_reason text)
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
  if p_points is null or p_points < 0 then
    raise exception 'INVALID_POINTS';
  end if;
  select * into target from public.profiles where id = p_player_id;
  if target.id is null or target.center_id <> public.current_center_id() then
    raise exception 'PLAYER_NOT_FOUND';
  end if;

  update public.profiles set points = p_points where id = p_player_id;

  insert into public.point_adjustments
    (center_id, event_id, player_id, delta, points_after, reason, adjusted_by)
  values
    (target.center_id, null, p_player_id, p_points - target.points, p_points,
     coalesce(nullif(trim(p_reason), ''), 'Manuel justering'), auth.uid());
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

  -- Registrations/assignments/adjustments cascade. The auth.users row
  -- remains for now; full login removal needs the service role and is
  -- handled in a later milestone (Edge Function).
  delete from public.profiles where id = p_player_id;
end;
$$;
