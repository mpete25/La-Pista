-- Public tenant lookup for the sign-in screen.
--
-- A player arriving at their center's sign-up page is not logged in yet, so
-- nothing can be read from the tenant tables — yet the screen has to show
-- which center they are joining, and the sign-up itself needs the slug.
-- Until now the app hardcoded a single center, which meant sign-up could
-- only ever create players in Padel Lounge.
--
-- SCOPE: this exposes center branding — slug, name, city — to anonymous
-- callers, the same way a subdomain is public. Column grants keep it to
-- those three fields, and no other table is reachable without a session.

-- Supabase grants the API roles table-wide SELECT by default, so a
-- column grant on its own would add nothing. Take the table grant away
-- from anon first, then hand back only the three branding columns —
-- the same pattern that protects points on profiles.
revoke select on table public.centers from anon;
grant select (id, slug, name, city) on table public.centers to anon;

create policy "anon reads center branding"
  on public.centers for select
  to anon
  using (true);
