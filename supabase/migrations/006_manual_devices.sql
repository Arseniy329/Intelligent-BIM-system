-- BIM-120: engineers can add devices by hand; such devices have no placement rule.
alter table public.devices
  alter column rule_id drop not null;
