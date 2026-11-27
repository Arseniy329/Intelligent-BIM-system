-- BIM-77: таблиця результатів перевірки відповідності нормам (findings)
-- та транзакційна функція replace_drawing_findings для атомарної заміни знімка.

create table if not exists public.findings (
  id uuid primary key default gen_random_uuid(),
  drawing_id uuid not null references public.drawings(id) on delete cascade,
  room_id text,
  device_id text,
  rule_id text,
  severity text not null check (
    severity in ('critical', 'warning', 'insufficient_data', 'rule_conflict')
  ),
  message text not null,
  document text,
  clause text,
  rule_status text check (
    rule_status is null or rule_status in ('verified', 'needs_review')
  ),
  conflict_details jsonb,
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_findings_drawing_id on public.findings(drawing_id);

alter table public.findings enable row level security;

revoke all on table public.findings from public, anon, authenticated;
grant select on table public.findings to authenticated;
grant all on table public.findings to service_role;

drop policy if exists "findings_own_or_admin" on public.findings;
drop policy if exists "findings_select_own_or_admin" on public.findings;
create policy "findings_select_own_or_admin"
on public.findings
for select
to authenticated
using (
  exists (
    select 1
    from public.drawings d
    where d.id = findings.drawing_id
      and (
        d.owner_id = auth.uid()
        or exists (
          select 1
          from public.profiles p
          where p.id = auth.uid()
            and p.role = 'admin'
        )
      )
  )
);

create or replace function public.replace_drawing_findings(
  p_drawing_id uuid,
  p_findings jsonb default '[]'::jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_drawing_id is null then
    raise exception 'p_drawing_id is required';
  end if;
  if jsonb_typeof(coalesce(p_findings, '[]'::jsonb)) <> 'array' then
    raise exception 'p_findings must be a JSON array';
  end if;

  delete from public.findings where drawing_id = p_drawing_id;

  insert into public.findings (
    id,
    drawing_id,
    room_id,
    device_id,
    rule_id,
    severity,
    message,
    document,
    clause,
    rule_status,
    conflict_details,
    details
  )
  select
    coalesce((item ->> 'id')::uuid, gen_random_uuid()),
    p_drawing_id,
    nullif(item ->> 'room_id', ''),
    nullif(item ->> 'device_id', ''),
    nullif(item ->> 'rule_id', ''),
    item ->> 'severity',
    item ->> 'message',
    item ->> 'document',
    item ->> 'clause',
    nullif(item ->> 'rule_status', ''),
    item -> 'conflict_details',
    item -> 'details'
  from jsonb_array_elements(coalesce(p_findings, '[]'::jsonb)) as item;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.replace_drawing_findings(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_drawing_findings(uuid, jsonb)
  to service_role;
