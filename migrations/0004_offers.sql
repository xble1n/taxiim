create table if not exists order_offers (
  order_id text not null references orders (id) on delete cascade,
  driver_id text not null references staff (id) on delete cascade,
  response text not null default 'OFFERED' check (response in ('OFFERED', 'DECLINED', 'ACCEPTED')),
  responded_at timestamptz,
  primary key (order_id, driver_id)
);

create index if not exists order_offers_driver_idx on order_offers (driver_id, response);
