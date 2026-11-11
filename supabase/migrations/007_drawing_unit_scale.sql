-- BIM-120: metres per drawing unit, taken from DXF $INSUNITS when the drawing
-- is processed. Used to compute the area of rooms the engineer draws or edits,
-- so it does not depend on rooms that can be deleted.
-- Drawings processed before this migration keep NULL here; the API reads
-- $INSUNITS from their source DXF on the first room create/edit and stores it
-- (without reprocessing, so existing rooms and manual edits are kept).
alter table public.drawings
  add column if not exists unit_scale_m numeric check (unit_scale_m > 0);
