-- When the driver last switched online. A shift stays locked online for 16 hours
-- from this moment (see SHIFT_LOCK_HOURS in src/lib/taxi/logic.ts).
alter table staff add column if not exists online_since timestamptz;
