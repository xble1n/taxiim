import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { dbSource, getSql, type Sql } from "@/lib/db";
import {
  ACTIVE_STATUSES,
  MAX_ADMINS,
  MAX_DRIVERS,
  type AccountStatus,
  type ActivityDto,
  type AlertDto,
  type ApiFailure,
  type ChatDto,
  type LatLng,
  type OrderAction,
  type OrderDto,
  type OrderStatus,
  type Presence,
  type PriceDto,
  type Role,
  type RouteResult,
  type RouteStep,
  type StaffDto,
  actionAllowedFor,
  assessGps,
  canCreateAccount,
  fail,
  haversineMeters,
  interpolate,
  isOrderStatus,
  isValidCoord,
  nextDriverCode,
  nextStatus,
  normalizeEmail,
  quoteEuros,
  round2,
  sanitizeChat,
  validatePassword,
  validatePrice,
} from "./logic";

const DEMO_PASSWORD = "Fleet-demo-26";
const OWNER_EMAIL = "bledionberani@gmail.com";
const OWNER_NAME = "Bledion Berani";
const OWNER_PASSWORD = "235235.BB";
const ZONE = "Europe/Belgrade";
const passwordHashes = new Map<string, Promise<string>>();

function sharedPasswordHash(password: string) {
  let pending = passwordHashes.get(password);
  if (!pending) {
    pending = hashPassword(password);
    passwordHashes.set(password, pending);
  }
  return pending;
}

type StaffRow = {
  id: string;
  user_id: string | null;
  role: Role;
  name: string;
  email: string;
  phone: string;
  status: AccountStatus;
  deleted_at: string | Date | null;
  driver_code: string | null;
  vehicle: string;
  plate: string;
  presence: Presence;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  speed_kmh: number | null;
  last_gps_at: string | Date | null;
  prev_lat: number | null;
  prev_lng: number | null;
  prev_gps_at: string | Date | null;
  simulated: boolean;
  track: unknown;
  sim_cursor: number | null;
  last_seen_at: string | Date | null;
  today_km?: number | string | null;
  yesterday_km?: number | string | null;
  week_km?: number | string | null;
  month_km?: number | string | null;
  heading?: number | null;
  vehicle_fuel?: string | null;
  vehicle_odo?: number | string | null;
  vehicle_status?: string | null;
};

type Access =
  | { success: true; access: "ok"; staff: StaffRow; settings: Settings }
  | { success: true; access: "none"; message: string }
  | { success: true; access: "disabled"; message: string };

type Settings = {
  companyName: string;
  staleSeconds: number;
  speedAlertKmh: number;
  baseLat: number;
  baseLng: number;
  baseLabel: string;
  maxAdmins: number;
  companyPhone: string;
  fuelHigh: number;
  serviceWarnDays: number;
  startFare: number;
  perKmRate: number;
};

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function iso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? v : d.toISOString();
  }
  return null;
}

function asBool(v: unknown): boolean {
  return v === true || v === "t" || v === "true" || v === 1;
}

function parsePoints(v: unknown): LatLng[] | null {
  try {
    const raw = typeof v === "string" ? JSON.parse(v) : v;
    if (!Array.isArray(raw)) return null;
    const pts: LatLng[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const lat = num((item as { lat?: unknown }).lat);
      const lng = num((item as { lng?: unknown }).lng);
      if (lat == null || lng == null || !isValidCoord(lat, lng)) continue;
      pts.push({ lat, lng });
    }
    return pts.length >= 2 ? pts : null;
  } catch {
    return null;
  }
}

function parseAlt(v: unknown): LatLng[][] | null {
  try {
    const raw = typeof v === "string" ? JSON.parse(v) : v;
    if (!Array.isArray(raw)) return null;
    const lines = raw
      .map((line) => parsePoints(line))
      .filter((line): line is LatLng[] => line != null);
    return lines.length ? lines : null;
  } catch {
    return null;
  }
}

function cleanText(raw: string, field: string, min: number, max: number): ApiFailure | { success: true; text: string } {
  const text = raw.replace(/<[^>]*>/g, "").replace(/[<>]/g, "").trim();
  if (text.length < min || text.length > max) {
    return fail(`${field} must be ${min}–${max} characters.`, "VALIDATION");
  }
  return { success: true, text };
}

function uniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === "23505" || /duplicate key|unique constraint/i.test(e?.message ?? "");
}

async function readSettings(sql: Sql): Promise<Settings> {
  const rows = await sql<{ key: string; value: string }>`select key, value from system_settings`;
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    companyName: map.company_name || "TAXI IM",
    staleSeconds: Number(map.stale_seconds) || 90,
    speedAlertKmh: Number(map.speed_alert_kmh) || 120,
    baseLat: Number(map.base_lat) || 42.8228,
    baseLng: Number(map.base_lng) || 20.9653,
    baseLabel: map.base_label || "Rruga Hasan Prishtina, Vushtrri",
    maxAdmins: Math.max(1, Number(map.max_admins) || MAX_ADMINS),
    companyPhone: (map.company_phone ?? "").slice(0, 40),
    fuelHigh: Math.min(40, Math.max(4, Number(map.fuel_high_l_per_100) || 12)),
    serviceWarnDays: Math.min(90, Math.max(1, Math.round(Number(map.service_warn_days) || 14))),
    startFare: Number.isFinite(Number(map.start_fare)) ? Number(map.start_fare) : 2,
    perKmRate: Number.isFinite(Number(map.meter_per_km)) ? Number(map.meter_per_km) : 0.82,
  };
}

const STAFF_SELECT = `
  select s.*, coalesce(k.kilometers, 0) as today_km,
         coalesce(y.kilometers, 0) as yesterday_km,
         coalesce(w.kilometers, 0) as week_km,
         coalesce(m.kilometers, 0) as month_km,
         v.fuel_type as vehicle_fuel,
         v.odometer_km as vehicle_odo,
         v.status as vehicle_status
  from staff s
  left join driver_daily_km k
    on k.driver_id = s.id
   and k.km_date = (now() at time zone '${ZONE}')::date
  left join driver_daily_km y
    on y.driver_id = s.id
   and y.km_date = ((now() at time zone '${ZONE}')::date - 1)
  left join lateral (
    select coalesce(sum(kilometers), 0) as kilometers
    from driver_daily_km
    where driver_id = s.id
      and km_date >= ((now() at time zone '${ZONE}')::date - 6)
  ) w on true
  left join lateral (
    select coalesce(sum(kilometers), 0) as kilometers
    from driver_daily_km
    where driver_id = s.id
      and km_date >= date_trunc('month', (now() at time zone '${ZONE}'))::date
  ) m on true
  left join vehicles v on v.id = s.vehicle_id and v.deleted_at is null
`;

async function staffByUser(sql: Sql, userId: string): Promise<StaffRow | null> {
  const rows = await sql.query<StaffRow>(`${STAFF_SELECT} where s.user_id = $1 limit 1`, [userId]);
  return rows[0] ?? null;
}

async function staffById(sql: Sql, id: string): Promise<StaffRow | null> {
  const rows = await sql.query<StaffRow>(`${STAFF_SELECT} where s.id = $1 limit 1`, [id]);
  return rows[0] ?? null;
}

function toStaff(row: StaffRow, staleSeconds: number): StaffDto {
  const last = iso(row.last_gps_at);
  const presence = row.presence;
  let gpsStale = false;
  if (presence !== "OFFLINE" && !asBool(row.simulated)) {
    gpsStale = !last || Date.now() - new Date(last).getTime() > staleSeconds * 1000;
  }
  return {
    id: row.id,
    role: row.role,
    name: row.name,
    email: row.email,
    phone: row.phone ?? "",
    status: row.status,
    deleted: row.deleted_at != null,
    driverCode: row.driver_code,
    vehicle: row.vehicle ?? "",
    plate: row.plate ?? "",
    presence,
    latitude: num(row.latitude),
    longitude: num(row.longitude),
    accuracyM: num(row.accuracy_m),
    speedKmh: num(row.speed_kmh),
    lastGpsAt: last,
    todayKm: round2(num(row.today_km) ?? 0),
    yesterdayKm: round2(num(row.yesterday_km) ?? 0),
    weekKm: round2(num(row.week_km) ?? 0),
    monthKm: round2(num(row.month_km) ?? 0),
    heading: num(row.heading),
    simulated: asBool(row.simulated),
    gpsStale,
    vehicleFuel: row.vehicle_fuel ?? null,
    vehicleOdometer: num(row.vehicle_odo),
    vehicleStatus: row.vehicle_status ?? null,
  };
}

async function logActivity(
  sql: Sql,
  event: {
    type: string;
    actorId?: string | null;
    actorName?: string | null;
    description: string;
    entityType?: string | null;
    entityId?: string | null;
  },
) {
  await sql`
    insert into activity_log (id, event_type, actor_id, actor_name, description, entity_type, entity_id)
    values (
      ${randomUUID()},
      ${event.type},
      ${event.actorId ?? null},
      ${event.actorName ?? null},
      ${event.description},
      ${event.entityType ?? null},
      ${event.entityId ?? null}
    )
  `;
}

async function addAlert(
  sql: Sql,
  alert: {
    type: string;
    driverId?: string | null;
    actorId?: string | null;
    title: string;
    body: string;
  },
) {
  await sql`
    insert into alerts (id, type, driver_id, actor_id, title, body)
    values (
      ${randomUUID()},
      ${alert.type},
      ${alert.driverId ?? null},
      ${alert.actorId ?? null},
      ${alert.title},
      ${alert.body}
    )
  `;
}

async function addKm(sql: Sql, driverId: string, km: number) {
  if (km <= 0) return;
  await sql`
    insert into driver_daily_km (driver_id, km_date, kilometers)
    values (${driverId}, (now() at time zone ${ZONE})::date, ${km})
    on conflict (driver_id, km_date)
    do update set kilometers = driver_daily_km.kilometers + excluded.kilometers
  `;
  await sql`
    update vehicles
    set odometer_km = odometer_km + ${km}, updated_at = now()
    where assigned_driver_id = ${driverId} and deleted_at is null
  `;
}

async function countRole(sql: Sql, role: Role): Promise<number> {
  const rows = await sql<{ n: number }>`
    select count(*)::int as n from staff where role = ${role} and deleted_at is null
  `;
  return rows[0]?.n ?? 0;
}

async function createCredentialUser(sql: Sql, name: string, email: string, password: string) {
  const userId = randomUUID();
  const hash = await sharedPasswordHash(password);
  const now = new Date().toISOString();
  await sql`
    insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
    values (${userId}, ${name}, ${email}, true, ${now}, ${now})
  `;
  await sql`
    insert into "account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
    values (${randomUUID()}, ${userId}, 'credential', ${userId}, ${hash}, ${now}, ${now})
  `;
  return userId;
}

async function setCredentialPassword(sql: Sql, userId: string, password: string) {
  const hash = await sharedPasswordHash(password);
  const now = new Date().toISOString();
  const creds = await sql<{ id: string }>`
    select "id" from "account" where "userId" = ${userId} and "providerId" = 'credential' limit 1
  `;
  if (creds[0]) {
    await sql`update "account" set "password" = ${hash}, "updatedAt" = ${now} where "id" = ${creds[0].id}`;
    return;
  }
  await sql`
    insert into "account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
    values (${randomUUID()}, ${userId}, 'credential', ${userId}, ${hash}, ${now}, ${now})
  `;
}

async function ensureFixedSeedPrices(sql: Sql) {
  const flag = await sql<{ value: string }>`select value from system_settings where key = 'fixed_seed_prices_v1' limit 1`;
  if (flag[0]?.value === "1") return;
  await sql`
    update destination_prices set per_km = 0, per_min = 0
    where (id = 'price-prishtina' and per_km = 0.80 and per_min = 0.15)
       or (id = 'price-peje' and per_km = 0.70 and per_min = 0.10)
       or (id = 'price-gjakove' and per_km = 0.70 and per_min = 0.10)
       or (id = 'price-gjilan' and per_km = 0.75 and per_min = 0.12)
       or (id = 'price-airport' and per_km = 0.85 and per_min = 0.15)
       or (id = 'price-fushe' and per_km = 0.80 and per_min = 0.12)
  `;
  await sql`
    insert into system_settings (key, value) values ('fixed_seed_prices_v1', '1')
    on conflict (key) do update set value = excluded.value
  `;
}

async function ensureCompanyBase(sql: Sql) {
  const flag = await sql<{ value: string }>`select value from system_settings where key = 'base_vushtrri_v1' limit 1`;
  if (flag[0]?.value === "1") return;
  const rows = await sql<{ key: string; value: string }>`
    select key, value from system_settings where key in ('base_label', 'base_lat')
  `;
  const label = rows.find((row) => row.key === "base_label")?.value ?? "";
  const lat = rows.find((row) => row.key === "base_lat")?.value ?? "";
  const untouched = label === "" || label === "Mitrovicë" || lat === "42.8914" || lat.startsWith("42.8914");
  if (untouched) {
    const pairs: Array<[string, string]> = [
      ["base_label", "Rruga Hasan Prishtina, Vushtrri"],
      ["base_lat", "42.8228"],
      ["base_lng", "20.9653"],
    ];
    for (const [key, value] of pairs) {
      await sql`
        insert into system_settings (key, value) values (${key}, ${value})
        on conflict (key) do update set value = excluded.value
      `;
    }
  }
  await sql`
    insert into system_settings (key, value) values ('base_vushtrri_v1', '1')
    on conflict (key) do update set value = excluded.value
  `;
}

async function ensureRealGps(sql: Sql) {
  await sql`alter table staff add column if not exists heading double precision`;
  await sql`
    update alerts
    set title = 'Live GPS',
        body = 'Driver positions come from the phone. A car appears after that driver goes online and allows location.'
    where title = 'Simulated fleet'
  `;
  const flag = await sql<{ value: string }>`select value from system_settings where key = 'real_gps_v1' limit 1`;
  if (flag[0]?.value === "1") return;
  await sql`
    delete from gps_logs
    where driver_id in (select id from staff where simulated = true)
  `;
  await sql`
    delete from driver_daily_km
    where driver_id in (select id from staff where simulated = true)
  `;
  await sql`
    update staff set
      simulated = false,
      track = null,
      sim_cursor = 0,
      latitude = null,
      longitude = null,
      prev_lat = null,
      prev_lng = null,
      prev_gps_at = null,
      speed_kmh = null,
      accuracy_m = null,
      heading = null,
      last_gps_at = null,
      presence = 'OFFLINE',
      updated_at = now()
    where simulated = true
  `;
  await sql`
    insert into system_settings (key, value) values ('real_gps_v1', '1')
    on conflict (key) do update set value = excluded.value
  `;
}

