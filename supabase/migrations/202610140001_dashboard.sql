-- Run once in the Supabase SQL Editor. This creates only dashboard-owned objects.
begin;
create schema if not exists dashboard_private;
revoke all on schema dashboard_private from public, anon, authenticated;

create table dashboard_private.approved_emails (
  email text primary key check (email = lower(email))
);
insert into dashboard_private.approved_emails(email) values ('rolihlahla.info@gmail.com');

create table dashboard_private.reports (
  owner uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('reports', 'googleReports')),
  property_id text not null check (property_id ~ '^[a-z0-9-]+$'),
  month text not null check (month ~ '^20[0-9][0-9]-(0[1-9]|1[0-2])$'),
  revision integer not null check (revision > 0),
  report jsonb not null check (jsonb_typeof(report) = 'object' and octet_length(report::text) <= 4000000),
  config_key text,
  updated_at timestamptz not null default now(),
  primary key (owner, kind, property_id, month)
);
create table dashboard_private.connections (
  owner uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object')
);
create table dashboard_private.oauth_states (
  owner uuid primary key references auth.users(id) on delete cascade,
  hash text not null,
  verifier text not null,
  expires timestamptz not null
);
create table dashboard_private.sync_locks (
  owner uuid primary key references auth.users(id) on delete cascade,
  token text not null,
  expires timestamptz not null
);

-- No direct table grants or permissive policies. Only the bounded RPC below
-- can access rows; each call derives its owner from Supabase's verified JWT.
alter table dashboard_private.approved_emails enable row level security;
alter table dashboard_private.reports enable row level security;
alter table dashboard_private.connections enable row level security;
alter table dashboard_private.oauth_states enable row level security;
alter table dashboard_private.sync_locks enable row level security;
revoke all on all tables in schema dashboard_private from public, anon, authenticated;

