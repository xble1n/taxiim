-- Where the car was when kilometres were last added. Distance is counted from here once the
-- car has moved further than GPS noise, so a parked phone adds no phantom kilometres.
alter table staff add column if not exists km_lat double precision;
alter table staff add column if not exists km_lng double precision;
