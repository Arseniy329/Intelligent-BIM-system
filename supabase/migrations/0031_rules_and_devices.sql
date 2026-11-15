create extension if not exists "uuid-ossp";

create table if not exists public.rules (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  document text,
  clause text,
  conditions jsonb not null default '{}',
  threshold numeric not null check (threshold > 0),
  status text not null default 'needs_review',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rules
  add column if not exists document text,
  add column if not exists clause text,
  add column if not exists conditions jsonb not null default '{}',
  add column if not exists threshold numeric default 9 check (threshold > 0),
  add column if not exists status text not null default 'needs_review',
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.devices (
  id uuid primary key default uuid_generate_v4(),
  rule_id uuid not null references public.rules(id) on delete cascade,
  x numeric not null,
  y numeric not null,
  room_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_rules_threshold on public.rules(threshold);
create index if not exists idx_devices_rule_id on public.devices(rule_id);
