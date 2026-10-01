-- Taxi IM operational schema. Identity lives in the Better Auth tables.

create table if not exists staff (
  id text primary key,
  user_id text unique,
  role text not null check (role in ('ADMIN', 'DRIVER')),
  name text not null,
  email text not null,
  phone text not null default '',
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'DISABLED')),
  deleted_at timestamptz,
  driver_code text,
  vehicle text not null default '',
  plate text not null default '',
  presence text not null default 'OFFLINE' check (presence in ('OFFLINE', 'ONLINE', 'ON_RIDE')),
  latitude double precision,
  longitude double precision,
  accuracy_m double precision,
  speed_kmh double precision,
  last_gps_at timestamptz,
  prev_lat double precision,
  prev_lng double precision,
  prev_gps_at timestamptz,
  simulated boolean not null default false,
  track jsonb,
  sim_cursor integer not null default 0,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists staff_email_active_idx
  on staff (lower(email))
  where deleted_at is null;

create unique index if not exists staff_driver_code_idx
  on staff (driver_code)
  where driver_code is not null and deleted_at is null;

create index if not exists staff_role_idx on staff (role) where deleted_at is null;
create index if not exists staff_presence_idx on staff (presence);

create table if not exists driver_daily_km (
  driver_id text not null references staff (id) on delete cascade,
  km_date date not null,
  kilometers double precision not null default 0,
  primary key (driver_id, km_date)
);

create table if not exists destination_prices (
  id text primary key,
  name text not null,
  base_price numeric(10, 2) not null,
  per_km numeric(10, 2) not null default 0,
  per_min numeric(10, 2) not null default 0,
  latitude double precision,
  longitude double precision,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists destination_prices_name_idx
  on destination_prices (lower(name));

create table if not exists orders (
  id text primary key,
  code text not null unique,
  status text not null check (status in (
    'PENDING', 'DISPATCHED', 'ACCEPTED', 'DECLINED',
    'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'
  )),
  driver_id text references staff (id),
  created_by text references staff (id),
  pickup_label text not null,
  pickup_lat double precision not null,
  pickup_lng double precision not null,
  dest_label text not null,
  dest_lat double precision not null,
  dest_lng double precision not null,
  notes text not null default '',
  price_eur numeric(10, 2),
  price_id text references destination_prices (id) on delete set null,
  distance_km double precision,
  duration_min double precision,
  route jsonb,
  alternatives jsonb,
  created_at timestamptz not null default now(),
  dispatched_at timestamptz,
  accepted_at timestamptz,
  arrived_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists orders_status_idx on orders (status);
create index if not exists orders_driver_idx on orders (driver_id);
create index if not exists orders_created_idx on orders (created_at desc);

create table if not exists gps_logs (
  id bigserial primary key,
  driver_id text not null references staff (id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  accuracy_m double precision,
  speed_kmh double precision,
  recorded_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists gps_logs_driver_time_idx
  on gps_logs (driver_id, recorded_at desc);

create table if not exists chat_messages (
  id text primary key,
  sender_id text not null references staff (id),
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_created_idx
  on chat_messages (created_at desc);

create table if not exists alerts (
  id text primary key,
  type text not null check (type in (
    'RING', 'SPEED', 'GPS_STALE', 'PRESENCE', 'DISPATCH', 'ORDER', 'SYSTEM'
  )),
  driver_id text references staff (id) on delete cascade,
  actor_id text references staff (id),
  title text not null,
  body text not null,
  acknowledged boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists alerts_created_idx on alerts (created_at desc);
create index if not exists alerts_driver_idx on alerts (driver_id, acknowledged);

create table if not exists activity_log (
  id text primary key,
  event_type text not null,
  actor_id text,
  actor_name text,
  description text not null,
  entity_type text,
  entity_id text,
  created_at timestamptz not null default now()
);

create index if not exists activity_log_created_idx
  on activity_log (created_at desc);

create table if not exists system_settings (
  key text primary key,
  value text not null
);

insert into system_settings (key, value) values
  ('company_name', 'TAXI IM'),
  ('stale_seconds', '90'),
  ('speed_alert_kmh', '120'),
  ('base_lat', '42.8228'),
  ('base_lng', '20.9653'),
  ('base_label', 'Rruga Hasan Prishtina, Vushtrri')
on conflict (key) do nothing;

insert into destination_prices
  (id, name, base_price, per_km, per_min, latitude, longitude, enabled)
values
  ('price-prishtina', 'Prishtina', 12.00, 0, 0, 42.6629, 21.1655, true),
  ('price-peje', 'Pejë', 25.00, 0, 0, 42.6593, 20.2883, true),
  ('price-gjakove', 'Gjakovë', 28.00, 0, 0, 42.3803, 20.4308, true),
  ('price-gjilan', 'Gjilan', 22.00, 0, 0, 42.4635, 21.4694, true),
  ('price-airport', 'Airport', 18.00, 0, 0, 42.5728, 21.0358, true),
  ('price-fushe', 'Fushë Kosovë', 14.00, 0, 0, 42.6369, 21.0961, true)
on conflict (id) do nothing;