async function ensureCityFares(sql: Sql) {
  const flag = await sql<{ value: string }>`select value from system_settings where key = 'city_fares_v1' limit 1`;
  if (flag[0]?.value === "1") return;
  const rows = await sql<{ id: string; name: string; base_price: number | string }>`
    select id, name, base_price from destination_prices
  `;
  const hasMitro = rows.some((row) => /^mitrovic/i.test(row.name));
  if (!hasMitro) {
    await sql`
      insert into destination_prices (id, name, base_price, per_km, per_min, min_fare, latitude, longitude, enabled)
      values ('price-mitrovica', 'Mitrovica', 9, 0, 0, 0, 42.8914, 20.866, true)
      on conflict (id) do nothing
    `;
  }
  const prishtina = rows.find((row) => /^prishtin/i.test(row.name));
  if (!prishtina) {
    await sql`
      insert into destination_prices (id, name, base_price, per_km, per_min, min_fare, latitude, longitude, enabled)
      values ('price-prishtina', 'Prishtina', 25, 0, 0, 0, 42.6629, 21.1655, true)
      on conflict (id) do nothing
    `;
  } else if (Math.abs(Number(prishtina.base_price) - 12) < 0.001) {
    await sql`
      update destination_prices
      set base_price = 25, per_km = 0, per_min = 0, min_fare = 0
      where id = ${prishtina.id}
    `;
  }
  await sql`
    insert into system_settings (key, value) values ('start_fare', '2')
    on conflict (key) do nothing
  `;
  await sql`
    insert into system_settings (key, value) values ('meter_per_km', '0.82')
    on conflict (key) do nothing
  `;
  await sql`
    insert into system_settings (key, value) values ('city_fares_v1', '1')
    on conflict (key) do update set value = excluded.value
  `;
}

async function ensureOrderFlow(sql: Sql) {
  await sql`alter table orders add column if not exists source text not null default 'DISPATCH'`;
  await sql`alter table orders add column if not exists arrived_lat double precision`;
  await sql`alter table orders add column if not exists arrived_lng double precision`;
  const flag = await sql<{ value: string }>`select value from system_settings where key = 'order_flow_v1' limit 1`;
  if (flag[0]?.value === "1") return;
  const constraints = await sql<{ conname: string }>`
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'orders' and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%DISPATCHED%'
  `;
  for (const constraint of constraints) {
    if (!/^[a-zA-Z0-9_]+$/.test(constraint.conname)) continue;
    await sql.query(`alter table orders drop constraint ${constraint.conname}`);
  }
  await sql`
    alter table orders add constraint orders_status_check check (status in (
      'PENDING', 'DISPATCHED', 'ACCEPTED', 'ON_THE_WAY', 'DECLINED',
      'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'
    ))
  `;
  await sql`
    insert into system_settings (key, value) values ('order_flow_v1', '1')
    on conflict (key) do update set value = excluded.value
  `;
}

async function ensureDriverLogins(sql: Sql) {
  const flag = await sql<{ value: string }>`select value from system_settings where key = 'driver_login_v1' limit 1`;
  const sync = flag[0]?.value !== "1";
  for (const d of ROSTER) {
    const users = await sql<{ id: string }>`
      select "id" from "user" where lower("email") = ${d.email} limit 1
    `;
    let userId = users[0]?.id;
    if (!userId) {
      userId = await createCredentialUser(sql, d.name, d.email, DEMO_PASSWORD);
    } else if (sync) {
      await sql`
        update "user" set "name" = ${d.name}, "emailVerified" = true, "updatedAt" = ${new Date().toISOString()}
        where "id" = ${userId}
      `;
      await setCredentialPassword(sql, userId, DEMO_PASSWORD);
    }
    const staff = await sql<{ id: string }>`
      select id from staff
      where deleted_at is null and (user_id = ${userId} or lower(email) = ${d.email})
      limit 1
    `;
    if (!staff[0]) {
      await sql`
        insert into staff (id, user_id, role, name, email, phone, status, driver_code, vehicle, plate, presence)
        values (${d.id}, ${userId}, 'DRIVER', ${d.name}, ${d.email}, '', 'ACTIVE', ${d.code}, ${d.vehicle}, ${d.plate}, 'OFFLINE')
        on conflict (id) do update set
          user_id = excluded.user_id,
          name = excluded.name,
          email = excluded.email,
          driver_code = excluded.driver_code,
          vehicle = excluded.vehicle,
          plate = excluded.plate,
          status = 'ACTIVE',
          deleted_at = null,
          updated_at = now()
      `;
    }
  }
  if (dbSource !== "pglite") await seedFleetVehicles(sql);
  await sql`
    insert into system_settings (key, value) values ('driver_login_v1', '1')
    on conflict (key) do update set value = '1'
  `;
}

export async function prepareSignIn() {
  const sql = await getSql();
  await ensureOwnerAdmin(sql);
  if (dbSource === "pglite") {
    const admin = await sql<{ id: string; name: string }>`
      select id, name from staff where role = 'ADMIN' and deleted_at is null order by created_at asc limit 1
    `;
    if (admin[0]) await ensureRoster(sql, admin[0].id, admin[0].name);
  }
  await ensureDriverLogins(sql);
  await ensureFixedSeedPrices(sql);
  await ensureCompanyBase(sql);
  await ensureRealGps(sql);
  await ensureCityFares(sql);
  await ensureOrderFlow(sql);
}

async function ensureOwnerAdmin(sql: Sql) {
  const g = globalThis as { __taxiOwnerAdmin?: Promise<void> };
  g.__taxiOwnerAdmin ??= seedOwnerAdmin(sql).catch((err) => {
    g.__taxiOwnerAdmin = undefined;
    throw err;
  });
  return g.__taxiOwnerAdmin;
}

async function seedOwnerAdmin(sql: Sql) {
  const flag = await sql<{ value: string }>`
    select value from system_settings where key = 'owner_bledion_v1' limit 1
  `;
  if (flag[0]?.value === "1") return;
  const hash = await sharedPasswordHash(OWNER_PASSWORD);
  const now = new Date().toISOString();
  const users = await sql<{ id: string }>`
    select "id" from "user" where lower("email") = ${OWNER_EMAIL} limit 1
  `;
  let userId = users[0]?.id;
  if (!userId) {
    userId = await createCredentialUser(sql, OWNER_NAME, OWNER_EMAIL, OWNER_PASSWORD);
  } else {
    await sql`
      update "user" set "name" = ${OWNER_NAME}, "emailVerified" = true, "updatedAt" = ${now}
      where "id" = ${userId}
    `;
    const creds = await sql<{ id: string }>`
      select "id" from "account" where "userId" = ${userId} and "providerId" = 'credential' limit 1
    `;
    if (creds[0]) {
      await sql`
        update "account" set "password" = ${hash}, "updatedAt" = ${now} where "id" = ${creds[0].id}
      `;
    } else {
      await sql`
        insert into "account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
        values (${randomUUID()}, ${userId}, 'credential', ${userId}, ${hash}, ${now}, ${now})
      `;
    }
  }
  const staff = await sql<{ id: string }>`
    select id from staff
    where user_id = ${userId} or (lower(email) = ${OWNER_EMAIL} and deleted_at is null)
    limit 1
  `;
  if (!staff[0]) {
    await sql`
      insert into staff (id, user_id, role, name, email, phone, status, presence)
      values (${userId}, ${userId}, 'ADMIN', ${OWNER_NAME}, ${OWNER_EMAIL}, '', 'ACTIVE', 'OFFLINE')
    `;
    await logActivity(sql, {
      type: "ACCOUNT_CREATED",
      actorId: userId,
      actorName: OWNER_NAME,
      description: `${OWNER_NAME} is the administrator`,
      entityType: "staff",
      entityId: userId,
    });
  } else {
    await sql`
      update staff set
        user_id = ${userId},
        role = 'ADMIN',
        name = ${OWNER_NAME},
        email = ${OWNER_EMAIL},
        status = 'ACTIVE',
        deleted_at = null,
        updated_at = now()
      where id = ${staff[0].id}
    `;
  }
  const admins = await countRole(sql, "ADMIN");
  const cap = String(Math.max(admins, 2));
  await sql`
    insert into system_settings (key, value) values ('max_admins', ${cap})
    on conflict (key) do update set value = ${cap}
  `;
  await sql`
    insert into system_settings (key, value) values ('owner_bledion_v1', '1')
    on conflict (key) do update set value = '1'
  `;
}

async function seedDemo(sql: Sql, adminId: string, adminName: string) {
  const existing = await countRole(sql, "DRIVER");
  if (existing > 0) return;
  const demos: Array<{
    id: string;
    name: string;
    email: string;
    phone: string;
    code: string;
    vehicle: string;
    plate: string;
    presence: Presence;
    lat: number;
    lng: number;
    speed: number;
    km: number;
    yesterdayKm?: number;
    gpsAge: string;
  }> = [
    { id: "demo-ardit", name: "Gazmend Ferizi", email: "gazmend@taxiim.local", phone: "", code: "D-01", vehicle: "Skoda Fabia", plate: "02-101-GF", presence: "ONLINE", lat: 42.8914, lng: 20.866, speed: 34, km: 22.4, gpsAge: "0 seconds" },
    { id: "demo-besnik", name: "Florim Ferizi", email: "florim@taxiim.local", phone: "", code: "D-02", vehicle: "Mercedes Vito", plate: "02-214-FF", presence: "ON_RIDE", lat: 42.78, lng: 20.98, speed: 48, km: 41.2, gpsAge: "0 seconds" },
    { id: "demo-driton", name: "Altin Berisha", email: "altin@taxiim.local", phone: "", code: "D-03", vehicle: "Skoda Octavia", plate: "01-330-AB", presence: "ONLINE", lat: 42.6629, lng: 21.1655, speed: 22, km: 15.8, gpsAge: "0 seconds" },
    { id: "demo-elton", name: "Liridon Shala", email: "liridon@taxiim.local", phone: "", code: "D-04", vehicle: "Toyota Corolla", plate: "04-118-LS", presence: "OFFLINE", lat: 42.6593, lng: 20.2883, speed: 0, km: 0, yesterdayKm: 36.2, gpsAge: "3 hours" },
    { id: "demo-gent", name: "Almedin", email: "almedin@taxiim.local", phone: "", code: "D-05", vehicle: "Ford Transit", plate: "02-405-AL", presence: "ONLINE", lat: 42.5728, lng: 21.0358, speed: 41, km: 12.6, gpsAge: "0 seconds" },
  ];

  for (const d of demos) {
    try {
      const userId = await createCredentialUser(sql, d.name, d.email, DEMO_PASSWORD);
      await sql`
        insert into staff (
          id, user_id, role, name, email, phone, status, driver_code, vehicle, plate,
          presence, simulated
        ) values (
          ${d.id}, ${userId}, 'DRIVER', ${d.name}, ${d.email}, ${d.phone}, 'ACTIVE', ${d.code},
          ${d.vehicle}, ${d.plate}, 'OFFLINE', false
        )
      `;
    } catch (err) {
      console.error("[taxi] demo driver seed failed", d.email, err instanceof Error ? err.message : err);
    }
  }

  const prishtina = { lat: 42.6629, lng: 21.1655 };
  const fushe = { lat: 42.6369, lng: 21.0961 };
  const airport = { lat: 42.5728, lng: 21.0358 };
  const peje = { lat: 42.6593, lng: 20.2883 };
  const gjakove = { lat: 42.3803, lng: 20.4308 };
  const ride = interpolate({ lat: 42.78, lng: 20.98 }, prishtina, 10);
  const hop = interpolate(fushe, airport, 8);

  await sql`
    insert into orders (
      id, code, status, driver_id, created_by, pickup_label, pickup_lat, pickup_lng,
      dest_label, dest_lat, dest_lng, notes, price_eur, price_id, distance_km, duration_min,
      route, created_at, dispatched_at, accepted_at, arrived_at, started_at
    ) values (
      'ord-demo-ride', 'IM-2041', 'IN_PROGRESS', 'demo-besnik', ${adminId},
      'Mitrovicë center', 42.8914, 20.866,
      'Prishtina', ${prishtina.lat}, ${prishtina.lng},
      'Hotel pickup, two passengers', 28.50, 'price-prishtina', 36.4, 44,
      ${JSON.stringify(ride)}::jsonb,
      now() - interval '50 minutes', now() - interval '50 minutes',
      now() - interval '46 minutes', now() - interval '28 minutes', now() - interval '26 minutes'
    )
  `;
  await sql`
    insert into orders (
      id, code, status, driver_id, created_by, pickup_label, pickup_lat, pickup_lng,
      dest_label, dest_lat, dest_lng, notes, price_eur, price_id, distance_km, duration_min,
      route, created_at, dispatched_at
    ) values (
      'ord-demo-dispatch', 'IM-2048', 'DISPATCHED', 'demo-ardit', ${adminId},
      'Fushë Kosovë', ${fushe.lat}, ${fushe.lng},
      'Airport', ${airport.lat}, ${airport.lng},
      'Flight departure 16:40', 18.00, 'price-airport', 9.6, 14,
      ${JSON.stringify(hop)}::jsonb,
      now() - interval '6 minutes', now() - interval '6 minutes'
    )
  `;
  await sql`
    insert into orders (
      id, code, status, driver_id, created_by, pickup_label, pickup_lat, pickup_lng,
      dest_label, dest_lat, dest_lng, notes, price_eur, price_id, distance_km, duration_min,
      created_at, dispatched_at, accepted_at, arrived_at, started_at, completed_at
    ) values (
      'ord-demo-done', 'IM-1988', 'COMPLETED', 'demo-elton', ${adminId},
      'Pejë', ${peje.lat}, ${peje.lng},
      'Gjakovë', ${gjakove.lat}, ${gjakove.lng},
      '', 50.40, 'price-gjakove', 32.0, 40,
      now() - interval '1 day', now() - interval '1 day',
      now() - interval '1 day' + interval '2 minutes',
      now() - interval '1 day' + interval '12 minutes',
      now() - interval '1 day' + interval '15 minutes',
      now() - interval '1 day' + interval '55 minutes'
    )
  `;
  await sql`
    insert into orders (
      id, code, status, driver_id, created_by, pickup_label, pickup_lat, pickup_lng,
      dest_label, dest_lat, dest_lng, notes, price_eur, distance_km, duration_min,
      created_at, dispatched_at, cancelled_at
    ) values (
      'ord-demo-cancel', 'IM-2033', 'CANCELLED', 'demo-gent', ${adminId},
      'Gjilan', 42.4635, 21.4694,
      'Prishtina', ${prishtina.lat}, ${prishtina.lng},
      'Passenger cancelled', 22.00, 42.0, 50,
      now() - interval '3 hours', now() - interval '3 hours', now() - interval '2 hours'
    )
  `;

  await sql`
    insert into chat_messages (id, sender_id, body, created_at) values
      ('chat-1', ${adminId}, 'Morning. Airport runs have priority until 17:00.', now() - interval '40 minutes'),
      ('chat-2', 'demo-besnik', 'Passenger is onboard. Heading to Prishtina.', now() - interval '25 minutes'),
      ('chat-3', 'demo-ardit', 'South of Mitrovicë. I can take the airport job.', now() - interval '8 minutes')
  `;
  await sql`
    insert into alerts (id, type, driver_id, actor_id, title, body, created_at) values
      (
        'alert-demo-system', 'SYSTEM', null, ${adminId},
        'Live GPS',
        'Driver positions come from the phone. A car appears after that driver goes online and allows location.',
        now() - interval '2 minutes'
      ),
      (
        'alert-demo-dispatch', 'DISPATCH', 'demo-ardit', ${adminId},
        'New dispatch IM-2048',
        'Fushë Kosovë to Airport.',
        now() - interval '6 minutes'
      )
  `;
  await logActivity(sql, {
    type: "ORDER_DISPATCHED",
    actorId: adminId,
    actorName: adminName,
    description: `${adminName} dispatched IM-2048 to Gazmend Ferizi`,
    entityType: "order",
    entityId: "ord-demo-dispatch",
  });
  await logActivity(sql, {
    type: "ORDER_STARTED",
    actorId: "demo-besnik",
    actorName: "Florim Ferizi",
    description: "Florim Ferizi started IM-2041",
    entityType: "order",
    entityId: "ord-demo-ride",
  });
  await logActivity(sql, {
    type: "DRIVER_ONLINE",
    actorId: "demo-driton",
    actorName: "Altin Berisha",
    description: "Altin Berisha is online",
    entityType: "staff",
    entityId: "demo-driton",
  });
}

