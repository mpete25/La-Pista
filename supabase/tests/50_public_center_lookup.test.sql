-- The sign-up screen has to name the center before anyone is logged in.
-- That is the only thing an anonymous caller may learn.
\set ON_ERROR_STOP on
begin;

do $$
declare
  c uuid := test.make_center('anon-a', 'Anon Center');
  player uuid := test.make_player('anon-a', 'Anon Spiller');
  found text;
  visible integer;
  denied boolean;
begin
  insert into public.events (center_id, title, starts_at)
  values (c, 'Hemmelig dag', now() + interval '1 day');

  perform set_config('role', 'anon', true);

  select name into found from public.centers where slug = 'anon-a';
  perform test.check(found = 'Anon Center', 'the sign-up screen can name the center');

  -- ...and nothing else is reachable without a session. The tenant tables
  -- are gated twice over: the policies filter on current_center_id(), and
  -- anon is not even allowed to call it.
  denied := false;
  begin
    select count(*) into visible from public.profiles;
  exception when insufficient_privilege then denied := true;
  end;
  perform test.check(denied, 'anon cannot read the player roster');

  denied := false;
  begin
    select count(*) into visible from public.events;
  exception when insufficient_privilege then denied := true;
  end;
  perform test.check(denied, 'anon cannot read events');

  denied := false;
  begin
    perform (select created_at from public.centers where slug = 'anon-a');
  exception when insufficient_privilege then denied := true;
  end;
  perform test.check(denied, 'anon is limited to the branding columns');

  denied := false;
  begin
    insert into public.centers (slug, name) values ('pirat', 'Pirat Center');
  exception when insufficient_privilege then denied := true;
  end;
  perform test.check(denied, 'anon cannot create a center');

  perform set_config('role', 'postgres', true);
end
$$;

rollback;
