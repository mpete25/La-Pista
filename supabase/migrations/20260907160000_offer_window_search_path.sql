-- Security Advisor follow-up: offer_window() was the one function added
-- without a pinned search_path. It resolves no objects, so nothing could be
-- hijacked through it, but leaving one function with a mutable search_path
-- invites the next one to skip it too.
create or replace function public.offer_window()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '6 hours' $$;

revoke execute on function public.offer_window() from public, anon, authenticated;
