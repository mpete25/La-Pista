-- Security Advisor follow-up: Postgres grants EXECUTE on functions to
-- PUBLIC by default, so anon could *call* our security-definer functions
-- (each call was still rejected internally — role/tenant checks — but
-- least privilege says anon should not be able to call them at all).
-- Strictly a tightening change: no policy logic is altered.

-- Trigger / event-trigger functions: never callable via the API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- RLS helpers: policy evaluation runs as the querying role, so
-- authenticated keeps EXECUTE. anon never queries tenant data.
revoke execute on function public.current_center_id() from public, anon, authenticated;
grant execute on function public.current_center_id() to authenticated;
revoke execute on function public.is_center_admin() from public, anon, authenticated;
grant execute on function public.is_center_admin() to authenticated;

-- RPC endpoints: signed-in users only (each validates role/tenant itself).
revoke execute on function public.join_event(uuid) from public, anon, authenticated;
grant execute on function public.join_event(uuid) to authenticated;
revoke execute on function public.leave_event(uuid) from public, anon, authenticated;
grant execute on function public.leave_event(uuid) to authenticated;
revoke execute on function public.admin_update_player(uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_update_player(uuid, text, text) to authenticated;
revoke execute on function public.admin_set_points(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.admin_set_points(uuid, integer, text) to authenticated;
revoke execute on function public.admin_delete_player(uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_player(uuid) to authenticated;

-- Future functions: no implicit EXECUTE for anon/public.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