const ROSTER = [
  { id: "demo-ardit", oldEmail: "ardit@example.com", name: "Gazmend Ferizi", email: "gazmend@taxiim.local", code: "D-01", vehicle: "Skoda Fabia", plate: "02-101-GF" },
  { id: "demo-besnik", oldEmail: "besnik@example.com", name: "Florim Ferizi", email: "florim@taxiim.local", code: "D-02", vehicle: "Mercedes Vito", plate: "02-214-FF" },
  { id: "demo-driton", oldEmail: "driton@example.com", name: "Altin Berisha", email: "altin@taxiim.local", code: "D-03", vehicle: "Skoda Octavia", plate: "01-330-AB" },
  { id: "demo-elton", oldEmail: "elton@example.com", name: "Liridon Shala", email: "liridon@taxiim.local", code: "D-04", vehicle: "Toyota Corolla", plate: "04-118-LS" },
  { id: "demo-gent", oldEmail: "gent@example.com", name: "Almedin", email: "almedin@taxiim.local", code: "D-05", vehicle: "Ford Transit", plate: "02-405-AL" },
] as const;

async function seedFleetVehicles(sql: Sql) {
  const cars = [
    { id: "veh-01", code: "VH-01", brand: "Skoda", model: "Fabia", year: 2018, plate: "02-101-GF", color: "White", fuel: "PETROL", driver: "demo-ardit", odo: 84210, ins: "2026-10-08", reg: "2027-03-01", insp: "2027-01-15", nextKm: 89000 },
    { id: "veh-02", code: "VH-02", brand: "Mercedes", model: "Vito", year: 2016, plate: "02-214-FF", color: "Silver", fuel: "DIESEL", driver: "demo-besnik", odo: 156430, ins: "2027-06-01", reg: "2027-06-01", insp: "2026-12-20", nextKm: 160000 },
    { id: "veh-03", code: "VH-03", brand: "Skoda", model: "Octavia", year: 2019, plate: "01-330-AB", color: "Grey", fuel: "PETROL", driver: "demo-driton", odo: 97340, ins: "2027-02-11", reg: "2027-02-11", insp: "2027-04-02", nextKm: 105000 },
    { id: "veh-04", code: "VH-04", brand: "Toyota", model: "Corolla", year: 2017, plate: "04-118-LS", color: "Black", fuel: "PETROL", driver: "demo-elton", odo: 121880, ins: "2027-08-19", reg: "2026-11-30", insp: "2027-05-09", nextKm: 125000 },
    { id: "veh-05", code: "VH-05", brand: "Ford", model: "Transit", year: 2015, plate: "02-405-AL", color: "White", fuel: "DIESEL", driver: "demo-gent", odo: 210450, ins: "2027-01-22", reg: "2027-01-22", insp: "2026-11-02", nextKm: 215000 },
  ];
  for (const car of cars) {
    const exists = await sql<{ id: string }>`select id from vehicles where id = ${car.id} limit 1`;
    if (!exists.length) {
      await sql`
        insert into vehicles (
          id, code, brand, model, year, plate, color, fuel_type, status, assigned_driver_id,
          odometer_km, insurance_expires, registration_expires, inspection_expires, next_service_km, notes
        ) values (
          ${car.id}, ${car.code}, ${car.brand}, ${car.model}, ${car.year}, ${car.plate}, ${car.color}, ${car.fuel},
          'ASSIGNED', ${car.driver}, ${car.odo}, ${car.ins}, ${car.reg}, ${car.insp}, ${car.nextKm},
          'Fleet vehicle. Documents are desk records, not a personal file.'
        )
      `;
    }
    await sql`
      update staff set vehicle_id = ${car.id}, vehicle = ${`${car.brand} ${car.model}`}, plate = ${car.plate}
      where id = ${car.driver} and deleted_at is null
    `;
  }
  const soon = await sql<{ id: string }>`select id from alerts where id = 'alert-ins-vh01' limit 1`;
  if (!soon.length) {
    await sql`
      insert into alerts (id, type, title, body, driver_id)
      values (
        'alert-ins-vh01', 'DOCUMENT',
        'Insurance expires soon',
        'Skoda Fabia 02-101-GF insurance expires on 8 Oct 2026.',
        'demo-ardit'
      )
    `;
  }
}

async function ensureRoster(sql: Sql, adminId: string | null, adminName: string) {
  if (dbSource !== "pglite") return;
  const flag = await sql<{ value: string }>`select value from system_settings where key = 'roster_v2'`;
  if (flag[0]?.value === "1") return;
  const legacy = await sql<{ id: string }>`
    select id from staff where lower(email) = 'ardit@example.com' and deleted_at is null limit 1
  `;
  if (legacy.length) {
    for (const d of ROSTER) {
      await sql`
        update staff set
          name = ${d.name}, email = ${d.email}, phone = '', driver_code = ${d.code},
          vehicle = ${d.vehicle}, plate = ${d.plate}, updated_at = now()
        where id = ${d.id}
      `;
      await sql`
        update "user" set name = ${d.name}, email = ${d.email}, "updatedAt" = now()
        where lower(email) = ${d.oldEmail}
      `;
    }
  } else if ((await countRole(sql, "DRIVER")) === 0 && adminId) {
    await seedDemo(sql, adminId, adminName);
  }
  await seedFleetVehicles(sql);
  await sql`
    insert into system_settings (key, value) values ('roster_v2', '1')
    on conflict (key) do update set value = '1'
  `;
}

async function touchSeen(sql: Sql, row: StaffRow) {
  const seen = iso(row.last_seen_at);
  const first = !seen || Date.now() - new Date(seen).getTime() > 12 * 60 * 60 * 1000;
  if (first) {
    await sql`update staff set last_seen_at = now(), updated_at = now() where id = ${row.id}`;
    await logActivity(sql, {
      type: "LOGIN",
      actorId: row.id,
      actorName: row.name,
      description: `${row.name} signed in`,
      entityType: "staff",
      entityId: row.id,
    });
    return;
  }
  await sql`
    update staff set last_seen_at = now()
    where id = ${row.id}
      and (last_seen_at is null or last_seen_at < now() - interval '5 minutes')
  `;
}

async function ensureAccess(sql: Sql, userId: string): Promise<Access> {
  await ensureOwnerAdmin(sql);
  const settings = await readSettings(sql);
  let row = await staffByUser(sql, userId);
  if (!row) {
    const users = await sql<{ id: string; name: string; email: string }>`
      select "id", "name", "email" from "user" where "id" = ${userId} limit 1
    `;
    const user = users[0];
    const name = cleanText(user?.name || "Administrator", "Name", 1, 80);
    const display = name.success ? name.text : "Administrator";
    const email = normalizeEmail(user?.email || "") ?? `${userId.slice(0, 12)}@staff.local`;
    const inserted = await sql<{ id: string }>`
      insert into staff (id, user_id, role, name, email, phone, status, presence)
      select ${userId}, ${userId}, 'ADMIN', ${display}, ${email}, '', 'ACTIVE', 'OFFLINE'
      where not exists (select 1 from staff where user_id = ${userId})
        and (select count(*)::int from staff where role = 'ADMIN' and deleted_at is null) < ${settings.maxAdmins}
      returning id
    `;
    if (inserted.length) {
      await logActivity(sql, {
        type: "ACCOUNT_CREATED",
        actorId: userId,
        actorName: display,
        description: `${display} became the first administrator`,
        entityType: "staff",
        entityId: userId,
      });
      if (dbSource === "pglite") await ensureRoster(sql, userId, display);
    }
    row = await staffByUser(sql, userId);
  }
  if (!row || row.deleted_at) {
    return {
      success: true,
      access: "none",
      message: "This sign-in is not a Taxi IM staff account. An administrator has to create one.",
    };
  }
  if (row.status !== "ACTIVE") {
    return {
      success: true,
      access: "disabled",
      message: "This account is disabled. Contact the control center.",
    };
  }
  await touchSeen(sql, row);
  if (dbSource === "pglite") await ensureRoster(sql, row.role === "ADMIN" ? row.id : null, row.name);
  return { success: true, access: "ok", staff: row, settings };
}

function denied(access: Access): ApiFailure | null {
  if (access.access === "none") return fail(access.message, "NOT_PROVISIONED");
  if (access.access === "disabled") return fail(access.message, "ACCOUNT_DISABLED");
  return null;
}

async function gate(userId: string, role?: Role) {
  const sql = await getSql();
  const access = await ensureAccess(sql, userId);
  const block = denied(access);
  if (block || access.access !== "ok") return { sql, access, block: block ?? fail("Forbidden.", "FORBIDDEN"), staff: null as StaffRow | null };
  if (role && access.staff.role !== role) {
    return { sql, access, block: fail("You do not have access to that.", "FORBIDDEN"), staff: null as StaffRow | null };
  }
  return { sql, access, block: null as ApiFailure | null, staff: access.staff };
}

export async function openGate(userId: string, role?: Role) {
  return gate(userId, role);
}

function routingMode() {
  const traffic = Boolean(process.env.MAPBOX_ACCESS_TOKEN?.trim());
  return { provider: traffic ? ("mapbox" as const) : ("osrm" as const), traffic };
}

async function weatherLabel(lat: number, lng: number): Promise<string | null> {
  const g = globalThis as { __taxiWeather?: { at: number; label: string } };
  if (g.__taxiWeather && Date.now() - g.__taxiWeather.at < 10 * 60 * 1000) return g.__taxiWeather.label;
  try {
    const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lng}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(4000),
      headers: { "User-Agent": "TaxiIM-Dispatch/1.0 (internal fleet desk)", Accept: "application/json" },
    });
    if (!res.ok) return g.__taxiWeather?.label ?? null;
    const body = (await res.json()) as {
      properties?: { timeseries?: Array<{ data?: { instant?: { details?: { air_temperature?: number } }; next_1_hours?: { summary?: { symbol_code?: string } } } }> };
    };
    const point = body.properties?.timeseries?.[0]?.data;
    const temp = point?.instant?.details?.air_temperature;
    if (temp == null) return g.__taxiWeather?.label ?? null;
    const symbol = point?.next_1_hours?.summary?.symbol_code ?? "";
    const kind = symbol.includes("thunder")
      ? "Storm"
      : symbol.includes("snow") || symbol.includes("sleet")
        ? "Snow"
        : symbol.includes("rain") || symbol.includes("drizzle")
          ? "Rain"
          : symbol.includes("fog")
            ? "Fog"
            : symbol.startsWith("clear")
              ? "Clear"
              : symbol.startsWith("fair")
                ? "Fair"
                : symbol.includes("cloud")
                  ? "Cloudy"
                  : "Fair";
    const label = `${Math.round(temp)}° ${kind}`;
    g.__taxiWeather = { at: Date.now(), label };
    return label;
  } catch {
    return g.__taxiWeather?.label ?? null;
  }
}

async function pruneGpsLogs(sql: Sql) {
  const g = globalThis as { __taxiGpsPruneAt?: number };
  const nowMs = Date.now();
  if (g.__taxiGpsPruneAt && nowMs - g.__taxiGpsPruneAt < 10 * 60 * 1000) return;
  g.__taxiGpsPruneAt = nowMs;
  await sql`delete from gps_logs where recorded_at < now() - interval '30 days'`;
}

async function noteStale(sql: Sql, rows: StaffRow[], staleSeconds: number) {
  for (const row of rows) {
    if (row.role !== "DRIVER" || asBool(row.simulated) || row.presence === "OFFLINE") continue;
    const last = iso(row.last_gps_at);
    const stale = !last || Date.now() - new Date(last).getTime() > staleSeconds * 1000;
    if (!stale) continue;
    const recent = await sql<{ id: string }>`
      select id from alerts
      where driver_id = ${row.id} and type = 'GPS_STALE' and created_at > now() - interval '10 minutes'
      limit 1
    `;
    if (recent.length) continue;
    await addAlert(sql, {
      type: "GPS_STALE",
      driverId: row.id,
      title: "GPS stale",
      body: `${row.name} has not sent a location update recently.`,
    });
  }
}

type OrderRow = {
  id: string;
  code: string;
  status: string;
  driver_id: string | null;
  driver_name: string | null;
  driver_code: string | null;
  pickup_label: string;
  pickup_lat: number;
  pickup_lng: number;
  dest_label: string;
  dest_lat: number;
  dest_lng: number;
  notes: string;
  source?: string | null;
  price_eur: number | string | null;
  distance_km: number | string | null;
  duration_min: number | string | null;
  route: unknown;
  alternatives: unknown;
  created_at: string | Date;
  dispatched_at: string | Date | null;
  accepted_at: string | Date | null;
  arrived_at: string | Date | null;
  started_at: string | Date | null;
  completed_at: string | Date | null;
  cancelled_at: string | Date | null;
};

function toOrder(row: OrderRow): OrderDto {
  const status = isOrderStatus(row.status) ? row.status : "PENDING";
  return {
    id: row.id,
    code: row.code,
    status,
    driverId: row.driver_id,
    driverName: row.driver_name,
    driverCode: row.driver_code,
    pickupLabel: row.pickup_label,
    pickupLat: num(row.pickup_lat) ?? 0,
    pickupLng: num(row.pickup_lng) ?? 0,
    destLabel: row.dest_label,
    destLat: num(row.dest_lat) ?? 0,
    destLng: num(row.dest_lng) ?? 0,
    notes: row.notes ?? "",
    source: row.source === "DIRECT" ? "DIRECT" : "DISPATCH",
    priceEur: num(row.price_eur),
    distanceKm: num(row.distance_km),
    durationMin: num(row.duration_min),
    route: parsePoints(row.route),
    alternatives: parseAlt(row.alternatives),
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
    dispatchedAt: iso(row.dispatched_at),
    acceptedAt: iso(row.accepted_at),
    arrivedAt: iso(row.arrived_at),
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
    cancelledAt: iso(row.cancelled_at),
  };
}

const ORDER_SELECT = `
  select o.*, s.name as driver_name, s.driver_code
  from orders o
  left join staff s on s.id = o.driver_id
`;

async function listOrderRows(sql: Sql, where: string, params: unknown[]): Promise<OrderDto[]> {
  const rows = await sql.query<OrderRow>(`${ORDER_SELECT} ${where}`, params);
  return rows.map(toOrder);
}

type PriceRow = {
  id: string;
  name: string;
  base_price: number | string;
  per_km: number | string;
  per_min: number | string;
  min_fare?: number | string | null;
  latitude: number | null;
  longitude: number | null;
  enabled: boolean;
};

