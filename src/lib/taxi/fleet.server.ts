import { randomUUID } from "node:crypto";
import type { Sql } from "@/lib/db";
import { fail, fuelTotal, litersPer100, round2, unusualFuel } from "./logic";
import { openGate } from "./handlers.server";

type Actor = { id: string; name: string };

async function admin(userId: string) {
  const opened = await openGate(userId, "ADMIN");
  const settings = opened.access.access === "ok" ? opened.access.settings : null;
  if (opened.block || !opened.staff || !settings) return { ...opened, staff: null as Actor | null, settings };
  return { ...opened, staff: { id: opened.staff.id, name: opened.staff.name }, settings };
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function iso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}

function day(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function clean(raw: string, field: string, min: number, max: number) {
  const text = raw.replace(/<[^>]*>/g, "").replace(/[<>]/g, "").trim();
  if (text.length < min || text.length > max) return fail(`${field} must be ${min}–${max} characters.`, "VALIDATION");
  return { success: true as const, text };
}

async function note(sql: Sql, actor: Actor, type: string, description: string, entityType: string, entityId: string) {
  await sql`
    insert into activity_log (id, event_type, actor_id, actor_name, description, entity_type, entity_id)
    values (${randomUUID()}, ${type}, ${actor.id}, ${actor.name}, ${description}, ${entityType}, ${entityId})
  `;
}

const VEHICLE_STATUSES = ["AVAILABLE", "ASSIGNED", "ON_RIDE", "MAINTENANCE", "OUT_OF_SERVICE"] as const;
const FUELS = ["PETROL", "DIESEL", "LPG", "HYBRID", "ELECTRIC"] as const;

export async function loadVehicles(userId: string) {
  const { sql, block } = await admin(userId);
  if (block) return block;
  await sql`
    update vehicles v set status = case
      when v.status in ('MAINTENANCE', 'OUT_OF_SERVICE') then v.status
      when s.presence = 'ON_RIDE' then 'ON_RIDE'
      when s.id is not null then 'ASSIGNED'
      else 'AVAILABLE'
    end
    from staff s
    where v.assigned_driver_id = s.id and v.deleted_at is null
  `;
  const rows = await sql<{
    id: string;
    code: string;
    brand: string;
    model: string;
    year: number | null;
    plate: string;
    color: string;
    fuel_type: string;
    status: string;
    assigned_driver_id: string | null;
    driver_name: string | null;
    odometer_km: number | string;
    insurance_expires: string | Date | null;
    registration_expires: string | Date | null;
    inspection_expires: string | Date | null;
    last_service_on: string | Date | null;
    next_service_on: string | Date | null;
    next_service_km: number | string | null;
    notes: string;
  }>`
    select v.*, s.name as driver_name
    from vehicles v
    left join staff s on s.id = v.assigned_driver_id
    where v.deleted_at is null
    order by v.code
  `;
  return {
    success: true as const,
    vehicles: rows.map((r) => ({
      id: r.id,
      code: r.code,
      brand: r.brand,
      model: r.model,
      year: r.year,
      plate: r.plate,
      color: r.color,
      fuelType: r.fuel_type,
      status: r.status,
      driverId: r.assigned_driver_id,
      driverName: r.driver_name,
      odometerKm: round2(num(r.odometer_km) ?? 0),
      insuranceExpires: day(r.insurance_expires),
      registrationExpires: day(r.registration_expires),
      inspectionExpires: day(r.inspection_expires),
      lastServiceOn: day(r.last_service_on),
      nextServiceOn: day(r.next_service_on),
      nextServiceKm: num(r.next_service_km),
      notes: r.notes,
    })),
  };
}

export async function saveVehicle(
  userId: string,
  input: {
    id?: string;
    brand: string;
    model: string;
    year?: number | null;
    plate: string;
    color?: string;
    fuelType: string;
    status: string;
    driverId?: string | null;
    odometerKm?: number | null;
    insuranceExpires?: string | null;
    registrationExpires?: string | null;
    inspectionExpires?: string | null;
    nextServiceOn?: string | null;
    nextServiceKm?: number | null;
    notes?: string;
  },
) {
  const { sql, block, staff } = await admin(userId);
  if (block || !staff) return block ?? fail("Forbidden.", "FORBIDDEN");
  const brand = clean(input.brand ?? "", "Brand", 2, 40);
  if (!brand.success) return brand;
  const model = clean(input.model ?? "", "Model", 1, 40);
  if (!model.success) return model;
  const plate = clean((input.plate ?? "").toUpperCase(), "Plate", 2, 16);
  if (!plate.success) return plate;
  if (!(FUELS as readonly string[]).includes(input.fuelType)) return fail("Fuel type is invalid.", "VALIDATION");
  if (!(VEHICLE_STATUSES as readonly string[]).includes(input.status)) return fail("Vehicle status is invalid.", "VALIDATION");
  const year = input.year == null || input.year === 0 ? null : Number(input.year);
  if (year != null && (!Number.isInteger(year) || year < 1990 || year > 2035)) return fail("Year is invalid.", "VALIDATION");
  const odo = input.odometerKm == null ? null : Number(input.odometerKm);
  if (odo != null && (!Number.isFinite(odo) || odo < 0 || odo > 2_000_000)) return fail("Odometer is invalid.", "VALIDATION");
  const driverId = input.driverId || null;
  if (driverId) {
    const driver = await sql<{ id: string }>`
      select id from staff where id = ${driverId} and role = 'DRIVER' and deleted_at is null limit 1
    `;
    if (!driver.length) return fail("That driver does not exist.", "NOT_FOUND");
  }
  const dateOrNull = (v?: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const notes = (input.notes ?? "").replace(/<[^>]*>/g, "").trim().slice(0, 400);
  const id = input.id || randomUUID();
  const existing = await sql<{ id: string; odometer_km: number | string; assigned_driver_id: string | null }>`
    select id, odometer_km, assigned_driver_id from vehicles where id = ${id} and deleted_at is null limit 1
  `;
  if (input.id && !existing.length) return fail("Vehicle not found.", "NOT_FOUND");
  const previousDriver = existing[0]?.assigned_driver_id ?? null;
  if (!input.id) {
    const n = await sql<{ n: number }>`select count(*)::int as n from vehicles where deleted_at is null`;
    const code = `VH-${String((n[0]?.n ?? 0) + 1).padStart(2, "0")}`;
    await sql`
      insert into vehicles (
        id, code, brand, model, year, plate, color, fuel_type, status, assigned_driver_id, odometer_km,
        insurance_expires, registration_expires, inspection_expires, next_service_on, next_service_km, notes
      ) values (
        ${id}, ${code}, ${brand.text}, ${model.text}, ${year}, ${plate.text}, ${(input.color ?? "").slice(0, 24)},
        ${input.fuelType}, ${input.status}, ${driverId}, ${odo ?? 0},
        ${dateOrNull(input.insuranceExpires)}, ${dateOrNull(input.registrationExpires)}, ${dateOrNull(input.inspectionExpires)},
        ${dateOrNull(input.nextServiceOn)}, ${input.nextServiceKm ?? null}, ${notes}
      )
    `;
  } else {
    const prev = num(existing[0]?.odometer_km) ?? 0;
    await sql`
      update vehicles set
        brand = ${brand.text}, model = ${model.text}, year = ${year}, plate = ${plate.text},
        color = ${(input.color ?? "").slice(0, 24)}, fuel_type = ${input.fuelType}, status = ${input.status},
        assigned_driver_id = ${driverId},
        odometer_km = ${odo ?? prev},
        insurance_expires = ${dateOrNull(input.insuranceExpires)},
        registration_expires = ${dateOrNull(input.registrationExpires)},
        inspection_expires = ${dateOrNull(input.inspectionExpires)},
        next_service_on = ${dateOrNull(input.nextServiceOn)},
        next_service_km = ${input.nextServiceKm ?? null},
        notes = ${notes}, updated_at = now()
      where id = ${id}
    `;
    if (odo != null && odo !== prev) {
      await sql`
        insert into odometer_records (id, vehicle_id, driver_id, previous_km, next_km, source, note, actor_id)
        values (${randomUUID()}, ${id}, ${driverId}, ${prev}, ${odo}, 'MANUAL', 'Desk adjustment', ${staff.id})
      `;
    }
  }
  if (previousDriver && previousDriver !== driverId) {
    await sql`
      update staff set vehicle_id = null, vehicle = '', plate = '', updated_at = now()
      where id = ${previousDriver} and vehicle_id = ${id}
    `;
  }
  if (driverId) {
    await sql`
      update staff set vehicle_id = ${id}, vehicle = ${`${brand.text} ${model.text}`}, plate = ${plate.text}, updated_at = now()
      where id = ${driverId}
    `;
    await sql`
      update vehicles set assigned_driver_id = null, updated_at = now()
      where assigned_driver_id = ${driverId} and id <> ${id} and deleted_at is null
    `;
  }
  await note(sql, staff, input.id ? "VEHICLE_EDITED" : "VEHICLE_CREATED", `${staff.name} saved ${brand.text} ${model.text} ${plate.text}`, "vehicle", id);
  return { success: true as const, id };
}

export async function loadFuel(userId: string) {
  const { sql, block } = await admin(userId);
  if (block) return block;
  const rows = await sql<{
    id: string;
    vehicle_id: string;
    plate: string;
    brand: string;
    model: string;
    driver_name: string | null;
    filled_at: string | Date;
    fuel_type: string;
    liters: number | string;
    price_per_liter: number | string;
    total_cost: number | string;
    station: string;
    odometer_km: number | string | null;
    full_tank: boolean;
    reference_no: string;
    notes: string;
  }>`
    select f.*, v.plate, v.brand, v.model, s.name as driver_name
    from fuel_records f
    join vehicles v on v.id = f.vehicle_id
    left join staff s on s.id = f.driver_id
    order by f.filled_at desc
    limit 200
  `;
  return {
    success: true as const,
    records: rows.map((r) => ({
      id: r.id,
      vehicleId: r.vehicle_id,
      vehicle: `${r.brand} ${r.model}`,
      plate: r.plate,
      driverName: r.driver_name,
      filledAt: iso(r.filled_at) ?? "",
      fuelType: r.fuel_type,
      liters: round2(num(r.liters) ?? 0),
      pricePerLiter: round2(num(r.price_per_liter) ?? 0),
      totalCost: round2(num(r.total_cost) ?? 0),
      station: r.station,
      odometerKm: num(r.odometer_km),
      fullTank: r.full_tank === true,
      referenceNo: r.reference_no,
      notes: r.notes,
    })),
  };
}

export async function saveFuel(
  userId: string,
  input: {
    vehicleId: string;
    driverId?: string | null;
    filledAt?: string;
    fuelType: string;
    liters: number;
    pricePerLiter: number;
    station?: string;
    odometerKm?: number | null;
    fullTank?: boolean;
    referenceNo?: string;
    notes?: string;
  },
) {
  const { sql, block, staff, settings } = await admin(userId);
  if (block || !staff) return block ?? fail("Forbidden.", "FORBIDDEN");
  const liters = Number(input.liters);
  const price = Number(input.pricePerLiter);
  if (!Number.isFinite(liters) || liters <= 0 || liters > 200) return fail("Liters must be between 0 and 200.", "VALIDATION");
  if (!Number.isFinite(price) || price < 0 || price > 20) return fail("Price per liter is invalid.", "VALIDATION");
  if (!(FUELS as readonly string[]).includes(input.fuelType)) return fail("Fuel type is invalid.", "VALIDATION");
  const vehicle = await sql<{ id: string; plate: string; odometer_km: number | string }>`
    select id, plate, odometer_km from vehicles where id = ${input.vehicleId} and deleted_at is null limit 1
  `;
  if (!vehicle.length) return fail("Vehicle not found.", "NOT_FOUND");
  const total = fuelTotal(liters, price);
  const when = input.filledAt && !Number.isNaN(new Date(input.filledAt).getTime()) ? new Date(input.filledAt).toISOString() : new Date().toISOString();
  const id = randomUUID();
  const odo = input.odometerKm == null || input.odometerKm === ("" as unknown) ? null : Number(input.odometerKm);
  if (odo != null && (!Number.isFinite(odo) || odo < 0)) return fail("Odometer is invalid.", "VALIDATION");
  await sql`
    insert into fuel_records (
      id, vehicle_id, driver_id, filled_at, fuel_type, liters, price_per_liter, total_cost,
      station, odometer_km, full_tank, reference_no, notes, created_by
    ) values (
      ${id}, ${input.vehicleId}, ${input.driverId || null}, ${when}, ${input.fuelType}, ${liters}, ${price}, ${total},
      ${(input.station ?? "").slice(0, 80)}, ${odo}, ${input.fullTank !== false}, ${(input.referenceNo ?? "").slice(0, 40)},
      ${(input.notes ?? "").replace(/<[^>]*>/g, "").slice(0, 400)}, ${staff.id}
    )
  `;
  const prev = num(vehicle[0]!.odometer_km) ?? 0;
  if (odo != null && odo > prev) {
    await sql`update vehicles set odometer_km = ${odo}, updated_at = now() where id = ${input.vehicleId}`;
    await sql`
      insert into odometer_records (id, vehicle_id, previous_km, next_km, source, note, actor_id)
      values (${randomUUID()}, ${input.vehicleId}, ${prev}, ${odo}, 'FUEL', 'Odometer at fill', ${staff.id})
    `;
  }
  const since = await sql<{ liters: number | string; km: number | string }>`
    select
      coalesce(sum(f.liters), 0) as liters,
      coalesce((
        select sum(kilometers) from driver_daily_km
        where driver_id = (select assigned_driver_id from vehicles where id = ${input.vehicleId})
          and km_date >= (now() at time zone 'Europe/Belgrade')::date - 30
      ), 0) as km
    from fuel_records f
    where f.vehicle_id = ${input.vehicleId} and f.filled_at > now() - interval '30 days'
  `;
  const rate = litersPer100(num(since[0]?.liters) ?? 0, num(since[0]?.km) ?? 0);
  if (unusualFuel(rate, settings?.fuelHigh ?? 12)) {
    await sql`
      insert into alerts (id, type, title, body, driver_id, actor_id)
      values (
        ${randomUUID()}, 'FUEL', 'High fuel consumption',
        ${`${vehicle[0]!.plate} is at ${rate} L/100 km over the last 30 days. This is a data flag, not a mechanical diagnosis.`},
        ${input.driverId || null}, ${staff.id}
      )
    `;
  }
  await note(sql, staff, "FUEL_RECORDED", `${staff.name} recorded ${liters} L (${total} €) for ${vehicle[0]!.plate}`, "fuel", id);
  return { success: true as const, id, totalCost: total, litersPer100: rate };
}

export async function loadMaintenance(userId: string) {
  const { sql, block } = await admin(userId);
  if (block) return block;
  const rows = await sql<{
    id: string;
    vehicle_id: string;
    plate: string;
    brand: string;
    model: string;
    serviced_on: string | Date;
    kind: string;
    description: string;
    supplier: string;
    parts_cost: number | string;
    labor_cost: number | string;
    total_cost: number | string;
    odometer_km: number | string | null;
    next_service_on: string | Date | null;
    reference_no: string;
    status: string;
  }>`
    select m.*, v.plate, v.brand, v.model
    from maintenance_records m
    join vehicles v on v.id = m.vehicle_id
    order by m.serviced_on desc
    limit 200
  `;
  return {
    success: true as const,
    records: rows.map((r) => ({
      id: r.id,
      vehicleId: r.vehicle_id,
      vehicle: `${r.brand} ${r.model}`,
      plate: r.plate,
      servicedOn: day(r.serviced_on) ?? "",
      kind: r.kind,
      description: r.description,
      supplier: r.supplier,
      partsCost: round2(num(r.parts_cost) ?? 0),
      laborCost: round2(num(r.labor_cost) ?? 0),
      totalCost: round2(num(r.total_cost) ?? 0),
      odometerKm: num(r.odometer_km),
      nextServiceOn: day(r.next_service_on),
      referenceNo: r.reference_no,
      status: r.status,
    })),
  };
}

const KINDS = ["OIL", "TIRES", "BRAKES", "BATTERY", "ENGINE", "SUSPENSION", "ELECTRICAL", "BODY", "INSPECTION", "REGISTRATION", "INSURANCE", "OTHER"];

export async function saveMaintenance(
  userId: string,
  input: {
    vehicleId: string;
    servicedOn: string;
    kind: string;
    description: string;
    supplier?: string;
    partsCost: number;
    laborCost: number;
    odometerKm?: number | null;
    nextServiceOn?: string | null;
    nextServiceKm?: number | null;
    referenceNo?: string;
    notes?: string;
  },
) {
  const { sql, block, staff, settings } = await admin(userId);
  if (block || !staff) return block ?? fail("Forbidden.", "FORBIDDEN");
  if (!KINDS.includes(input.kind)) return fail("Maintenance type is invalid.", "VALIDATION");
  const description = clean(input.description ?? "", "Description", 2, 240);
  if (!description.success) return description;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.servicedOn ?? "")) return fail("Service date is invalid.", "VALIDATION");
  const parts = Number(input.partsCost);
  const labor = Number(input.laborCost);
  if (!Number.isFinite(parts) || parts < 0 || !Number.isFinite(labor) || labor < 0) return fail("Costs cannot be negative.", "VALIDATION");
  const total = round2(parts + labor);
  const vehicle = await sql<{ id: string; plate: string }>`select id, plate from vehicles where id = ${input.vehicleId} and deleted_at is null limit 1`;
  if (!vehicle.length) return fail("Vehicle not found.", "NOT_FOUND");
  const id = randomUUID();
  const nextOn = input.nextServiceOn && /^\d{4}-\d{2}-\d{2}$/.test(input.nextServiceOn) ? input.nextServiceOn : null;
  await sql`
    insert into maintenance_records (
      id, vehicle_id, serviced_on, kind, description, supplier, parts_cost, labor_cost, total_cost,
      odometer_km, next_service_on, next_service_km, reference_no, notes, status, created_by
    ) values (
      ${id}, ${input.vehicleId}, ${input.servicedOn}, ${input.kind}, ${description.text},
      ${(input.supplier ?? "").slice(0, 80)}, ${parts}, ${labor}, ${total},
      ${input.odometerKm ?? null}, ${nextOn}, ${input.nextServiceKm ?? null},
      ${(input.referenceNo ?? "").slice(0, 40)}, ${(input.notes ?? "").replace(/<[^>]*>/g, "").slice(0, 400)},
      'DONE', ${staff.id}
    )
  `;
  await sql`
    update vehicles set
      last_service_on = ${input.servicedOn},
      next_service_on = coalesce(${nextOn}, next_service_on),
      next_service_km = coalesce(${input.nextServiceKm ?? null}, next_service_km),
      updated_at = now()
    where id = ${input.vehicleId}
  `;
  if (nextOn) {
    const due = new Date(nextOn).getTime() - Date.now();
    if (due < (settings?.serviceWarnDays ?? 14) * 86400000) {
      await sql`
        insert into alerts (id, type, title, body, actor_id)
        values (
          ${randomUUID()}, 'MAINTENANCE', 'Service due soon',
          ${`${vehicle[0]!.plate}: next ${input.kind.toLowerCase()} service ${nextOn}.`},
          ${staff.id}
        )
      `;
    }
  }
  await note(sql, staff, "MAINTENANCE_RECORDED", `${staff.name} recorded ${input.kind.toLowerCase()} on ${vehicle[0]!.plate} (${total} €)`, "maintenance", id);
  return { success: true as const, id, totalCost: total };
}

