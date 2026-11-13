-- Live updates for the ranking list and match days.
--
-- The app subscribes to these tables and refetches when they change, so a
-- set reported on court 2 or points awarded at the end of a day show up on
-- every phone in the hall without a manual reload. Realtime evaluates the
-- tables' RLS SELECT policies per subscriber, so tenant isolation holds:
-- nobody receives changes from another center.
--
-- profiles is deliberately NOT published (it holds private columns); point
-- changes are picked up through point_adjustments instead.
do $$
declare
  t text;
begin
  foreach t in array array['events', 'event_registrations', 'court_assignments', 'sets', 'point_adjustments']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;