function toPrice(row: PriceRow): PriceDto {
  return {
    id: row.id,
    name: row.name,
    basePrice: num(row.base_price) ?? 0,
    perKm: num(row.per_km) ?? 0,
    perMin: num(row.per_min) ?? 0,
    minFare: num(row.min_fare) ?? 0,
    latitude: num(row.latitude),
    longitude: num(row.longitude),
    enabled: asBool(row.enabled),
  };
}

function stepText(maneuver: { type?: string; modifier?: string } | undefined, name?: string) {
  const type = (maneuver?.type ?? "continue").replaceAll("_", " ");
  const modifier = maneuver?.modifier ? ` ${maneuver.modifier.replaceAll("_", " ")}` : "";
  const road = name ? ` onto ${name}` : "";
  const text = `${type}${modifier}${road}`.trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

async function mapboxRoutes(a: LatLng, b: LatLng, token: string): Promise<RouteResult | null> {
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${a.lng},${a.lat};${b.lng},${b.lat}` +
    `?alternatives=true&geometries=geojson&overview=full&steps=true&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    routes?: Array<{
      distance?: number;
      duration?: number;
      geometry?: { coordinates?: [number, number][] };
      legs?: Array<{ steps?: Array<{ distance?: number; name?: string; maneuver?: { type?: string; modifier?: string } }> }>;
    }>;
  };
  const routes = (body.routes ?? [])
    .slice(0, 3)
    .map((r) => ({
      distanceKm: round2((r.distance ?? 0) / 1000),
      durationMin: round2((r.duration ?? 0) / 60),
      coordinates: (r.geometry?.coordinates ?? []).map(([lng, lat]) => ({ lat, lng })),
      steps: (r.legs?.[0]?.steps ?? [])
        .map((s): RouteStep => ({ text: stepText(s.maneuver, s.name), distanceKm: round2((s.distance ?? 0) / 1000) }))
        .filter((s) => s.text.length > 0)
        .slice(0, 8),
    }))
    .filter((r) => r.coordinates.length >= 2);
  if (!routes.length) return null;
  return { provider: "mapbox", traffic: true, routes };
}

async function osrmRoutes(a: LatLng, b: LatLng): Promise<RouteResult | null> {
  const url =
    `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}` +
    `?overview=full&geometries=geojson&alternatives=true&steps=true`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "TaxiIM-Dispatch/1.0" } });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    code?: string;
    routes?: Array<{
      distance?: number;
      duration?: number;
      geometry?: { coordinates?: [number, number][] };
      legs?: Array<{ steps?: Array<{ distance?: number; name?: string; maneuver?: { type?: string; modifier?: string } }> }>;
    }>;
  };
  if (body.code !== "Ok") return null;
  const routes = (body.routes ?? [])
    .slice(0, 3)
    .map((r) => ({
      distanceKm: round2((r.distance ?? 0) / 1000),
      durationMin: round2((r.duration ?? 0) / 60),
      coordinates: (r.geometry?.coordinates ?? []).map(([lng, lat]) => ({ lat, lng })),
      steps: (r.legs?.[0]?.steps ?? [])
        .map((s): RouteStep => ({ text: stepText(s.maneuver, s.name), distanceKm: round2((s.distance ?? 0) / 1000) }))
        .filter((s) => s.text.length > 0)
        .slice(0, 8),
    }))
    .filter((r) => r.coordinates.length >= 2);
  if (!routes.length) return null;
  return { provider: "osrm", traffic: false, routes };
}

async function computeRoutes(a: LatLng, b: LatLng): Promise<RouteResult> {
  const token = process.env.MAPBOX_ACCESS_TOKEN?.trim();
  if (token) {
    try {
      const via = await mapboxRoutes(a, b, token);
      if (via) return via;
    } catch (err) {
      console.warn("[taxi] mapbox routing failed", err instanceof Error ? err.message : err);
    }
  }
  try {
    const via = await osrmRoutes(a, b);
    if (via) return via;
  } catch (err) {
    console.warn("[taxi] osrm routing failed", err instanceof Error ? err.message : err);
  }
  const km = haversineMeters(a, b) / 1000;
  return {
    provider: "straight",
    traffic: false,
    routes: [
      {
        distanceKm: round2(km),
        durationMin: round2((km / 45) * 60),
        coordinates: interpolate(a, b, 12),
      },
    ],
  };
}

async function findPrice(sql: Sql, label: string): Promise<PriceRow | null> {
  const rows = await sql<PriceRow>`select * from destination_prices where enabled = true`;
  const needle = label.trim().toLowerCase();
  return (
    rows.find((p) => p.name.toLowerCase() === needle) ??
    rows.find((p) => needle.includes(p.name.toLowerCase())) ??
    null
  );
}

function straightFallback(a: LatLng, b: LatLng): RouteResult {
  const km = haversineMeters(a, b) / 1000;
  return {
    provider: "straight",
    traffic: false,
    routes: [{ distanceKm: round2(km), durationMin: round2((km / 45) * 60), coordinates: interpolate(a, b, 8) }],
  };
}

async function releaseIfIdle(sql: Sql, driverId: string) {
  const rows = await sql<{ n: number }>`
    select count(*)::int as n from orders
    where driver_id = ${driverId} and status in ('ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS')
  `;
  if ((rows[0]?.n ?? 0) === 0) {
    await sql`
      update staff set presence = 'ONLINE', speed_kmh = coalesce(speed_kmh, 0), updated_at = now()
      where id = ${driverId} and presence = 'ON_RIDE'
    `;
  }
}

async function ensureOffers(sql: Sql) {
  await sql`
    create table if not exists order_offers (
      order_id text not null references orders (id) on delete cascade,
      driver_id text not null references staff (id) on delete cascade,
      response text not null default 'OFFERED' check (response in ('OFFERED', 'DECLINED', 'ACCEPTED')),
      responded_at timestamptz,
      primary key (order_id, driver_id)
    )
  `;
}

async function driverBusy(sql: Sql, driverId: string, exceptOrderId?: string) {
  const rows = exceptOrderId
    ? await sql<{ id: string }>`
        select id from orders
        where driver_id = ${driverId}
          and id <> ${exceptOrderId}
          and status in ('DISPATCHED', 'ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS')
        limit 1
      `
    : await sql<{ id: string }>`
        select id from orders
        where driver_id = ${driverId}
          and status in ('DISPATCHED', 'ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS')
        limit 1
      `;
  return rows.length > 0;
}

type AlertRow = {
  id: string;
  type: string;
  title: string;
  body: string;
  acknowledged: boolean;
  created_at: string | Date;
  driver_id: string | null;
  driver_name: string | null;
  actor_name: string | null;
};

function toAlert(row: AlertRow): AlertDto {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    acknowledged: asBool(row.acknowledged),
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
    driverId: row.driver_id,
    driverName: row.driver_name,
    actorName: row.actor_name,
  };
}

const ALERT_SELECT = `
  select a.*, d.name as driver_name, actor.name as actor_name
  from alerts a
  left join staff d on d.id = a.driver_id
  left join staff actor on actor.id = a.actor_id
`;

export async function publicConfig() {
  try {
    await prepareSignIn();
  } catch (err) {
    console.error("[taxi] sign-in setup", err instanceof Error ? err.message : err);
  }
  return {
    success: true as const,
    demo: dbSource === "pglite",
    logins: ROSTER.map((driver) => ({
      name: driver.name,
      email: driver.email,
      password: DEMO_PASSWORD,
      role: "DRIVER" as const,
    })),
  };
}

export async function loadSession(userId: string) {
  const sql = await getSql();
  const access = await ensureAccess(sql, userId);
  if (access.access !== "ok") return access;
  return {
    success: true as const,
    access: "ok" as const,
    demo: dbSource === "pglite",
    staff: toStaff(access.staff, access.settings.staleSeconds),
    companyName: access.settings.companyName,
    routing: routingMode(),
  };
}

export async function recordLogout(userId: string) {
  const { sql, block, staff } = await gate(userId);
  if (block || !staff) return block ?? fail("Forbidden.", "FORBIDDEN");
  await logActivity(sql, {
    type: "LOGOUT",
    actorId: staff.id,
    actorName: staff.name,
    description: `${staff.name} signed out`,
    entityType: "staff",
    entityId: staff.id,
  });
  return { success: true as const };
}

export async function loadPulse(userId: string) {
  const { sql, block, staff, access } = await gate(userId, "ADMIN");
  if (block || !staff || access.access !== "ok") return block ?? fail("Forbidden.", "FORBIDDEN");
  const rows = await sql<{
    drivers: number;
    online: number;
    on_ride: number;
    active_orders: number;
    alerts: number;
    km_today: number | string;
    offline: number;
    vehicles: number;
    in_shop: number;
    out_of_service: number;
    fuel_liters_today: number | string;
    fuel_cost_today: number | string;
    fuel_cost_month: number | string;
    maint_cost_month: number | string;
    service_due: number;
    km_month: number | string;
    available: number;
    pending_orders: number;
    completed_today: number;
    cancelled_today: number;
    repairs_month: number;
  }>`
    select
      (select count(*)::int from staff where role = 'DRIVER' and deleted_at is null) as drivers,
      (select count(*)::int from staff where role = 'DRIVER' and deleted_at is null and presence in ('ONLINE', 'ON_RIDE')) as online,
      (select count(*)::int from staff where role = 'DRIVER' and deleted_at is null and presence = 'OFFLINE') as offline,
      (select count(*)::int from staff where role = 'DRIVER' and deleted_at is null and presence = 'ON_RIDE') as on_ride,
      (select count(*)::int from orders where status in ('DISPATCHED', 'ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS')) as active_orders,
      (select count(*)::int from orders where status = 'PENDING') as pending_orders,
      (select count(*)::int from orders where status = 'COMPLETED' and (completed_at at time zone ${ZONE})::date = (now() at time zone ${ZONE})::date) as completed_today,
      (select count(*)::int from orders where status = 'CANCELLED' and (cancelled_at at time zone ${ZONE})::date = (now() at time zone ${ZONE})::date) as cancelled_today,
      (select count(*)::int from alerts where acknowledged = false) as alerts,
      (select coalesce(sum(kilometers), 0) from driver_daily_km where km_date = (now() at time zone ${ZONE})::date) as km_today,
      (select coalesce(sum(kilometers), 0) from driver_daily_km where km_date >= date_trunc('month', (now() at time zone ${ZONE}))::date) as km_month,
      (select count(*)::int from vehicles where deleted_at is null) as vehicles,
      (select count(*)::int from vehicles where deleted_at is null and status = 'AVAILABLE') as available,
      (select count(*)::int from vehicles where deleted_at is null and status = 'MAINTENANCE') as in_shop,
      (select count(*)::int from vehicles where deleted_at is null and status = 'OUT_OF_SERVICE') as out_of_service,
      (select coalesce(sum(liters), 0) from fuel_records where (filled_at at time zone ${ZONE})::date = (now() at time zone ${ZONE})::date) as fuel_liters_today,
      (select coalesce(sum(total_cost), 0) from fuel_records where (filled_at at time zone ${ZONE})::date = (now() at time zone ${ZONE})::date) as fuel_cost_today,
      (select coalesce(sum(total_cost), 0) from fuel_records where filled_at >= date_trunc('month', now())) as fuel_cost_month,
      (select coalesce(sum(total_cost), 0) from maintenance_records where serviced_on >= date_trunc('month', (now() at time zone ${ZONE}))::date) as maint_cost_month,
      (select count(*)::int from maintenance_records where serviced_on >= date_trunc('month', (now() at time zone ${ZONE}))::date) as repairs_month,
      (select count(*)::int from vehicles where deleted_at is null and (
        (next_service_on is not null and next_service_on <= (now() at time zone ${ZONE})::date + ${access.settings.serviceWarnDays}::int)
        or (insurance_expires is not null and insurance_expires <= (now() at time zone ${ZONE})::date + ${access.settings.serviceWarnDays}::int)
        or (registration_expires is not null and registration_expires <= (now() at time zone ${ZONE})::date + ${access.settings.serviceWarnDays}::int)
        or (inspection_expires is not null and inspection_expires <= (now() at time zone ${ZONE})::date + ${access.settings.serviceWarnDays}::int)
      )) as service_due
  `;
  const s = rows[0];
  const weather = await weatherLabel(access.settings.baseLat, access.settings.baseLng);
  return {
    success: true as const,
    companyName: access.settings.companyName,
    drivers: s?.drivers ?? 0,
    online: s?.online ?? 0,
    onRide: s?.on_ride ?? 0,
    activeOrders: s?.active_orders ?? 0,
    alerts: s?.alerts ?? 0,
    kmToday: round2(num(s?.km_today) ?? 0),
    kmMonth: round2(num(s?.km_month) ?? 0),
    offline: s?.offline ?? 0,
    vehicles: s?.vehicles ?? 0,
    inShop: s?.in_shop ?? 0,
    outOfService: s?.out_of_service ?? 0,
    fuelLitersToday: round2(num(s?.fuel_liters_today) ?? 0),
    fuelCostToday: round2(num(s?.fuel_cost_today) ?? 0),
    fuelCostMonth: round2(num(s?.fuel_cost_month) ?? 0),
    maintCostMonth: round2(num(s?.maint_cost_month) ?? 0),
    serviceDue: s?.service_due ?? 0,
    available: s?.available ?? 0,
    pendingOrders: s?.pending_orders ?? 0,
    completedToday: s?.completed_today ?? 0,
    cancelledToday: s?.cancelled_today ?? 0,
    repairsMonth: s?.repairs_month ?? 0,
    weather,
    routing: routingMode(),
    baseLabel: access.settings.baseLabel,
  };
}

export async function loadDashboard(userId: string) {
  const pulse = await loadPulse(userId);
  if (!pulse || !("success" in pulse) || !pulse.success) return pulse;
  const { sql, block, access } = await gate(userId, "ADMIN");
  if (block || access.access !== "ok") return block ?? fail("Forbidden.", "FORBIDDEN");
  const drivers = (await sql.query<StaffRow>(
    `${STAFF_SELECT} where s.role = 'DRIVER' and s.deleted_at is null order by case s.presence when 'ON_RIDE' then 0 when 'ONLINE' then 1 else 2 end, s.name`,
    [],
  )).map((r) => toStaff(r, access.settings.staleSeconds));
  await noteStale(sql, await sql<StaffRow>`select * from staff where role = 'DRIVER' and deleted_at is null`, access.settings.staleSeconds);
  const activity = await sql<{
    id: string;
    event_type: string;
    actor_name: string | null;
    description: string;
    created_at: string | Date;
    entity_type: string | null;
    entity_id: string | null;
  }>`
    select id, event_type, actor_name, description, created_at, entity_type, entity_id
    from activity_log order by created_at desc limit 12
  `;
  const alerts = (
    await sql.query<AlertRow>(`${ALERT_SELECT} order by a.created_at desc limit 8`, [])
  ).map(toAlert);
  const orders = await listOrderRows(
    sql,
    `where o.status in ('DISPATCHED', 'ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS') order by o.created_at desc limit 8`,
    [],
  );
  return {
    ...pulse,
    drivers,
    activity: activity.map((a) => ({
      id: a.id,
      eventType: a.event_type,
      actorName: a.actor_name,
      description: a.description,
      createdAt: iso(a.created_at) ?? "",
      entityType: a.entity_type,
      entityId: a.entity_id,
    })),
    recentAlerts: alerts,
    activeOrderList: orders,
    base: { lat: access.settings.baseLat, lng: access.settings.baseLng, label: access.settings.baseLabel },
  };
}

