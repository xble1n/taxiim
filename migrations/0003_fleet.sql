-- Fleet assets, fuel fills, and maintenance. GPS distance stays on driver_daily_km.

alter table alerts drop constraint if exists alerts_type_check;
alter table alerts add constraint alerts_type_check check (type in (
  'RING', 'SPEED', 'GPS_STALE', 'PRESENCE', 'DISPATCH', 'ORDER', 'SYSTEM',
  'FUEL', 'MAINTENANCE', 'DOCUMENT'
));

alter table destination_prices add column if not exists min_fare numeric(10, 2) not null default 0;

alter table gps_logs add column if not exists heading double precision;
alter table gps_logs add column if not exists altitude_m double precision;

create table if not exists vehicles (
  id text primary key,
  code text not null,
  brand text not null,
  model text not null,
  year integer,
  plate text not null,
  color text not null default '',
  fuel_type text not null default 'PETROL' check (fuel_type in ('PETROL', 'DIESEL', 'LPG', 'HYBRID', 'ELECTRIC')),
  status text not null default 'AVAILABLE' check (status in ('AVAILABLE', 'ASSIGNED', 'ON_RIDE', 'MAINTENANCE', 'OUT_OF_SERVICE')),
  assigned_driver_id text references staff (id) on delete set null,
  odometer_km double precision not null default 0,
  insurance_expires date,
  registration_expires date,
  inspection_expires date,
  last_service_on date,
  next_service_on date,
  next_service_km double precision,
  notes text not null default '',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists vehicles_code_idx on vehicles (code) where deleted_at is null;
create unique index if not exists vehicles_plate_idx on vehicles (lower(plate)) where deleted_at is null;
create index if not exists vehicles_driver_idx on vehicles (assigned_driver_id) where deleted_at is null;

alter table staff add column if not exists vehicle_id text references vehicles (id) on delete set null;

create table if not exists fuel_records (
  id text primary key,
  vehicle_id text not null references vehicles (id),
  driver_id text references staff (id) on delete set null,
  filled_at timestamptz not null,
  fuel_type text not null,
  liters double precision not null check (liters > 0 and liters <= 200),
  price_per_liter numeric(10, 3) not null check (price_per_liter >= 0),
  total_cost numeric(10, 2) not null check (total_cost >= 0),
  station text not null default '',
  odometer_km double precision,
  full_tank boolean not null default true,
  reference_no text not null default '',
  notes text not null default '',
  created_by text references staff (id),
  created_at timestamptz not null default now()
);

create index if not exists fuel_vehicle_time_idx on fuel_records (vehicle_id, filled_at desc);

create table if not exists maintenance_records (
  id text primary key,
  vehicle_id text not null references vehicles (id),
  driver_id text references staff (id) on delete set null,
  serviced_on date not null,
  kind text not null,
  description text not null,
  supplier text not null default '',
  parts_cost numeric(10, 2) not null default 0 check (parts_cost >= 0),
  labor_cost numeric(10, 2) not null default 0 check (labor_cost >= 0),
  total_cost numeric(10, 2) not null check (total_cost >= 0),
  odometer_km double precision,
  next_service_on date,
  next_service_km double precision,
  reference_no text not null default '',
  notes text not null default '',
  status text not null default 'DONE' check (status in ('OPEN', 'DONE')),
  created_by text references staff (id),
  created_at timestamptz not null default now()
);

create index if not exists maintenance_vehicle_idx on maintenance_records (vehicle_id, serviced_on desc);

create table if not exists odometer_records (
  id text primary key,
  vehicle_id text not null references vehicles (id),
  driver_id text references staff (id) on delete set null,
  recorded_at timestamptz not null default now(),
  previous_km double precision not null,
  next_km double precision not null check (next_km >= 0),
  source text not null check (source in ('MANUAL', 'GPS', 'FUEL', 'SERVICE')),
  note text not null default '',
  actor_id text references staff (id)
);

create index if not exists odometer_vehicle_idx on odometer_records (vehicle_id, recorded_at desc);

insert into system_settings (key, value) values
  ('max_admins', '1'),
  ('service_warn_days', '14'),
  ('service_warn_km', '500'),
  ('fuel_high_l_per_100', '12')
on conflict (key) do nothing;