export async function loadFleetCosts(userId: string) {
  const { sql, block } = await admin(userId);
  if (block) return block;
  const vehicles = await sql<{
    id: string;
    code: string;
    brand: string;
    model: string;
    plate: string;
    status: string;
    odometer_km: number | string;
    fuel: number | string;
    liters: number | string;
    maintenance: number | string;
    km: number | string;
  }>`
    select v.id, v.code, v.brand, v.model, v.plate, v.status, v.odometer_km,
      coalesce((select sum(total_cost) from fuel_records f where f.vehicle_id = v.id and f.filled_at >= date_trunc('month', now())), 0) as fuel,
      coalesce((select sum(liters) from fuel_records f where f.vehicle_id = v.id and f.filled_at >= date_trunc('month', now())), 0) as liters,
      coalesce((select sum(total_cost) from maintenance_records m where m.vehicle_id = v.id and m.serviced_on >= date_trunc('month', now())::date), 0) as maintenance,
      coalesce((select sum(k.kilometers) from driver_daily_km k where k.driver_id = v.assigned_driver_id and k.km_date >= date_trunc('month', (now() at time zone 'Europe/Belgrade'))::date), 0) as km
    from vehicles v
    where v.deleted_at is null
    order by v.code
  `;
  const daily = await sql<{ km_date: string | Date; kilometers: number | string }>`
    select km_date, sum(kilometers) as kilometers
    from driver_daily_km
    where km_date >= (now() at time zone 'Europe/Belgrade')::date - 13
    group by km_date
    order by km_date
  `;
  const mapped = vehicles.map((v) => {
    const fuel = round2(num(v.fuel) ?? 0);
    const maintenance = round2(num(v.maintenance) ?? 0);
    const km = round2(num(v.km) ?? 0);
    const operating = round2(fuel + maintenance);
    return {
      id: v.id,
      code: v.code,
      name: `${v.brand} ${v.model}`,
      plate: v.plate,
      status: v.status,
      odometerKm: round2(num(v.odometer_km) ?? 0),
      fuel,
      liters: round2(num(v.liters) ?? 0),
      maintenance,
      km,
      operating,
      perKm: km > 0 ? round2(operating / km) : null,
      lPer100: litersPer100(num(v.liters) ?? 0, km),
    };
  });
  const fuel = round2(mapped.reduce((s, v) => s + v.fuel, 0));
  const maintenance = round2(mapped.reduce((s, v) => s + v.maintenance, 0));
  const km = round2(mapped.reduce((s, v) => s + v.km, 0));
  return {
    success: true as const,
    month: { fuel, maintenance, operating: round2(fuel + maintenance), km, perKm: km > 0 ? round2((fuel + maintenance) / km) : null },
    vehicles: mapped,
    dailyKm: daily.map((d) => ({ date: day(d.km_date) ?? "", km: round2(num(d.kilometers) ?? 0) })),
  };
}
