-- Run the send-sms Edge Function every two minutes.
--
-- send-sms releases expired waitlist offers (so the next player in line is
-- offered the spot) and sends what is queued in sms_outbox. Nothing called
-- it automatically until now.
--
-- Two separate safety catches mean this migration alone sends nothing:
--   1. invoke_send_sms() does nothing until the Vault holds `project_url`
--      and `cron_secret` (see docs/GO-LIVE.md for the two statements).
--   2. send-sms itself only reports the queue until SMS_GATEWAY_API_KEY is
--      set (and never sends while SMS_DRY_RUN=true).
--
-- pg_cron and pg_net exist on hosted Supabase. A plain PostgreSQL (the test
-- database in CI) has neither, so the schedule is skipped there.

create or replace function public.invoke_send_sms()
returns bigint
language plpgsql security definer
set search_path = public
as $$
declare
  base_url text;
  secret text;
begin
  select decrypted_secret into base_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'cron_secret';

  if base_url is null or secret is null then
    raise notice 'send-sms not invoked: vault secrets project_url / cron_secret are not set';
    return null;
  end if;

  return net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/send-sms',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', secret),
    body := '{}'::jsonb
  );
end;
$$;

-- Only the scheduler (running as postgres) calls this.
revoke execute on function public.invoke_send_sms() from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
    -- cron.schedule with a job name replaces an existing job of that name.
    perform cron.schedule('send-sms', '*/2 * * * *', 'select public.invoke_send_sms()');
  else
    raise notice 'pg_cron/pg_net not available: send-sms schedule skipped';
  end if;
end
$$;