create function public.dashboard_operation(action text, payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  account uuid := auth.uid();
  connection jsonb;
  existing_revision integer;
  report_value jsonb;
  verifier_value text;
  patch jsonb;
  report_kind text := coalesce(payload->>'kind', 'reports');
  property text := payload->>'propertyId';
  report_month text := payload->>'month';
begin
  if account is null or not exists (
    select 1 from auth.users u
    join dashboard_private.approved_emails a on a.email = lower(u.email)
    where u.id = account and u.email_confirmed_at is not null
      and u.deleted_at is null and (u.banned_until is null or u.banned_until < now())
  ) or not exists (
    select 1 from auth.sessions s where s.user_id = account
      and s.id = nullif(auth.jwt()->>'session_id', '')::uuid
      and (s.not_after is null or s.not_after > now())
  ) then
    raise sqlstate '42501' using message = 'Dashboard access denied';
  end if;
  if jsonb_typeof(payload) <> 'object' then
    raise sqlstate 'PT400' using message = 'Invalid operation';
  end if;

  -- Serializes changes for this user, including OAuth consumption and sync.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tsogo:' || account::text, 0));
  select data into connection from dashboard_private.connections where owner = account;

  case action
    when 'list_reports' then
      return coalesce((select jsonb_agg(r.report order by r.month desc)
        from dashboard_private.reports r where r.owner = account and r.kind = report_kind
        and (payload->>'configKey' is null or r.config_key = payload->>'configKey')), '[]'::jsonb);
    when 'get_report' then
      return (select r.report from dashboard_private.reports r where r.owner = account
        and r.kind = report_kind and r.property_id = property and r.month = report_month);
    when 'save_import', 'save_google_report' then
      report_kind := case when action = 'save_import' then 'reports' else 'googleReports' end;
      report_value := payload->'report';
      if property is null or report_month is null or report_value is null
        or report_value->>'propertyId' is distinct from property
        or report_value->>'month' is distinct from report_month then
        raise sqlstate 'PT400' using message = 'Invalid report identity';
      end if;
      select r.revision into existing_revision from dashboard_private.reports r
        where r.owner = account and r.kind = report_kind and r.property_id = property and r.month = report_month;
      existing_revision := coalesce(existing_revision, 0);
      if action = 'save_import' then
        if (payload->>'expectedRevision')::integer is distinct from existing_revision then
          raise sqlstate 'PT409' using message = 'Report revision changed';
        end if;
      else
        if connection is null or connection->>'refresh_token' is null
          or connection->>'revision' is distinct from payload->>'revision'
          or not exists (select 1 from dashboard_private.sync_locks where owner = account
            and token = payload->>'token' and expires > now()) then return 'false'::jsonb; end if;
      end if;
      report_value := jsonb_set(report_value, '{revision}', to_jsonb(existing_revision + 1));
      insert into dashboard_private.reports(owner, kind, property_id, month, revision, report, config_key)
        values (account, report_kind, property, report_month, existing_revision + 1, report_value, payload->>'configKey')
        on conflict (owner, kind, property_id, month) do update
          set revision = excluded.revision, report = excluded.report, config_key = excluded.config_key, updated_at = now();
      if action = 'save_google_report' then
        update dashboard_private.connections set data = data || jsonb_build_object('last_sync', now(), 'last_error', null)
          where owner = account;
        return 'true'::jsonb;
      end if;
      return report_value;
    when 'get_connection' then return connection;
    when 'save_credentials' then
      if coalesce(length(payload->>'clientId'), 0) not between 1 and 300
        or coalesce(length(payload->>'clientSecret'), 0) not between 1 and 10000 then
        raise sqlstate 'PT400' using message = 'Invalid credentials';
      end if;
      insert into dashboard_private.connections(owner, data) values (account, jsonb_build_object(
        'owner', account, 'client_id', payload->>'clientId', 'client_secret', payload->>'clientSecret',
        'refresh_token', null, 'config', null, 'connected_at', null, 'last_sync', null, 'last_error', null,
        'revision', coalesce((connection->>'revision')::integer, 0) + 1))
        on conflict (owner) do update set data = excluded.data;
      delete from dashboard_private.oauth_states where owner = account;
      return 'null'::jsonb;
    when 'update_connection' then
      if connection is null or (payload->>'expectedRevision' is not null and
        connection->>'revision' is distinct from payload->>'expectedRevision') or
        ((payload->>'requireRefresh')::boolean and connection->>'refresh_token' is null) then return 'false'::jsonb; end if;
      patch := payload->'patch';
      if patch is null or jsonb_typeof(patch) <> 'object' or exists (
        select 1 from jsonb_object_keys(patch) as k where k not in
          ('client_id', 'client_secret', 'refresh_token', 'config', 'connected_at', 'last_sync', 'last_error')
      ) or octet_length(patch::text) > 100000 then
        raise sqlstate 'PT400' using message = 'Invalid connection patch';
      end if;
      update dashboard_private.connections set data = data || patch || jsonb_build_object('revision',
        (connection->>'revision')::integer + case when coalesce((payload->>'bumpRevision')::boolean, true) then 1 else 0 end)
        where owner = account;
      return 'true'::jsonb;
    when 'disconnect' then
      if connection is null or connection->>'revision' is distinct from payload->>'expectedRevision' then return 'false'::jsonb; end if;
      update dashboard_private.connections set data = data || jsonb_build_object(
        'refresh_token', null, 'connected_at', null, 'last_error', null, 'revision', (connection->>'revision')::integer + 1)
        where owner = account;
      delete from dashboard_private.oauth_states where owner = account;
      return 'true'::jsonb;
    when 'save_oauth' then
      if connection is null or connection->>'revision' is distinct from payload->>'revision' then
        raise sqlstate 'PT409' using message = 'Connection revision changed';
      end if;
      insert into dashboard_private.oauth_states values (account, payload->>'hash', payload->>'verifier', now() + interval '10 minutes')
        on conflict (owner) do update set hash = excluded.hash, verifier = excluded.verifier, expires = excluded.expires;
      return 'null'::jsonb;
    when 'consume_oauth' then
      delete from dashboard_private.oauth_states where owner = account and hash = payload->>'hash' and expires > now()
        returning verifier into verifier_value;
      return case when verifier_value is null then 'null'::jsonb else jsonb_build_object('verifier', verifier_value) end;
    when 'claim_sync' then
      if exists (select 1 from dashboard_private.sync_locks where owner = account and expires > now()) then return 'false'::jsonb; end if;
      insert into dashboard_private.sync_locks values (account, payload->>'token', now() + interval '10 minutes')
        on conflict (owner) do update set token = excluded.token, expires = excluded.expires;
      return 'true'::jsonb;
    when 'release_sync' then
      delete from dashboard_private.sync_locks where owner = account and token = payload->>'token';
      return 'null'::jsonb;
    else raise sqlstate 'PT400' using message = 'Unsupported operation';
  end case;
end;
$$;
revoke all on function public.dashboard_operation(text, jsonb) from public, anon;
grant execute on function public.dashboard_operation(text, jsonb) to authenticated;
commit;
