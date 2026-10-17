-- Tylko projekt osa-proof. Tabela nie jest dostępna dla anon/authenticated.
create table if not exists public.osa_runtime_records (
  namespace text not null,
  scope text not null,
  kind text not null check (kind in ('executions','missions','provider_connections')),
  record_id text not null,
  revision integer not null check (revision > 0),
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (namespace,scope,kind,record_id),
  check (octet_length(payload::text) <= 512000)
);
alter table public.osa_runtime_records enable row level security;
revoke all on public.osa_runtime_records from public,anon,authenticated;
grant select,insert,update,delete on public.osa_runtime_records to service_role;
