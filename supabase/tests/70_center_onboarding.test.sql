-- Creating centers and appointing admins is a platform operation: only the
-- service role may do it.
\set ON_ERROR_STOP on
begin;

do $$
declare
  player uuid;
  player_email text;
  new_center uuid;
  denied boolean;
begin
  perform test.make_center('onb-home', 'Onboarding Home');
  player := test.make_player('onb-home', 'Almindelig Anna');
  select email into player_email from auth.users where id = player;

  -- A signed-in player cannot create a center or promote themselves.
  perform test.act_as(player);
  perform set_config('role', 'authenticated', true);
  denied := false;
  begin
    perform public.platform_create_center('snydecenter', 'Snyd');
  exception when insufficient_privilege then denied := true;
  end;
  perform test.check(denied, 'a player cannot create a center');

  denied := false;
  begin
    perform public.platform_set_role(player_email, 'center_admin');
  exception when insufficient_privilege then denied := true;
  end;
  perform test.check(denied, 'a player cannot make themselves admin');
  perform set_config('role', 'postgres', true);

  -- The service role can.
  perform set_config('role', 'service_role', true);
  new_center := public.platform_create_center('  Ny-Padel  ', 'Ny Padel', 'Odense');
  perform set_config('role', 'postgres', true);
  perform test.check(
    (select slug from public.centers where id = new_center) = 'ny-padel',
    'the service role creates a center with a normalised slug');

  perform set_config('role', 'service_role', true);
  denied := false;
  begin
    perform public.platform_create_center('ikke gyldig!', 'X');
  exception when others then denied := sqlerrm like 'INVALID_SLUG%';
  end;
  perform test.check(denied, 'a slug that is not DNS-safe is rejected');

  denied := false;
  begin
    perform public.platform_create_center('www', 'X');
  exception when others then denied := sqlerrm like 'RESERVED_SLUG%';
  end;
  perform test.check(denied, 'reserved subdomains are rejected');

  perform public.platform_set_role(player_email, 'center_admin');
  perform set_config('role', 'postgres', true);
  perform test.check(
    (select role from public.profiles where id = player) = 'center_admin',
    'the service role appoints an admin by e-mail');
end
$$;

rollback;