export async function loadFleet(userId: string) {
  const { sql, block, access } = await gate(userId, "ADMIN");
  if (block || access.access !== "ok") return block ?? fail("Forbidden.", "FORBIDDEN");
  await ensureRealGps(sql);
  const rows = await sql.query<StaffRow>(
    `${STAFF_SELECT} where s.role = 'DRIVER' and s.deleted_at is null order by s.name`,
    [],
  );
  await noteStale(sql, rows, access.settings.staleSeconds);
  return {
    success: true as const,
    drivers: rows.map((r) => toStaff(r, access.settings.staleSeconds)),
    base: { lat: access.settings.baseLat, lng: access.settings.baseLng, label: access.settings.baseLabel },
  };
}

export async function loadOrders(
  userId: string,
  filter: { status?: string; driverId?: string; q?: string },
) {
  const { sql, block, staff } = await gate(userId);
  if (block || !staff) return block ?? fail("Forbidden.", "FORBIDDEN");
  const where: string[] = [];
  const params: unknown[] = [];
  if (staff.role === "DRIVER") {
    params.push(staff.id);
    where.push(`o.driver_id = $${params.length}`);
  } else if (filter.driverId) {
    params.push(filter.driverId);
    where.push(`o.driver_id = $${params.length}`);
  }
  if (filter.status && isOrderStatus(filter.status)) {
    params.push(filter.status);
    where.push(`o.status = $${params.length}`);
  }
  if (filter.q && filter.q.trim()) {
    params.push(`%${filter.q.trim().slice(0, 80)}%`);
    where.push(`(o.code ilike $${params.length} or o.pickup_label ilike $${params.length} or o.dest_label ilike $${params.length})`);
  }
  const clause = `${where.length ? `where ${where.join(" and ")}` : ""} order by o.created_at desc limit 200`;
  const orders = await listOrderRows(sql, clause, params);
  return { success: true as const, orders };
}

export async function previewRoute(userId: string, from: LatLng, to: LatLng) {
  const { block, staff } = await gate(userId);
  if (block || !staff) return block ?? fail("Forbidden.", "FORBIDDEN");
  if (!isValidCoord(from.lat, from.lng) || !isValidCoord(to.lat, to.lng)) {
    return fail("Pickup and destination need valid map coordinates.", "VALIDATION");
  }
  const route = await computeRoutes(from, to);
  return { success: true as const, route };
}

