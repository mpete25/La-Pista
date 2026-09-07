-- Captures a safety net that existed only in production.
--
-- The hosted project carries an `ensure_rls` event trigger that switches
-- Row Level Security on for every new table in `public`. It was created
-- outside the repository, which is why an earlier migration revoked EXECUTE
-- on a function no migration created: production had it, a fresh database
-- did not, and the migration could not replay from scratch.
--
-- Bringing it into the repository puts every environment on the same
-- footing. Both halves are idempotent, so this is a no-op against the
-- project that already has it.
--
-- The trigger is a backstop, not permission to skip `enable row level
-- security` — every table here still enables RLS and defines its policies
-- explicitly. A table with RLS on and no policy denies everything, which is
-- the right way to fail.

create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name is not null
       and cmd.schema_name in ('public')
       and cmd.schema_name not in ('pg_catalog', 'information_schema')
       and cmd.schema_name not like 'pg\_toast%'
       and cmd.schema_name not like 'pg\_temp%' then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
        raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      exception
        when others then
          raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
    else
      raise log 'rls_auto_enable: skip % (system schema or not in the enforced list: %)',
        cmd.object_identity, cmd.schema_name;
    end if;
  end loop;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls') then
    create event trigger ensure_rls
      on ddl_command_end
      execute function public.rls_auto_enable();
  end if;
end
$$;

-- Event trigger functions are never called through the API.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