export async function searchPlaces(userId: string, q: string) {
  const { block } = await gate(userId);
  if (block) return block ?? fail("Forbidden.", "FORBIDDEN");
  const query = q.trim().slice(0, 120);
  if (query.length < 2) return { success: true as const, places: [] as PlaceHit[] };
  const key = query.toLowerCase();
  const g = globalThis as { __taxiGeo?: Map<string, { at: number; places: PlaceHit[] }>; __taxiGeoAt?: number };
  g.__taxiGeo ??= new Map();
  const hit = g.__taxiGeo.get(key);
  if (hit && hit.places.length && Date.now() - hit.at < 10 * 60 * 1000) return { success: true as const, places: hit.places };
  if (hit && !hit.places.length && Date.now() - hit.at < 20_000) return { success: true as const, places: hit.places };
  const wait = 1100 - (Date.now() - (g.__taxiGeoAt ?? 0));
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  g.__taxiGeoAt = Date.now();
  const run = async (bounded: boolean) => {
    const extra = bounded ? "&viewbox=20.55,43.05,21.35,42.45&bounded=1" : "&countrycodes=xk";
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&q=${encodeURIComponent(query)}${extra}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "TaxiIM-Dispatch/1.0 (internal fleet desk)", Accept: "application/json" },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as Array<{
      display_name?: string;
      lat?: string;
      lon?: string;
      address?: { road?: string; house_number?: string; city?: string; town?: string; village?: string; suburb?: string };
    }>;
    return body
      .map((p) => {
        const lat = num(p.lat);
        const lng = num(p.lon);
        if (lat == null || lng == null) return null;
        const street = [p.address?.road, p.address?.house_number].filter(Boolean).join(" ").trim();
        const city = p.address?.city || p.address?.town || p.address?.village || p.address?.suburb || "";
        const label = [street || (p.display_name ?? "").split(",")[0], city].filter(Boolean).join(", ").trim();
        return label ? { label, street: street || label, city, lat, lng } : null;
      })
      .filter((p): p is PlaceHit => p != null);
  };
  const photon = async () => {
    const url = `https://photon.komoot.io/api/?limit=6&lang=en&lat=42.78&lon=21.00&bbox=20.55,42.45,21.35,43.05&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "TaxiIM-Dispatch/1.0 (internal fleet desk)", Accept: "application/json" },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as {
      features?: Array<{ properties?: Record<string, string | undefined>; geometry?: { coordinates?: number[] } }>;
    };
    return (body.features ?? [])
      .map((feature) => {
        const coords = feature.geometry?.coordinates;
        const lng = coords?.[0];
        const lat = coords?.[1];
        if (lat == null || lng == null || !isValidCoord(lat, lng)) return null;
        const props = feature.properties ?? {};
        const street = [props.street || props.name, props.housenumber].filter(Boolean).join(" ").trim();
        const city = props.city || props.town || props.district || props.county || "";
        const label = [street || props.name, city].filter(Boolean).join(", ").trim();
        return label ? { label, street: street || label, city, lat, lng } : null;
      })
      .filter((p): p is PlaceHit => p != null);
  };
  try {
    let places = await photon();
    if (!places.length) places = await run(true);
    if (!places.length) places = await run(false);
    g.__taxiGeo.set(key, { at: Date.now(), places });
    return { success: true as const, places };
  } catch (err) {
    console.warn("[taxi] geocode failed", err instanceof Error ? err.message : err);
    return { success: true as const, places: [] as PlaceHit[] };
  }
}

type PlaceHit = { label: string; street: string; city: string; lat: number; lng: number };

export async function dispatchOrder(
  userId: string,
  input: {
    driverId?: string;
    broadcast?: boolean;
    pickupLabel: string;
    pickupLat: number;
    pickupLng: number;
    destLabel: string;
    destLat: number;
    destLng: number;
    notes?: string;
    price?: number | null;
    customerName?: string;
    customerPhone?: string;
  },
) {
  const { sql, block, staff } = await gate(userId, "ADMIN");
  if (block || !staff) return block ?? fail("Forbidden.", "FORBIDDEN");
  await ensureOffers(sql);
  await ensureOrderFlow(sql);
  const pickup = cleanText(input.pickupLabel ?? "", "Pickup", 2, 140);
  if (!pickup.success) return pickup;
  const dest = cleanText(input.destLabel ?? "", "Destination", 2, 140);
  if (!dest.success) return dest;
  if (!isValidCoord(input.pickupLat, input.pickupLng) || !isValidCoord(input.destLat, input.destLng)) {
    return fail("Choose pickup and destination on the map or from suggestions.", "VALIDATION");
  }
  let notes = "";
  if (input.notes && input.notes.trim()) {
    const n = cleanText(input.notes, "Notes", 0, 500);
    if (!n.success) return n;
    notes = n.text;
  }
  if (input.customerName?.trim() || input.customerPhone?.trim()) {
    const who = [input.customerName?.trim(), input.customerPhone?.trim()].filter(Boolean).join(" · ").slice(0, 160);
    notes = notes ? `${notes}\nCustomer: ${who}` : `Customer: ${who}`;
  }
  const broadcast = Boolean(input.broadcast) || !input.driverId;
  let driver: StaffRow | null = null;
  if (!broadcast) {
    driver = await staffById(sql, input.driverId ?? "");
    if (!driver || driver.deleted_at || driver.role !== "DRIVER") return fail("That driver does not exist.", "NOT_FOUND");
    if (driver.status !== "ACTIVE") return fail("That driver account is disabled.", "DRIVER_UNAVAILABLE");
    if (await driverBusy(sql, driver.id)) return fail("Could not dispatch this driver. They already have an open order.", "DRIVER_BUSY");
    if (driver.vehicle_status === "MAINTENANCE" || driver.vehicle_status === "OUT_OF_SERVICE") {
      return fail(`Unable to dispatch order. ${driver.vehicle || "The vehicle"} is ${driver.vehicle_status.replaceAll("_", " ").toLowerCase()}.`, "VEHICLE_UNAVAILABLE");
    }
  }

  const from = { lat: input.pickupLat, lng: input.pickupLng };
  const to = { lat: input.destLat, lng: input.destLng };
  let routed = await computeRoutes(from, to);
  if (!routed.routes.length) routed = straightFallback(from, to);
  const primary = routed.routes[0] ?? straightFallback(from, to).routes[0]!;
  const priceRow = await findPrice(sql, dest.text);
  let price: number | null = null;
  if (input.price != null) {
    const manual = num(input.price);
    if (manual == null || manual < 0 || manual > 10000) return fail("Price is not a valid amount.", "PRICE_INVALID");
    price = round2(manual);
  } else if (priceRow) {
    price = quoteEuros(
      num(priceRow.base_price) ?? 0,
      num(priceRow.per_km) ?? 0,
      num(priceRow.per_min) ?? 0,
      primary.distanceKm,
      primary.durationMin,
      num(priceRow.min_fare) ?? 0,
    );
  }
  const id = randomUUID();
  const code = `IM-${Date.now().toString(36).toUpperCase()}`;
  const alts = routed.routes.slice(1).map((r) => r.coordinates);
  let recipients: StaffRow[] = [];
  if (broadcast) {
    const online = await sql<StaffRow>`
      select * from staff
      where role = 'DRIVER' and status = 'ACTIVE' and deleted_at is null and presence = 'ONLINE'
    `;
    for (const candidate of online) {
      if (!(await driverBusy(sql, candidate.id))) recipients.push(candidate);
    }
  }
  const status = broadcast && recipients.length === 0 ? "PENDING" : "DISPATCHED";
  await sql`
    insert into orders (
      id, code, status, driver_id, created_by,
      pickup_label, pickup_lat, pickup_lng, dest_label, dest_lat, dest_lng,
      notes, price_eur, price_id, distance_km, duration_min, route, alternatives, dispatched_at
    ) values (
      ${id}, ${code}, ${status}, ${driver?.id ?? null}, ${staff.id},
      ${pickup.text}, ${from.lat}, ${from.lng}, ${dest.text}, ${to.lat}, ${to.lng},
      ${notes}, ${price}, ${priceRow?.id ?? null}, ${primary.distanceKm}, ${primary.durationMin},
      ${JSON.stringify(primary.coordinates)}::jsonb, ${JSON.stringify(alts)}::jsonb, ${status === "DISPATCHED" ? new Date().toISOString() : null}
    )
  `;
  for (const recipient of recipients) {
    await sql`
      insert into order_offers (order_id, driver_id, response)
      values (${id}, ${recipient.id}, 'OFFERED')
      on conflict (order_id, driver_id) do nothing
    `;
    await addAlert(sql, {
      type: "DISPATCH",
      driverId: recipient.id,
      actorId: staff.id,
      title: `New order ${code}`,
      body: `${pickup.text} → ${dest.text}`,
    });
  }
  if (driver) {
    await addAlert(sql, {
      type: "DISPATCH",
      driverId: driver.id,
      actorId: staff.id,
      title: `New dispatch ${code}`,
      body: `${pickup.text} → ${dest.text}`,
    });
  }
  const who = driver ? driver.name : recipients.length ? `${recipients.length} online drivers` : "the queue";
  await logActivity(sql, {
    type: "ORDER_DISPATCHED",
    actorId: staff.id,
    actorName: staff.name,
    description: `${staff.name} dispatched ${code} to ${who}`,
    entityType: "order",
    entityId: id,
  });
  const orders = await listOrderRows(sql, "where o.id = $1", [id]);
  const message = driver
    ? driver.presence === "OFFLINE"
      ? `${driver.name} is offline. They will see ${code} when they connect.`
      : `${code} sent to ${driver.name}.`
    : recipients.length
      ? `${code} sent to ${recipients.length} online driver${recipients.length === 1 ? "" : "s"}.`
      : `${code} is saved. No online driver is free right now.`;
  return {
    success: true as const,
    order: orders[0],
    message,
    routeProvider: routed.provider,
    traffic: routed.traffic,
  };
}

export async function actOnOrder(
  userId: string,
  input: { orderId: string; action: OrderAction; driverId?: string },
) {
  const { sql, block, staff } = await gate(userId);
  if (block || !staff) return block ?? fail("Forbidden.", "FORBIDDEN");
  await ensureOffers(sql);
  await ensureOrderFlow(sql);
  if (!actionAllowedFor(staff.role, input.action)) return fail("You cannot perform that action.", "FORBIDDEN");
  const rows = await sql.query<OrderRow>(`${ORDER_SELECT} where o.id = $1 limit 1`, [input.orderId]);
  const order = rows[0];
  if (!order || !isOrderStatus(order.status)) return fail("Order not found.", "NOT_FOUND");
  const offer = staff.role === "DRIVER"
    ? (await sql<{ response: string }>`
        select response from order_offers where order_id = ${order.id} and driver_id = ${staff.id} limit 1
      `)[0]
    : undefined;
  const broadcastOffer = staff.role === "DRIVER" && order.driver_id == null && order.status === "DISPATCHED" && offer?.response === "OFFERED";
  if (staff.role === "DRIVER" && order.driver_id !== staff.id && !broadcastOffer) {
    return fail("That order is not assigned to you.", "FORBIDDEN");
  }
  if (staff.role === "DRIVER" && (input.action === "accept" || input.action === "decline") && order.driver_id == null) {
    if (!broadcastOffer) return fail("This order has already been accepted by another driver.", "ORDER_TAKEN");
    if (input.action === "decline") {
      await sql`
        update order_offers set response = 'DECLINED', responded_at = now()
        where order_id = ${order.id} and driver_id = ${staff.id} and response = 'OFFERED'
      `;
      const left = await sql<{ n: number }>`
        select count(*)::int as n from order_offers where order_id = ${order.id} and response = 'OFFERED'
      `;
      if ((left[0]?.n ?? 0) === 0) {
        await sql`update orders set status = 'DECLINED', updated_at = now() where id = ${order.id} and status = 'DISPATCHED' and driver_id is null`;
      }
      await logActivity(sql, {
        type: "ORDER_DECLINED",
        actorId: staff.id,
        actorName: staff.name,
        description: `${staff.name} declined ${order.code}`,
        entityType: "order",
        entityId: order.id,
      });
      const updated = await listOrderRows(sql, "where o.id = $1", [order.id]);
      return { success: true as const, order: updated[0], message: `${order.code} declined.` };
    }
    const won = await sql<{ id: string }>`
      update orders set
        status = 'ACCEPTED',
        driver_id = ${staff.id},
        accepted_at = now(),
        updated_at = now()
      where id = ${order.id}
        and status = 'DISPATCHED'
        and driver_id is null
      returning id
    `;
    if (!won.length) return fail("This order has already been accepted by another driver.", "ORDER_TAKEN");
    await sql`
      update order_offers set response = 'ACCEPTED', responded_at = now()
      where order_id = ${order.id} and driver_id = ${staff.id}
    `;
    await sql`update staff set presence = 'ON_RIDE', updated_at = now() where id = ${staff.id}`;
    await logActivity(sql, {
      type: "ORDER_ACCEPTED",
      actorId: staff.id,
      actorName: staff.name,
      description: `${staff.name} confirmed ${order.code}`,
      entityType: "order",
      entityId: order.id,
    });
    const updated = await listOrderRows(sql, "where o.id = $1", [order.id]);
    return { success: true as const, order: updated[0], message: `${order.code} is yours.` };
  }
  const next = nextStatus(order.status, input.action);
  if (!next) return fail(`Cannot ${input.action} an order that is ${order.status}.`, "INVALID_TRANSITION");

  let driverId = order.driver_id;
  if (input.action === "reassign") {
    if (!input.driverId) return fail("Choose a driver to reassign.", "VALIDATION");
    const nextDriver = await staffById(sql, input.driverId);
    if (!nextDriver || nextDriver.deleted_at || nextDriver.role !== "DRIVER" || nextDriver.status !== "ACTIVE") {
      return fail("Cannot assign an inactive or unknown driver.", "DRIVER_UNAVAILABLE");
    }
    if (await driverBusy(sql, nextDriver.id, order.id)) return fail("That driver already has an open order.", "DRIVER_BUSY");
    const previous = driverId;
    driverId = nextDriver.id;
    await sql`
      update orders set
        status = 'DISPATCHED',
        driver_id = ${nextDriver.id},
        dispatched_at = now(),
        accepted_at = null,
        arrived_at = null,
        started_at = null,
        updated_at = now()
      where id = ${order.id}
    `;
    if (previous) await releaseIfIdle(sql, previous);
    await addAlert(sql, {
      type: "DISPATCH",
      driverId: nextDriver.id,
      actorId: staff.id,
      title: `Reassigned ${order.code}`,
      body: `${order.pickup_label} → ${order.dest_label}`,
    });
    await logActivity(sql, {
      type: "ORDER_REASSIGNED",
      actorId: staff.id,
      actorName: staff.name,
      description: `${staff.name} reassigned ${order.code} to ${nextDriver.name}`,
      entityType: "order",
      entityId: order.id,
    });
    const updated = await listOrderRows(sql, "where o.id = $1", [order.id]);
    return { success: true as const, order: updated[0] };
  }

  if (input.action === "accept") {
    await sql`update orders set status = 'ACCEPTED', accepted_at = now(), updated_at = now() where id = ${order.id}`;
    await sql`update staff set presence = 'ON_RIDE', updated_at = now() where id = ${staff.id}`;
  } else if (input.action === "decline") {
    await sql`update orders set status = 'DECLINED', updated_at = now() where id = ${order.id}`;
  } else if (input.action === "enroute") {
    await sql`update orders set status = 'ON_THE_WAY', updated_at = now() where id = ${order.id}`;
  } else if (input.action === "arrived") {
    const lat = num(staff.latitude);
    const lng = num(staff.longitude);
    await sql`
      update orders set
        status = 'ARRIVED',
        arrived_at = now(),
        arrived_lat = ${lat},
        arrived_lng = ${lng},
        updated_at = now()
      where id = ${order.id}
    `;
  } else if (input.action === "start") {
    await sql`update orders set status = 'IN_PROGRESS', started_at = now(), updated_at = now() where id = ${order.id}`;
    await sql`update staff set presence = 'ON_RIDE', updated_at = now() where id = ${staff.id}`;
  } else if (input.action === "complete") {
    await sql`update orders set status = 'COMPLETED', completed_at = now(), updated_at = now() where id = ${order.id}`;
    if (order.driver_id) await releaseIfIdle(sql, order.driver_id);
  } else if (input.action === "cancel") {
    await sql`update orders set status = 'CANCELLED', cancelled_at = now(), updated_at = now() where id = ${order.id}`;
    if (order.driver_id) await releaseIfIdle(sql, order.driver_id);
  }

  const event =
    input.action === "accept" ? "ORDER_ACCEPTED" :
    input.action === "enroute" ? "ORDER_ENROUTE" :
    input.action === "decline" ? "ORDER_DECLINED" :
    input.action === "arrived" ? "ORDER_ARRIVED" :
    input.action === "start" ? "ORDER_STARTED" :
    input.action === "complete" ? "ORDER_COMPLETED" :
    "ORDER_CANCELLED";
  await logActivity(sql, {
    type: event,
    actorId: staff.id,
    actorName: staff.name,
    description: `${staff.name} set ${order.code} to ${next}`,
    entityType: "order",
    entityId: order.id,
  });
  if (order.driver_id && input.action !== "accept") {
    await addAlert(sql, {
      type: "ORDER",
      driverId: order.driver_id,
      actorId: staff.id,
      title: `${order.code} ${next.replaceAll("_", " ").toLowerCase()}`,
      body: `${order.pickup_label} → ${order.dest_label}`,
    });
  }
  const updated = await listOrderRows(sql, "where o.id = $1", [order.id]);
  return { success: true as const, order: updated[0] };
}

export async function createDirectRide(
  userId: string,
  input: {
    pickupLabel: string;
    pickupLat: number;
    pickupLng: number;
    destLabel: string;
    destLat: number;
    destLng: number;
    customerName?: string;
    customerPhone?: string;
    notes?: string;
  },
) {
  const { sql, block, staff, access } = await gate(userId, "DRIVER");
  if (block || !staff || access.access !== "ok") return block ?? fail("Forbidden.", "FORBIDDEN");
  await ensureOrderFlow(sql);
  await ensureCityFares(sql);
  if (staff.presence === "OFFLINE") return fail("Go online before starting a direct ride.", "DRIVER_OFFLINE");
  if (await driverBusy(sql, staff.id)) return fail("Finish the open order before starting another ride.", "DRIVER_BUSY");
  const pickup = cleanText(input.pickupLabel ?? "", "Pickup", 2, 140);
  if (!pickup.success) return pickup;
  const dest = cleanText(input.destLabel ?? "", "Destination", 2, 140);
  if (!dest.success) return dest;
  if (!isValidCoord(input.pickupLat, input.pickupLng) || !isValidCoord(input.destLat, input.destLng)) {
    return fail("Pickup and destination need a map position.", "VALIDATION");
  }
  const prices = await sql<PriceRow>`select * from destination_prices where enabled = true`;
  const matched = prices.find((row) => row.name.trim().toLowerCase() === dest.text.trim().toLowerCase());
  const routed = await computeRoutes(
    { lat: input.pickupLat, lng: input.pickupLng },
    { lat: input.destLat, lng: input.destLng },
  );
  const leg = routed.routes[0];
  const distanceKm = leg?.distanceKm ?? round2(haversineMeters(
    { lat: input.pickupLat, lng: input.pickupLng },
    { lat: input.destLat, lng: input.destLng },
  ) / 1000);
  const durationMin = leg?.durationMin ?? null;
  let price = round2(access.settings.startFare + access.settings.perKmRate * distanceKm);
  let priceId: string | null = null;
  if (matched) {
    priceId = matched.id;
    const perKm = num(matched.per_km) ?? 0;
    const perMin = num(matched.per_min) ?? 0;
    const base = num(matched.base_price) ?? 0;
    price = perKm === 0 && perMin === 0
      ? round2(base)
      : quoteEuros(base, perKm, perMin, distanceKm, durationMin ?? 0, num(matched.min_fare) ?? 0);
  }
  const who = [input.customerName, input.customerPhone].map((v) => (v ?? "").replace(/<[^>]*>/g, "").trim()).filter(Boolean).join(" · ");
  const notes = ["Direct ride", who ? `Customer: ${who}` : "", (input.notes ?? "").replace(/<[^>]*>/g, "").trim()]
    .filter(Boolean)
    .join("\n")
    .slice(0, 500);
  const id = randomUUID();
  const code = `IM-${Date.now().toString(36).toUpperCase()}`;
  await sql`
    insert into orders (
      id, code, status, source, driver_id, created_by,
      pickup_label, pickup_lat, pickup_lng, dest_label, dest_lat, dest_lng,
      notes, price_eur, price_id, distance_km, duration_min, route, accepted_at
    ) values (
      ${id}, ${code}, 'ACCEPTED', 'DIRECT', ${staff.id}, ${staff.id},
      ${pickup.text}, ${input.pickupLat}, ${input.pickupLng}, ${dest.text}, ${input.destLat}, ${input.destLng},
      ${notes}, ${price}, ${priceId}, ${distanceKm}, ${durationMin}, ${leg ? JSON.stringify(leg.coordinates) : null}::jsonb, now()
    )
  `;
  await sql`update staff set presence = 'ON_RIDE', updated_at = now() where id = ${staff.id}`;
  await addAlert(sql, {
    type: "ORDER",
    driverId: staff.id,
    actorId: staff.id,
    title: `Direct ride ${code}`,
    body: `${staff.name}: ${pickup.text} → ${dest.text}`,
  });
  await logActivity(sql, {
    type: "ORDER_ACCEPTED",
    actorId: staff.id,
    actorName: staff.name,
    description: `${staff.name} started direct ride ${code}`,
    entityType: "order",
    entityId: id,
  });
  const updated = await listOrderRows(sql, "where o.id = $1", [id]);
  return { success: true as const, order: updated[0], message: `${code} is on your sheet at ${price.toFixed(2)} €.` };
}

export async function setPresence(userId: string, online: boolean) {
  const { sql, block, staff } = await gate(userId, "DRIVER");
  if (block || !staff) return block ?? fail("Forbidden.", "FORBIDDEN");
  if (online) {
    const active = await sql<{ n: number }>`
      select count(*)::int as n from orders
      where driver_id = ${staff.id} and status in ('ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS')
    `;
    const presence: Presence = (active[0]?.n ?? 0) > 0 ? "ON_RIDE" : "ONLINE";
    await sql`update staff set presence = ${presence}, updated_at = now() where id = ${staff.id}`;
    await logActivity(sql, {
      type: "DRIVER_ONLINE",
      actorId: staff.id,
      actorName: staff.name,
      description: `${staff.name} is online`,
      entityType: "staff",
      entityId: staff.id,
    });
    await addAlert(sql, {
      type: "PRESENCE",
      driverId: staff.id,
      actorId: staff.id,
      title: `${staff.name} online`,
      body: "Driver switched on.",
    });
  } else {
    await sql`update staff set presence = 'OFFLINE', speed_kmh = 0, updated_at = now() where id = ${staff.id}`;
    await logActivity(sql, {
      type: "DRIVER_OFFLINE",
      actorId: staff.id,
      actorName: staff.name,
      description: `${staff.name} is offline`,
      entityType: "staff",
      entityId: staff.id,
    });
    await addAlert(sql, {
      type: "PRESENCE",
      driverId: staff.id,
      actorId: staff.id,
      title: `${staff.name} offline`,
      body: "Driver switched off.",
    });
  }
  const fresh = await staffById(sql, staff.id);
  return { success: true as const, staff: fresh ? toStaff(fresh, 90) : null };
}

export async function postLocation(
  userId: string,
  input: {
    lat: number;
    lng: number;
    accuracyM?: number | null;
    speedMps?: number | null;
    heading?: number | null;
    altitudeM?: number | null;
    at?: number | null;
  },
) {
  const { sql, block, staff, access } = await gate(userId, "DRIVER");
  if (block || !staff || access.access !== "ok") return block ?? fail("Forbidden.", "FORBIDDEN");
  await ensureRealGps(sql);
  if (staff.presence === "OFFLINE") return fail("Go online before sending location.", "DRIVER_OFFLINE");
  const at = input.at && Number.isFinite(input.at) ? input.at : Date.now();
  if (Math.abs(Date.now() - at) > 5 * 60 * 1000) {
    return fail("Location timestamp is not current.", "GPS_INVALID");
  }
  const lastAt = iso(staff.last_gps_at);
  const lastLat = num(staff.latitude);
  const lastLng = num(staff.longitude);
  const decision = assessGps(
    lastLat != null && lastLng != null && lastAt ? { lat: lastLat, lng: lastLng, at: new Date(lastAt).getTime() } : null,
    {
      lat: input.lat,
      lng: input.lng,
      accuracyM: input.accuracyM ?? null,
      speedMps: input.speedMps ?? null,
      at,
    },
  );
  if (!decision.accept) return fail(decision.message, decision.code);
  await sql`
    update staff set
      latitude = ${input.lat},
      longitude = ${input.lng},
      accuracy_m = ${input.accuracyM ?? null},
      speed_kmh = ${decision.speedKmh},
      heading = ${input.heading != null && Number.isFinite(input.heading) ? ((input.heading % 360) + 360) % 360 : null},
      last_gps_at = now(),
      prev_lat = ${lastLat},
      prev_lng = ${lastLng},
      prev_gps_at = ${lastAt},
      simulated = false,
      updated_at = now()
    where id = ${staff.id}
  `;
  if (decision.addedKm > 0) await addKm(sql, staff.id, decision.addedKm);
  if (decision.addedKm >= 0.05 || decision.speedKmh != null) {
    const heading =
      input.heading != null && Number.isFinite(input.heading) ? ((input.heading % 360) + 360) % 360 : null;
    const altitude =
      input.altitudeM != null && Number.isFinite(input.altitudeM) && Math.abs(input.altitudeM) < 12000
        ? input.altitudeM
        : null;
    await sql`
      insert into gps_logs (driver_id, latitude, longitude, accuracy_m, speed_kmh, heading, altitude_m, recorded_at)
      values (${staff.id}, ${input.lat}, ${input.lng}, ${input.accuracyM ?? null}, ${decision.speedKmh}, ${heading}, ${altitude}, now())
    `;
  }
  const limit = access.settings.speedAlertKmh;
  if (decision.speedKmh != null && decision.speedKmh >= limit) {
    const recent = await sql<{ id: string }>`
      select id from alerts
      where driver_id = ${staff.id} and type = 'SPEED' and created_at > now() - interval '10 minutes'
      limit 1
    `;
    if (!recent.length) {
      await addAlert(sql, {
        type: "SPEED",
        driverId: staff.id,
        actorId: staff.id,
        title: "Speed alert",
        body: `${staff.name} is at ${Math.round(decision.speedKmh)} km/h.`,
      });
    }
  }
  const fresh = await staffById(sql, staff.id);
  void pruneGpsLogs(sql);
  return { success: true as const, staff: fresh ? toStaff(fresh, access.settings.staleSeconds) : null, addedKm: decision.addedKm };
}

export async function ringDriver(userId: string, driverId: string) {
  const { sql, block, staff } = await gate(userId, "ADMIN");
  if (block || !staff) return block ?? fail("Forbidden.", "FORBIDDEN");
  const driver = await staffById(sql, driverId);
  if (!driver || driver.deleted_at || driver.role !== "DRIVER") return fail("Driver not found.", "NOT_FOUND");
  if (driver.status !== "ACTIVE") return fail("That driver account is disabled.", "DRIVER_UNAVAILABLE");
  const recent = await sql<{ id: string }>`
    select id from alerts
    where driver_id = ${driver.id} and type = 'RING' and acknowledged = false and created_at > now() - interval '20 seconds'
    limit 1
  `;
  if (!recent.length) {
    await addAlert(sql, {
      type: "RING",
      driverId: driver.id,
      actorId: staff.id,
      title: "ADMIN IS CALLING YOU",
      body: `${staff.name} is calling you from the control center.`,
    });
  }
  await logActivity(sql, {
    type: "ADMIN_RING",
    actorId: staff.id,
    actorName: staff.name,
    description: `${staff.name} rang ${driver.name}`,
    entityType: "staff",
    entityId: driver.id,
  });
  return { success: true as const, message: `${driver.name} has been called.` };
}

export async function forceOffline(userId: string, driverId: string) {
  const { sql, block, staff } = await gate(userId, "ADMIN");
  if (block || !staff) return block ?? fail("Forbidden.", "FORBIDDEN");
  const driver = await staffById(sql, driverId);
  if (!driver || driver.role !== "DRIVER") return fail("Driver not found.", "NOT_FOUND");
  await sql`update staff set presence = 'OFFLINE', speed_kmh = 0, updated_at = now() where id = ${driver.id}`;
  await logActivity(sql, {
    type: "DRIVER_OFFLINE",
    actorId: staff.id,
    actorName: staff.name,
    description: `${staff.name} set ${driver.name} offline`,
    entityType: "staff",
    entityId: driver.id,
  });
  return { success: true as const };
}

export async function loadAlerts(userId: string, asId?: string) {
  const { sql, block, staff, access } = await gate(userId);
  if (block || !staff || access.access !== "ok") return block ?? fail("Forbidden.", "FORBIDDEN");
  let target = staff;
  let viewing = false;
  if (asId && staff.role === "ADMIN" && asId !== staff.id) {
    const other = await staffById(sql, asId);
    if (!other || other.role !== "DRIVER") return fail("Driver not found.", "NOT_FOUND");
    target = other;
    viewing = true;
  }
  const rows =
    staff.role === "ADMIN" && !viewing
      ? await sql.query<AlertRow>(`${ALERT_SELECT} order by a.created_at desc limit 80`, [])
      : await sql.query<AlertRow>(
          `${ALERT_SELECT} where a.driver_id = $1 or (a.driver_id is null and a.type = 'SYSTEM') order by a.created_at desc limit 40`,
          [target.id],
        );
  return { success: true as const, alerts: rows.map(toAlert) };
}

export async function ackAlert(userId: string, alertId: string) {
  const { sql, block, staff } = await gate(userId);
  if (block || !staff) return block ?? fail("Forbidden.", "FORBIDDEN");
  const rows = await sql<{ id: string; driver_id: string | null; type: string }>`
    select id, driver_id, type from alerts where id = ${alertId} limit 1
  `;
  const alert = rows[0];
  if (!alert) return fail("Alert not found.", "NOT_FOUND");
  if (staff.role !== "ADMIN" && alert.driver_id && alert.driver_id !== staff.id) {
    return fail("That alert is not yours.", "FORBIDDEN");
  }
  await sql`update alerts set acknowledged = true where id = ${alertId}`;
  return { success: true as const };
}

export async function loadChat(userId: string) {
  const { sql, block, staff } = await gate(userId);
  if (block || !staff) return block ?? fail("Forbidden.", "FORBIDDEN");
  const messages = await sql<{
    id: string;
    body: string;
    created_at: string | Date;
    sender_id: string;
    sender_name: string;
    sender_role: Role;
  }>`
    select * from (
      select m.id, m.body, m.created_at, m.sender_id, s.name as sender_name, s.role as sender_role
      from chat_messages m
      join staff s on s.id = m.sender_id
      order by m.created_at desc
      limit 80
    ) t
    order by created_at asc
  `;
  const online = await sql<{ id: string; name: string; role: Role }>`
    select id, name, role from staff
    where deleted_at is null and status = 'ACTIVE' and presence in ('ONLINE', 'ON_RIDE')
    order by role, name
  `;
  return {
    success: true as const,
    messages: messages.map(
      (m): ChatDto => ({
        id: m.id,
        body: m.body,
        createdAt: iso(m.created_at) ?? "",
        senderId: m.sender_id,
        senderName: m.sender_name,
        senderRole: m.sender_role,
      }),
    ),
    online: online.map((p) => ({ id: p.id, name: p.name, role: p.role })),
  };
}

export async function sendChat(userId: string, body: string) {
  const { sql, block, staff } = await gate(userId);
  if (block || !staff) return block ?? fail("Forbidden.", "FORBIDDEN");
  const clean = sanitizeChat(body ?? "");
  if (!clean.success) return clean;
  const id = randomUUID();
  await sql`
    insert into chat_messages (id, sender_id, body) values (${id}, ${staff.id}, ${clean.text})
  `;
  return { success: true as const, id };
}

export async function loadPrices(userId: string) {
  const { sql, block } = await gate(userId);
  if (block) return block ?? fail("Forbidden.", "FORBIDDEN");
  const rows = await sql<PriceRow>`select * from destination_prices order by enabled desc, name asc`;
  return { success: true as const, prices: rows.map(toPrice) };
}

export async function savePrice(
  userId: string,
  input: {
    id?: string;
    name: string;
    basePrice: number;
    perKm: number;
    perMin: number;
    minFare?: number;
    latitude?: number | null;
    longitude?: number | null;
    enabled: boolean;
  },
) {
  const { sql, block, staff } = await gate(userId, "ADMIN");
  if (block || !staff) return block ?? fail("Forbidden.", "FORBIDDEN");
  const checked = validatePrice(input);
  if (!checked.success) return checked;
  const lat = input.latitude == null ? null : num(input.latitude);
  const lng = input.longitude == null ? null : num(input.longitude);
  if ((lat == null) !== (lng == null) || (lat != null && lng != null && !isValidCoord(lat, lng))) {
    return fail("Map coordinates for the destination are incomplete.", "VALIDATION");
  }
  try {
    if (input.id) {
      const existing = await sql<{ id: string }>`select id from destination_prices where id = ${input.id} limit 1`;
      if (!existing.length) return fail("Destination not found.", "NOT_FOUND");
      await sql`
        update destination_prices set
          name = ${checked.name},
          base_price = ${checked.basePrice},
          per_km = ${checked.perKm},
          per_min = ${checked.perMin},
          min_fare = ${checked.minFare},
          latitude = ${lat},
          longitude = ${lng},
          enabled = ${input.enabled},
          updated_at = now()
        where id = ${input.id}
      `;
      await logActivity(sql, {
        type: "PRICE_EDITED",
        actorId: staff.id,
        actorName: staff.name,
        description: `${staff.name} edited the price for ${checked.name}`,
        entityType: "price",
        entityId: input.id,
      });
      return { success: true as const, id: input.id };
    }
    const id = randomUUID();
    await sql`
      insert into destination_prices (id, name, base_price, per_km, per_min, min_fare, latitude, longitude, enabled)
      values (${id}, ${checked.name}, ${checked.basePrice}, ${checked.perKm}, ${checked.perMin}, ${checked.minFare}, ${lat}, ${lng}, ${input.enabled})
    `;
    await logActivity(sql, {
      type: "PRICE_CREATED",
      actorId: staff.id,
      actorName: staff.name,
      description: `${staff.name} added the price for ${checked.name}`,
      entityType: "price",
      entityId: id,
    });
    return { success: true as const, id };
  } catch (err) {
    if (uniqueViolation(err)) return fail("A destination with that name already exists.", "CONFLICT");
    throw err;
  }
}

export async function removePrice(userId: string, id: string) {
  const { sql, block, staff } = await gate(userId, "ADMIN");
  if (block || !staff) return block ?? fail("Forbidden.", "FORBIDDEN");
  const rows = await sql<{ name: string }>`delete from destination_prices where id = ${id} returning name`;
  if (!rows.length) return fail("Destination not found.", "NOT_FOUND");
  await logActivity(sql, {
    type: "PRICE_DELETED",
    actorId: staff.id,
    actorName: staff.name,
    description: `${staff.name} deleted the price for ${rows[0]!.name}`,
    entityType: "price",
    entityId: id,
  });
  return { success: true as const };
}

export async function loadAccounts(userId: string) {
  const { sql, block, access } = await gate(userId, "ADMIN");
  if (block || access.access !== "ok") return block ?? fail("Forbidden.", "FORBIDDEN");
  const rows = await sql.query<StaffRow>(`${STAFF_SELECT} order by s.deleted_at is not null, s.role, s.name`, []);
  return {
    success: true as const,
    accounts: rows.map((r) => toStaff(r, access.settings.staleSeconds)),
    adminCount: rows.filter((r) => r.role === "ADMIN" && !r.deleted_at).length,
    driverCount: rows.filter((r) => r.role === "DRIVER" && !r.deleted_at).length,
    maxAdmins: access.settings.maxAdmins,
    maxDrivers: MAX_DRIVERS,
    demo: dbSource === "pglite",
  };
}

export async function createAccount(
  userId: string,
  input: {
    role: Role;
    name: string;
    email: string;
    phone?: string;
    password: string;
    vehicle?: string;
    plate?: string;
    driverCode?: string;
  },
) {
  const opened = await gate(userId, "ADMIN");
  if (opened.block || !opened.staff || opened.access.access !== "ok") return opened.block ?? fail("Forbidden.", "FORBIDDEN");
  const { sql, staff } = opened;
  const adminCap = opened.access.settings.maxAdmins;
  if (input.role !== "ADMIN" && input.role !== "DRIVER") return fail("Role is invalid.", "VALIDATION");
  const name = cleanText(input.name ?? "", "Name", 2, 80);
  if (!name.success) return name;
  const email = normalizeEmail(input.email ?? "");
  if (!email) return fail("Email is invalid.", "VALIDATION");
  const password = validatePassword(input.password ?? "");
  if (!password.success) return password;
  const phone = (input.phone ?? "").replace(/<[^>]*>/g, "").trim().slice(0, 32);
  let vehicle = "";
  let plate = "";
  let driverCode: string | null = null;
  if (input.role === "DRIVER") {
    const v = cleanText(input.vehicle ?? "", "Vehicle", 2, 60);
    if (!v.success) return v;
    const p = cleanText(input.plate ?? "", "Plate", 2, 16);
    if (!p.success) return p;
    vehicle = v.text;
    plate = p.text.toUpperCase();
    const codes = await sql<{ driver_code: string }>`
      select driver_code from staff where driver_code is not null and deleted_at is null
    `;
    const requested = (input.driverCode ?? "").trim().toUpperCase();
    driverCode = requested || nextDriverCode(codes.map((c) => c.driver_code));
    if (!/^D-\d{2,3}$/.test(driverCode) && requested) {
      return fail("Driver ID should look like D-06.", "VALIDATION");
    }
  }
  const current = await countRole(sql, input.role);
  if (input.role === "ADMIN" ? current >= adminCap : !canCreateAccount(input.role, current)) {
    return input.role === "ADMIN"
      ? fail("The configured administrator limit has been reached.", "ADMIN_LIMIT_REACHED")
      : fail("Maximum of 50 driver accounts reached.", "DRIVER_LIMIT_REACHED");
  }
  const emailTaken = await sql<{ id: string }>`
    select id from staff where lower(email) = ${email} and deleted_at is null limit 1
  `;
  if (emailTaken.length) return fail("That email is already used by a staff account.", "EMAIL_IN_USE");
  const userTaken = await sql<{ id: string }>`select "id" from "user" where lower("email") = ${email} limit 1`;
  if (userTaken.length) return fail("That email is already registered.", "EMAIL_IN_USE");
  try {
    const newUserId = await createCredentialUser(sql, name.text, email, input.password);
    const id = randomUUID();
    await sql`
      insert into staff (id, user_id, role, name, email, phone, status, driver_code, vehicle, plate, presence)
      values (
        ${id}, ${newUserId}, ${input.role}, ${name.text}, ${email}, ${phone}, 'ACTIVE',
        ${driverCode}, ${vehicle}, ${plate}, 'OFFLINE'
      )
    `;
    await logActivity(sql, {
      type: "ACCOUNT_CREATED",
      actorId: staff.id,
      actorName: staff.name,
      description: `${staff.name} created ${input.role === "ADMIN" ? "administrator" : "driver"} ${name.text}`,
      entityType: "staff",
      entityId: id,
    });
    return { success: true as const, id };
  } catch (err) {
    if (uniqueViolation(err)) return fail("That email or driver ID is already in use.", "CONFLICT");
    throw err;
  }
}

export async function updateAccount(
  userId: string,
  input: {
    id: string;
    name?: string;
    phone?: string;
    vehicle?: string;
    plate?: string;
    driverCode?: string;
    role?: Role;
    status?: AccountStatus;
    deleted?: boolean;
    password?: string;
  },
) {
  const opened = await gate(userId, "ADMIN");
  if (opened.block || !opened.staff || opened.access.access !== "ok") return opened.block ?? fail("Forbidden.", "FORBIDDEN");
  const { sql, staff } = opened;
  const adminCap = opened.access.settings.maxAdmins;
  const target = await staffById(sql, input.id);
  if (!target) return fail("Account not found.", "NOT_FOUND");
  if (input.deleted === true) {
    if (target.id === staff.id) return fail("You cannot delete your own account.", "VALIDATION");
    if (target.role === "ADMIN" && target.status === "ACTIVE" && !target.deleted_at) {
      const n = await sql<{ n: number }>`
        select count(*)::int as n from staff
        where role = 'ADMIN' and status = 'ACTIVE' and deleted_at is null
      `;
      if ((n[0]?.n ?? 0) <= 1) return fail("The last active administrator cannot be removed.", "LAST_ADMIN");
    }
    await sql`
      update staff set deleted_at = now(), status = 'DISABLED', presence = 'OFFLINE', speed_kmh = 0, updated_at = now()
      where id = ${target.id}
    `;
    await logActivity(sql, {
      type: "ACCOUNT_DELETED",
      actorId: staff.id,
      actorName: staff.name,
      description: `${staff.name} deleted ${target.name}`,
      entityType: "staff",
      entityId: target.id,
    });
    return { success: true as const };
  }
  if (input.deleted === false) {
    if (!target.deleted_at) return { success: true as const };
    const current = await countRole(sql, target.role);
    if (target.role === "ADMIN" ? current >= adminCap : !canCreateAccount(target.role, current)) {
      return target.role === "ADMIN"
        ? fail("The configured administrator limit has been reached.", "ADMIN_LIMIT_REACHED")
        : fail("Maximum of 50 driver accounts reached.", "DRIVER_LIMIT_REACHED");
    }
    await sql`
      update staff set deleted_at = null, status = 'ACTIVE', updated_at = now() where id = ${target.id}
    `;
    await logActivity(sql, {
      type: "ACCOUNT_RESTORED",
      actorId: staff.id,
      actorName: staff.name,
      description: `${staff.name} restored ${target.name}`,
      entityType: "staff",
      entityId: target.id,
    });
    return { success: true as const };
  }

  const name = input.name != null ? cleanText(input.name, "Name", 2, 80) : { success: true as const, text: target.name };
  if (!name.success) return name;
  const phone = input.phone != null ? input.phone.replace(/<[^>]*>/g, "").trim().slice(0, 32) : target.phone;
  let role = target.role;
  if (input.role && input.role !== target.role) {
    if (input.role !== "ADMIN" && input.role !== "DRIVER") return fail("Role is invalid.", "VALIDATION");
    if (target.role === "ADMIN" && target.id === staff.id) return fail("You cannot change your own role.", "VALIDATION");
    const current = await countRole(sql, input.role);
    if (input.role === "ADMIN" ? current >= adminCap : !canCreateAccount(input.role, current)) {
      return input.role === "ADMIN"
        ? fail("The configured administrator limit has been reached.", "ADMIN_LIMIT_REACHED")
        : fail("Maximum of 50 driver accounts reached.", "DRIVER_LIMIT_REACHED");
    }
    if (target.role === "ADMIN" && target.status === "ACTIVE") {
      const n = await sql<{ n: number }>`
        select count(*)::int as n from staff where role = 'ADMIN' and status = 'ACTIVE' and deleted_at is null
      `;
      if ((n[0]?.n ?? 0) <= 1) return fail("The last active administrator cannot be changed.", "LAST_ADMIN");
    }
    role = input.role;
  }
  let status = target.status;
  if (input.status && input.status !== target.status) {
    if (input.status !== "ACTIVE" && input.status !== "DISABLED") return fail("Status is invalid.", "VALIDATION");
    if (input.status === "DISABLED" && target.role === "ADMIN" && target.status === "ACTIVE") {
      if (target.id === staff.id) return fail("You cannot disable your own account.", "VALIDATION");
      const n = await sql<{ n: number }>`
        select count(*)::int as n from staff where role = 'ADMIN' and status = 'ACTIVE' and deleted_at is null
      `;
      if ((n[0]?.n ?? 0) <= 1) return fail("The last active administrator cannot be disabled.", "LAST_ADMIN");
    }
    status = input.status;
  }
  let vehicle = target.vehicle;
  let plate = target.plate;
  let driverCode = target.driver_code;
  if (role === "DRIVER") {
    const v = cleanText(input.vehicle ?? vehicle, "Vehicle", 2, 60);
    if (!v.success) return v;
    const p = cleanText(input.plate ?? plate, "Plate", 2, 16);
    if (!p.success) return p;
    vehicle = v.text;
    plate = p.text.toUpperCase();
    if (input.driverCode) {
      const code = input.driverCode.trim().toUpperCase();
      if (!/^D-\d{2,3}$/.test(code)) return fail("Driver ID should look like D-06.", "VALIDATION");
      driverCode = code;
    }
  }
  if (input.password) {
    const pwd = validatePassword(input.password);
    if (!pwd.success) return pwd;
    if (!target.user_id) return fail("This profile has no login yet.", "VALIDATION");
    const hash = await hashPassword(input.password);
    const updated = await sql<{ id: string }>`
      update "account" set "password" = ${hash}, "updatedAt" = now()
      where "userId" = ${target.user_id} and "providerId" = 'credential'
      returning "id"
    `;
    if (!updated.length) return fail("This account signs in without a password, so it cannot be reset here.", "VALIDATION");
  }
  try {
    await sql`
      update staff set
        name = ${name.text},
        phone = ${phone},
        role = ${role},
        status = ${status},
        vehicle = ${vehicle},
        plate = ${plate},
        driver_code = ${driverCode},
        presence = case when ${status} = 'DISABLED' then 'OFFLINE' else presence end,
        speed_kmh = case when ${status} = 'DISABLED' then 0 else speed_kmh end,
        updated_at = now()
      where id = ${target.id}
    `;
  } catch (err) {
    if (uniqueViolation(err)) return fail("That driver ID is already in use.", "CONFLICT");
    throw err;
  }
  if (target.user_id && name.text !== target.name) {
    await sql`update "user" set "name" = ${name.text}, "updatedAt" = now() where "id" = ${target.user_id}`;
  }
  await logActivity(sql, {
    type: status === "DISABLED" && target.status !== "DISABLED" ? "ACCOUNT_DISABLED" : "ACCOUNT_MODIFIED",
    actorId: staff.id,
    actorName: staff.name,
    description: `${staff.name} updated ${name.text}`,
    entityType: "staff",
    entityId: target.id,
  });
  return { success: true as const };
}

export async function loadActivity(userId: string) {
  const { sql, block } = await gate(userId, "ADMIN");
  if (block) return block ?? fail("Forbidden.", "FORBIDDEN");
  const rows = await sql<{
    id: string;
    event_type: string;
    actor_name: string | null;
    description: string;
    created_at: string | Date;
    entity_type: string | null;
    entity_id: string | null;
  }>`
    select id, event_type, actor_name, description, created_at, entity_type, entity_id
    from activity_log order by created_at desc limit 300
  `;
  const activity: ActivityDto[] = rows.map((a) => ({
    id: a.id,
    eventType: a.event_type,
    actorName: a.actor_name,
    description: a.description,
    createdAt: iso(a.created_at) ?? "",
    entityType: a.entity_type,
    entityId: a.entity_id,
  }));
  return { success: true as const, activity };
}

export async function loadReport(
  userId: string,
  filter: { from: string; to: string; driverId?: string; status?: string },
) {
  const { sql, block } = await gate(userId, "ADMIN");
  if (block) return block ?? fail("Forbidden.", "FORBIDDEN");
  const from = /^\d{4}-\d{2}-\d{2}$/.test(filter.from) ? filter.from : "";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(filter.to) ? filter.to : "";
  if (!from || !to || from > to) return fail("Choose a valid date range.", "VALIDATION");
  const where = [
    `(o.created_at at time zone '${ZONE}')::date >= $1::date`,
    `(o.created_at at time zone '${ZONE}')::date <= $2::date`,
  ];
  const params: unknown[] = [from, to];
  if (filter.driverId) {
    params.push(filter.driverId);
    where.push(`o.driver_id = $${params.length}`);
  }
  if (filter.status && isOrderStatus(filter.status)) {
    params.push(filter.status);
    where.push(`o.status = $${params.length}`);
  }
  const orders = await listOrderRows(sql, `where ${where.join(" and ")} order by o.created_at desc limit 1000`, params);
  const kmRows = await sql.query<{ driver_id: string; km: number | string }>(
    `select driver_id, coalesce(sum(kilometers), 0) as km
     from driver_daily_km
     where km_date >= $1::date and km_date <= $2::date
     group by driver_id`,
    [from, to],
  );
  const kmMap = new Map(kmRows.map((r) => [r.driver_id, num(r.km) ?? 0]));
  const drivers = await sql<StaffRow>`select * from staff where role = 'DRIVER' and deleted_at is null order by name`;
  const byDriver = drivers
    .filter((d) => !filter.driverId || d.id === filter.driverId)
    .map((d) => {
      const mine = orders.filter((o) => o.driverId === d.id);
      return {
        id: d.id,
        name: d.name,
        driverCode: d.driver_code,
        vehicle: d.vehicle,
        plate: d.plate,
        orders: mine.length,
        completed: mine.filter((o) => o.status === "COMPLETED").length,
        cancelled: mine.filter((o) => o.status === "CANCELLED").length,
        revenue: round2(mine.filter((o) => o.status === "COMPLETED").reduce((s, o) => s + (o.priceEur ?? 0), 0)),
        km: round2(kmMap.get(d.id) ?? 0),
        tripKm: round2(mine.filter((o) => o.status === "COMPLETED").reduce((s, o) => s + (o.distanceKm ?? 0), 0)),
      };
    });
  const fleetKm = round2(byDriver.reduce((s, d) => s + d.km, 0));
  const tripKm = round2(orders.filter((o) => o.status === "COMPLETED").reduce((s, o) => s + (o.distanceKm ?? 0), 0));
  const fuelRows = await sql<{ cost: number | string; liters: number | string }>`
    select coalesce(sum(total_cost), 0) as cost, coalesce(sum(liters), 0) as liters
    from fuel_records
    where (filled_at at time zone ${ZONE})::date >= ${from}::date
      and (filled_at at time zone ${ZONE})::date <= ${to}::date
  `;
  const maintRows = await sql<{ cost: number | string; parts: number | string; labor: number | string }>`
    select coalesce(sum(total_cost), 0) as cost, coalesce(sum(parts_cost), 0) as parts, coalesce(sum(labor_cost), 0) as labor
    from maintenance_records
    where serviced_on >= ${from}::date and serviced_on <= ${to}::date
  `;
  const fuelCost = round2(num(fuelRows[0]?.cost) ?? 0);
  const fuelLiters = round2(num(fuelRows[0]?.liters) ?? 0);
  const maintCost = round2(num(maintRows[0]?.cost) ?? 0);
  const operating = round2(fuelCost + maintCost);
  return {
    success: true as const,
    from,
    to,
    ordersTotal: orders.length,
    completed: orders.filter((o) => o.status === "COMPLETED").length,
    cancelled: orders.filter((o) => o.status === "CANCELLED").length,
    active: orders.filter((o) => (ACTIVE_STATUSES as readonly string[]).includes(o.status)).length,
    fleetKm,
    tripKm,
    revenue: round2(orders.filter((o) => o.status === "COMPLETED").reduce((s, o) => s + (o.priceEur ?? 0), 0)),
    fuelCost,
    fuelLiters,
    maintCost,
    partsCost: round2(num(maintRows[0]?.parts) ?? 0),
    laborCost: round2(num(maintRows[0]?.labor) ?? 0),
    operating,
    costPerKm: fleetKm > 0 ? round2(operating / fleetKm) : null,
    byDriver,
    orders,
  };
}

export async function loadSettings(userId: string) {
  const { block, access } = await gate(userId, "ADMIN");
  if (block || access.access !== "ok") return block ?? fail("Forbidden.", "FORBIDDEN");
  return {
    success: true as const,
    settings: access.settings,
    routing: routingMode(),
    limits: { maxAdmins: access.settings.maxAdmins, maxDrivers: MAX_DRIVERS },
    demo: dbSource === "pglite",
  };
}

export async function saveSettings(
  userId: string,
  input: {
    companyName: string;
    staleSeconds: number;
    speedAlertKmh: number;
    baseLabel: string;
    baseLat: number;
    baseLng: number;
    operatorName?: string;
    companyPhone?: string;
    fuelHigh?: number;
    serviceWarnDays?: number;
    startFare?: number;
    perKmRate?: number;
  },
) {
  const { sql, block, staff, access } = await gate(userId, "ADMIN");
  if (block || !staff || access.access !== "ok") return block ?? fail("Forbidden.", "FORBIDDEN");
  const company = cleanText(input.companyName ?? "", "Company name", 2, 40);
  if (!company.success) return company;
  const base = cleanText(input.baseLabel ?? "", "Base", 2, 80);
  if (!base.success) return base;
  const operator = input.operatorName != null && input.operatorName.trim()
    ? cleanText(input.operatorName, "Your name", 2, 80)
    : { success: true as const, text: staff.name };
  if (!operator.success) return operator;
  if (!Number.isFinite(input.staleSeconds) || input.staleSeconds < 30 || input.staleSeconds > 600) {
    return fail("Stale GPS threshold must be between 30 and 600 seconds.", "VALIDATION");
  }
  if (!Number.isFinite(input.speedAlertKmh) || input.speedAlertKmh < 40 || input.speedAlertKmh > 180) {
    return fail("Speed alert must be between 40 and 180 km/h.", "VALIDATION");
  }
  if (!isValidCoord(input.baseLat, input.baseLng)) return fail("Base coordinates are invalid.", "VALIDATION");
  const phone = (input.companyPhone ?? "").replace(/<[^>]*>/g, "").trim().slice(0, 40);
  const fuelHigh = input.fuelHigh == null ? access.settings.fuelHigh : Number(input.fuelHigh);
  const warnDays = input.serviceWarnDays == null ? access.settings.serviceWarnDays : Number(input.serviceWarnDays);
  if (!Number.isFinite(fuelHigh) || fuelHigh < 4 || fuelHigh > 40) {
    return fail("High fuel flag must be between 4 and 40 L/100 km.", "VALIDATION");
  }
  if (!Number.isFinite(warnDays) || warnDays < 1 || warnDays > 90) {
    return fail("Document warning must be between 1 and 90 days.", "VALIDATION");
  }
  const startFare = input.startFare == null ? access.settings.startFare : Number(input.startFare);
  const perKmRate = input.perKmRate == null ? access.settings.perKmRate : Number(input.perKmRate);
  if (!Number.isFinite(startFare) || startFare < 0 || startFare > 100) {
    return fail("Starting fare must be between 0 and 100 euros.", "VALIDATION");
  }
  if (!Number.isFinite(perKmRate) || perKmRate < 0 || perKmRate > 20) {
    return fail("Per-kilometre rate must be between 0 and 20 euros.", "VALIDATION");
  }
  const pairs: Array<[string, string]> = [
    ["company_name", company.text],
    ["company_phone", phone],
    ["stale_seconds", String(Math.round(input.staleSeconds))],
    ["speed_alert_kmh", String(Math.round(input.speedAlertKmh))],
    ["base_label", base.text],
    ["base_lat", String(input.baseLat)],
    ["base_lng", String(input.baseLng)],
    ["fuel_high_l_per_100", String(round2(fuelHigh))],
    ["service_warn_days", String(Math.round(warnDays))],
    ["start_fare", String(round2(startFare))],
    ["meter_per_km", String(round2(perKmRate))],
  ];
  for (const [key, value] of pairs) {
    await sql`
      insert into system_settings (key, value) values (${key}, ${value})
      on conflict (key) do update set value = excluded.value
    `;
  }
  if (operator.text !== staff.name) {
    await sql`update staff set name = ${operator.text}, updated_at = now() where id = ${staff.id}`;
    if (staff.user_id) {
      await sql`update "user" set "name" = ${operator.text}, "updatedAt" = now() where "id" = ${staff.user_id}`;
    }
  }
  await logActivity(sql, {
    type: "ACCOUNT_MODIFIED",
    actorId: staff.id,
    actorName: staff.name,
    description: `${staff.name} updated system settings`,
    entityType: "settings",
    entityId: "system",
  });
  return { success: true as const };
}

export async function loadDriverBoard(userId: string, asId?: string) {
  const { sql, block, staff, access } = await gate(userId);
  if (block || !staff || access.access !== "ok") return block ?? fail("Forbidden.", "FORBIDDEN");
  let target = staff;
  let viewing = false;
  if (staff.role === "ADMIN") {
    if (!asId) return fail("Choose a driver to preview.", "VALIDATION");
    const other = await staffById(sql, asId);
    if (!other || other.deleted_at || other.role !== "DRIVER") return fail("Driver not found.", "NOT_FOUND");
    target = other;
    viewing = true;
  } else if (asId && asId !== staff.id) {
    return fail("You can only open your own driver console.", "FORBIDDEN");
  }
  await ensureRealGps(sql);
  await ensureOffers(sql);
  const fresh = (await staffById(sql, target.id)) ?? target;
  const orders = await listOrderRows(
    sql,
    `where o.driver_id = $1
       or (
         o.driver_id is null
         and o.status = 'DISPATCHED'
         and exists (
           select 1 from order_offers f
           where f.order_id = o.id and f.driver_id = $1 and f.response = 'OFFERED'
         )
       )
     order by o.created_at desc limit 30`,
    [fresh.id],
  );
  const alerts = (
    await sql.query<AlertRow>(
      `${ALERT_SELECT} where a.driver_id = $1 or (a.driver_id is null and a.type = 'SYSTEM') order by a.created_at desc limit 20`,
      [fresh.id],
    )
  ).map(toAlert);
  return {
    success: true as const,
    viewing,
    driver: toStaff(fresh, access.settings.staleSeconds),
    orders,
    alerts,
  };
}
