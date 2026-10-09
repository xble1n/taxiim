import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getFleet, getFleetCosts, getFuel, getMaintenance, getVehicles, saveFuel, saveMaintenance, saveVehicle } from "@/lib/taxi/api";
import { eur, isFail, kmText } from "@/lib/taxi/format";
import { Banner, Btn, Empty, Field, PageHead, fieldClass } from "./ui";

const FUELS = ["PETROL", "DIESEL", "LPG", "HYBRID", "ELECTRIC"] as const;
const STATUSES = ["AVAILABLE", "ASSIGNED", "ON_RIDE", "MAINTENANCE", "OUT_OF_SERVICE"] as const;
const KINDS = ["OIL", "TIRES", "BRAKES", "BATTERY", "ENGINE", "SUSPENSION", "ELECTRICAL", "BODY", "INSPECTION", "REGISTRATION", "INSURANCE", "OTHER"] as const;

function money(n: number) {
  return eur(n);
}

export function VehiclesPage() {
  const qc = useQueryClient();
  const vehicles = useQuery({ queryKey: ["vehicles"], queryFn: () => getVehicles() });
  const fleet = useQuery({ queryKey: ["fleet"], queryFn: () => getFleet() });
  const [error, setError] = useState<string | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [form, setForm] = useState({
    id: "",
    brand: "",
    model: "",
    year: "",
    plate: "",
    color: "",
    fuelType: "PETROL",
    status: "AVAILABLE",
    driverId: "",
    odometerKm: "",
    insuranceExpires: "",
    registrationExpires: "",
    inspectionExpires: "",
    nextServiceOn: "",
    notes: "",
  });
  const rows = vehicles.data && !isFail(vehicles.data) && vehicles.data.success ? vehicles.data.vehicles : [];
  const drivers = fleet.data && !isFail(fleet.data) && fleet.data.success ? fleet.data.drivers : [];
  const fuel = useQuery({ queryKey: ["fuel"], queryFn: () => getFuel(), enabled: Boolean(viewId) });
  const jobs = useQuery({ queryKey: ["maintenance"], queryFn: () => getMaintenance(), enabled: Boolean(viewId) });
  const viewed = rows.find((v) => v.id === viewId) ?? null;
  const fills = fuel.data && !isFail(fuel.data) && fuel.data.success ? fuel.data.records.filter((r) => r.vehicleId === viewId) : [];
  const work = jobs.data && !isFail(jobs.data) && jobs.data.success ? jobs.data.records.filter((r) => r.vehicleId === viewId) : [];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await saveVehicle({
      data: {
        id: form.id || undefined,
        brand: form.brand,
        model: form.model,
        year: form.year ? Number(form.year) : null,
        plate: form.plate,
        color: form.color,
        fuelType: form.fuelType,
        status: form.status,
        driverId: form.driverId || null,
        odometerKm: form.odometerKm === "" ? null : Number(form.odometerKm),
        insuranceExpires: form.insuranceExpires || null,
        registrationExpires: form.registrationExpires || null,
        inspectionExpires: form.inspectionExpires || null,
        nextServiceOn: form.nextServiceOn || null,
        notes: form.notes,
      },
    });
    if (isFail(res) || !res.success) setError(isFail(res) ? res.message : "Could not save the vehicle.");
    else {
      toast.success("Vehicle saved.");
      setForm({ ...form, id: "", brand: "", model: "", plate: "", notes: "" });
      void qc.invalidateQueries({ queryKey: ["vehicles"] });
      void qc.invalidateQueries({ queryKey: ["fleet"] });
      void qc.invalidateQueries({ queryKey: ["pulse"] });
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
      <form className="space-y-3 rounded-lg border border-line bg-surface p-4" onSubmit={(e) => void save(e)}>
        <h2 className="text-sm font-medium">{form.id ? "Edit vehicle" : "Add vehicle"}</h2>
        {error ? <Banner>{error}</Banner> : null}
        <Field label="Brand"><input className={fieldClass} value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} required /></Field>
        <Field label="Model"><input className={fieldClass} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} required /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Year"><input className={fieldClass} inputMode="numeric" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} /></Field>
          <Field label="Plate"><input className={fieldClass} value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} required /></Field>
        </div>
        <Field label="Color"><input className={fieldClass} value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} /></Field>
        <Field label="Fuel">
          <select className={fieldClass} value={form.fuelType} onChange={(e) => setForm({ ...form, fuelType: e.target.value })}>
            {FUELS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select className={fieldClass} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}
          </select>
        </Field>
        <Field label="Assigned driver">
          <select className={fieldClass} value={form.driverId} onChange={(e) => setForm({ ...form, driverId: e.target.value })}>
            <option value="">Unassigned</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Odometer km"><input className={fieldClass} inputMode="decimal" value={form.odometerKm} onChange={(e) => setForm({ ...form, odometerKm: e.target.value })} /></Field>
        <Field label="Insurance expires"><input className={fieldClass} type="date" value={form.insuranceExpires} onChange={(e) => setForm({ ...form, insuranceExpires: e.target.value })} /></Field>
        <Field label="Registration expires"><input className={fieldClass} type="date" value={form.registrationExpires} onChange={(e) => setForm({ ...form, registrationExpires: e.target.value })} /></Field>
        <Field label="Inspection expires"><input className={fieldClass} type="date" value={form.inspectionExpires} onChange={(e) => setForm({ ...form, inspectionExpires: e.target.value })} /></Field>
        <Field label="Next service"><input className={fieldClass} type="date" value={form.nextServiceOn} onChange={(e) => setForm({ ...form, nextServiceOn: e.target.value })} /></Field>
        <Field label="Notes"><input className={fieldClass} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        <Btn type="submit" className="w-full">{form.id ? "Save changes" : "Add vehicle"}</Btn>
      </form>
      <div>
        <PageHead title="Vehicles" />
        {vehicles.isPending ? <p className="text-sm text-muted">Loading vehicles…</p> : null}
        {isFail(vehicles.data) ? <Banner>{vehicles.data.message}</Banner> : null}
        <div className="overflow-auto rounded-lg border border-line">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-surface text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Vehicle</th>
                <th className="px-3 py-2 font-medium">Plate</th>
                <th className="px-3 py-2 font-medium">Driver</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Odometer</th>
                <th className="px-3 py-2 font-medium">Documents</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id} className="border-t border-line">
                  <td className="px-3 py-2">{v.code}<div className="text-xs text-muted">{v.brand} {v.model} {v.year ?? ""} · {v.fuelType}</div></td>
                  <td className="px-3 py-2 font-mono text-xs">{v.plate}</td>
                  <td className="px-3 py-2">{v.driverName ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{v.status.replaceAll("_", " ")}</td>
                  <td className="px-3 py-2 font-mono tabular-nums">{kmText(v.odometerKm)}</td>
                  <td className="px-3 py-2 text-xs text-muted">Ins {v.insuranceExpires ?? "—"}<br />Reg {v.registrationExpires ?? "—"}<br />Tech {v.inspectionExpires ?? "—"}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <Btn variant="ghost" className="h-9" onClick={() => setViewId(viewId === v.id ? null : v.id)}>History</Btn>
                      <Btn variant="ghost" className="h-9" onClick={() => setForm({
                      id: v.id, brand: v.brand, model: v.model, year: v.year ? String(v.year) : "", plate: v.plate, color: v.color,
                      fuelType: v.fuelType, status: v.status, driverId: v.driverId ?? "", odometerKm: String(v.odometerKm),
                      insuranceExpires: v.insuranceExpires ?? "", registrationExpires: v.registrationExpires ?? "",
                      inspectionExpires: v.inspectionExpires ?? "", nextServiceOn: v.nextServiceOn ?? "", notes: v.notes,
                    })}>Edit</Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!vehicles.isPending && rows.length === 0 ? <Empty title="No vehicles" body="Add the cars the desk assigns to drivers." /> : null}
        </div>
        {viewed ? (
          <div className="mt-4 rounded-lg border border-line bg-surface p-4">
            <h2 className="text-sm font-medium">{viewed.brand} {viewed.model} · {viewed.plate}</h2>
            <p className="mt-1 text-xs text-muted">
              Insurance {viewed.insuranceExpires ?? "—"} · Registration {viewed.registrationExpires ?? "—"} · Inspection {viewed.inspectionExpires ?? "—"} · Next service {viewed.nextServiceOn ?? "—"}
            </p>
            <ul className="mt-3">
              {fills.map((r) => (
                <li key={r.id} className="border-b border-line py-2 text-sm">
                  Fuel · {r.liters} L · {eur(r.totalCost)}
                  <span className="block text-xs text-muted">{r.filledAt.slice(0, 16).replace("T", " ")} · odo {r.odometerKm ?? "—"}</span>
                </li>
              ))}
              {work.map((r) => (
                <li key={r.id} className="border-b border-line py-2 text-sm">
                  {r.kind} · {r.description} · {eur(r.totalCost)}
                  <span className="block text-xs text-muted">{r.servicedOn} · odo {r.odometerKm ?? "—"}</span>
                </li>
              ))}
              {fills.length === 0 && work.length === 0 ? <li className="text-sm text-muted">No fuel or maintenance recorded for this car yet.</li> : null}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function FuelPage() {
  const qc = useQueryClient();
  const fuel = useQuery({ queryKey: ["fuel"], queryFn: () => getFuel() });
  const vehicles = useQuery({ queryKey: ["vehicles"], queryFn: () => getVehicles() });
  const fleet = useQuery({ queryKey: ["fleet"], queryFn: () => getFleet() });
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ vehicleId: "", driverId: "", liters: "", price: "", station: "", odometer: "", reference: "" });
  const rows = fuel.data && !isFail(fuel.data) && fuel.data.success ? fuel.data.records : [];
  const cars = vehicles.data && !isFail(vehicles.data) && vehicles.data.success ? vehicles.data.vehicles : [];
  const drivers = fleet.data && !isFail(fleet.data) && fleet.data.success ? fleet.data.drivers : [];
  const total = rows.reduce((s, r) => s + r.totalCost, 0);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await saveFuel({
      data: {
        vehicleId: form.vehicleId,
        driverId: form.driverId || null,
        fuelType: cars.find((c) => c.id === form.vehicleId)?.fuelType ?? "PETROL",
        liters: Number(form.liters),
        pricePerLiter: Number(form.price),
        station: form.station,
        odometerKm: form.odometer === "" ? null : Number(form.odometer),
        referenceNo: form.reference,
        fullTank: true,
      },
    });
    if (isFail(res) || !res.success) setError(isFail(res) ? res.message : "Could not save the fill.");
    else {
      toast.success(`Fill recorded. ${money(res.totalCost)}.`);
      if (res.litersPer100 != null) toast.message(`${res.litersPer100} L/100 km over 30 days.`);
      setForm({ ...form, liters: "", price: "", station: "", odometer: "", reference: "" });
      void qc.invalidateQueries({ queryKey: ["fuel"] });
      void qc.invalidateQueries({ queryKey: ["vehicles"] });
      void qc.invalidateQueries({ queryKey: ["pulse"] });
      void qc.invalidateQueries({ queryKey: ["alerts"] });
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
      <form className="space-y-3 rounded-lg border border-line bg-surface p-4" onSubmit={(e) => void save(e)}>
        <h2 className="text-sm font-medium">Record a fill</h2>
        <p className="text-xs text-muted">GPS does not know when a car was refueled. Enter the receipt. Total is liters × price.</p>
        {error ? <Banner>{error}</Banner> : null}
        <Field label="Vehicle">
          <select className={fieldClass} value={form.vehicleId} onChange={(e) => setForm({ ...form, vehicleId: e.target.value })} required>
            <option value="">Select</option>
            {cars.map((c) => <option key={c.id} value={c.id}>{c.plate} · {c.brand} {c.model}</option>)}
          </select>
        </Field>
        <Field label="Driver">
          <select className={fieldClass} value={form.driverId} onChange={(e) => setForm({ ...form, driverId: e.target.value })}>
            <option value="">Unknown</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Liters"><input className={fieldClass} inputMode="decimal" value={form.liters} onChange={(e) => setForm({ ...form, liters: e.target.value })} required /></Field>
        <Field label="Price per liter EUR"><input className={fieldClass} inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required /></Field>
        <Field label="Station"><input className={fieldClass} value={form.station} onChange={(e) => setForm({ ...form, station: e.target.value })} /></Field>
        <Field label="Odometer"><input className={fieldClass} inputMode="decimal" value={form.odometer} onChange={(e) => setForm({ ...form, odometer: e.target.value })} /></Field>
        <Field label="Receipt"><input className={fieldClass} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
        <Btn type="submit" className="w-full">Save fill</Btn>
      </form>
      <div>
        <PageHead title="Fuel">
          <span className="font-mono text-sm tabular-nums text-muted">{rows.length} fills · {money(total)}</span>
        </PageHead>
        {isFail(fuel.data) ? <Banner>{fuel.data.message}</Banner> : null}
        <div className="overflow-auto rounded-lg border border-line">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-surface text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Vehicle</th>
                <th className="px-3 py-2 font-medium">Liters</th>
                <th className="px-3 py-2 font-medium">€/L</th>
                <th className="px-3 py-2 font-medium">Total</th>
                <th className="px-3 py-2 font-medium">Station</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-3 py-2 text-xs">{r.filledAt.slice(0, 16).replace("T", " ")}</td>
                  <td className="px-3 py-2">{r.plate}<div className="text-xs text-muted">{r.vehicle} · {r.driverName ?? "—"}</div></td>
                  <td className="px-3 py-2 font-mono tabular-nums">{r.liters}</td>
                  <td className="px-3 py-2 font-mono tabular-nums">{r.pricePerLiter.toFixed(2)}</td>
                  <td className="px-3 py-2 font-mono tabular-nums">{money(r.totalCost)}</td>
                  <td className="px-3 py-2 text-xs">{r.station || r.referenceNo || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!fuel.isPending && rows.length === 0 ? <Empty title="No fills yet" body="Record a receipt when a car is refueled. Nothing here is guessed from GPS." /> : null}
        </div>
      </div>
    </div>
  );
}

export function MaintenancePage() {
  const qc = useQueryClient();
  const jobs = useQuery({ queryKey: ["maintenance"], queryFn: () => getMaintenance() });
  const vehicles = useQuery({ queryKey: ["vehicles"], queryFn: () => getVehicles() });
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ vehicleId: "", kind: "OIL", description: "", supplier: "", parts: "", labor: "", date: "", next: "", reference: "" });
  const rows = jobs.data && !isFail(jobs.data) && jobs.data.success ? jobs.data.records : [];
  const cars = vehicles.data && !isFail(vehicles.data) && vehicles.data.success ? vehicles.data.vehicles : [];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await saveMaintenance({
      data: {
        vehicleId: form.vehicleId,
        kind: form.kind,
        description: form.description,
        supplier: form.supplier,
        partsCost: Number(form.parts || 0),
        laborCost: Number(form.labor || 0),
        servicedOn: form.date,
        nextServiceOn: form.next || null,
        referenceNo: form.reference,
      },
    });
    if (isFail(res) || !res.success) setError(isFail(res) ? res.message : "Could not save the job.");
    else {
      toast.success(`Job saved. ${money(res.totalCost)}.`);
      setForm({ ...form, description: "", parts: "", labor: "", reference: "" });
      void qc.invalidateQueries({ queryKey: ["maintenance"] });
      void qc.invalidateQueries({ queryKey: ["vehicles"] });
      void qc.invalidateQueries({ queryKey: ["pulse"] });
      void qc.invalidateQueries({ queryKey: ["alerts"] });
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
      <form className="space-y-3 rounded-lg border border-line bg-surface p-4" onSubmit={(e) => void save(e)}>
        <h2 className="text-sm font-medium">Record work</h2>
        {error ? <Banner>{error}</Banner> : null}
        <Field label="Vehicle">
          <select className={fieldClass} value={form.vehicleId} onChange={(e) => setForm({ ...form, vehicleId: e.target.value })} required>
            <option value="">Select</option>
            {cars.map((c) => <option key={c.id} value={c.id}>{c.plate} · {c.brand}</option>)}
          </select>
        </Field>
        <Field label="Type">
          <select className={fieldClass} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </Field>
        <Field label="Date"><input className={fieldClass} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required /></Field>
        <Field label="Description"><input className={fieldClass} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required /></Field>
        <Field label="Shop"><input className={fieldClass} value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Parts €"><input className={fieldClass} inputMode="decimal" value={form.parts} onChange={(e) => setForm({ ...form, parts: e.target.value })} /></Field>
          <Field label="Labor €"><input className={fieldClass} inputMode="decimal" value={form.labor} onChange={(e) => setForm({ ...form, labor: e.target.value })} /></Field>
        </div>
        <Field label="Next service"><input className={fieldClass} type="date" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} /></Field>
        <Field label="Invoice"><input className={fieldClass} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
        <Btn type="submit" className="w-full">Save job</Btn>
      </form>
      <div>
        <PageHead title="Maintenance" />
        {isFail(jobs.data) ? <Banner>{jobs.data.message}</Banner> : null}
        <div className="overflow-auto rounded-lg border border-line">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-surface text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Vehicle</th>
                <th className="px-3 py-2 font-medium">Work</th>
                <th className="px-3 py-2 font-medium">Parts</th>
                <th className="px-3 py-2 font-medium">Labor</th>
                <th className="px-3 py-2 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-3 py-2 text-xs">{r.servicedOn}</td>
                  <td className="px-3 py-2">{r.plate}<div className="text-xs text-muted">{r.vehicle}</div></td>
                  <td className="px-3 py-2">{r.kind}<div className="text-xs text-muted">{r.description}</div></td>
                  <td className="px-3 py-2 font-mono tabular-nums">{money(r.partsCost)}</td>
                  <td className="px-3 py-2 font-mono tabular-nums">{money(r.laborCost)}</td>
                  <td className="px-3 py-2 font-mono tabular-nums">{money(r.totalCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!jobs.isPending && rows.length === 0 ? <Empty title="No service history" body="Oil, tires, brakes, inspections and insurance costs land here." /> : null}
        </div>
      </div>
    </div>
  );
}

export function FleetCostPage() {
  const costs = useQuery({ queryKey: ["fleet-costs"], queryFn: () => getFleetCosts() });
  if (costs.isPending) return <p className="text-sm text-muted">Loading fleet costs…</p>;
  if (!costs.data || isFail(costs.data) || !costs.data.success) return <Banner>{isFail(costs.data) ? costs.data.message : "Could not load costs."}</Banner>;
  const { month, vehicles, dailyKm } = costs.data;
  const max = Math.max(1, ...dailyKm.map((d) => d.km));
  return (
    <div className="space-y-4">
      <PageHead title="Fleet costs" />
      <p className="text-sm text-muted">This month. Operating cost is fuel plus maintenance. Cost per kilometre uses GPS kilometres for the assigned driver. Insurance and registration are reminders, not costs, until you record them as maintenance.</p>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-4">
        <div className="bg-surface px-4 py-4"><p className="text-xs text-muted uppercase">Fuel</p><p className="mt-2 font-mono text-2xl tabular-nums">{money(month.fuel)}</p></div>
        <div className="bg-surface px-4 py-4"><p className="text-xs text-muted uppercase">Maintenance</p><p className="mt-2 font-mono text-2xl tabular-nums">{money(month.maintenance)}</p></div>
        <div className="bg-surface px-4 py-4"><p className="text-xs text-muted uppercase">Kilometres</p><p className="mt-2 font-mono text-2xl tabular-nums">{kmText(month.km)}</p></div>
        <div className="bg-surface px-4 py-4"><p className="text-xs text-muted uppercase">€ / km</p><p className="mt-2 font-mono text-2xl tabular-nums">{month.perKm == null ? "—" : money(month.perKm)}</p></div>
      </div>
      <div className="rounded-lg border border-line bg-surface p-4">
        <h2 className="text-sm font-medium">Daily kilometres, last 14 days</h2>
        <div className="mt-4 flex h-28 items-end gap-1">
          {dailyKm.length === 0 ? <p className="text-sm text-muted">No GPS kilometres in this window.</p> : null}
          {dailyKm.map((d) => (
            <div key={d.date} className="flex flex-1 flex-col items-center justify-end gap-1">
              <div className="w-full rounded-sm bg-accent" style={{ height: `${Math.max(4, (d.km / max) * 88)}px` }} />
              <span className="text-[10px] text-muted">{d.date.slice(8)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="overflow-auto rounded-lg border border-line">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-surface text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Vehicle</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Fuel</th>
              <th className="px-3 py-2 font-medium">L/100</th>
              <th className="px-3 py-2 font-medium">Maintenance</th>
              <th className="px-3 py-2 font-medium">KM</th>
              <th className="px-3 py-2 font-medium">€/km</th>
            </tr>
          </thead>
          <tbody>
            {vehicles.map((v) => (
              <tr key={v.id} className="border-t border-line">
                <td className="px-3 py-2">{v.name}<div className="text-xs text-muted">{v.plate} · odo {kmText(v.odometerKm)}</div></td>
                <td className="px-3 py-2 text-xs">{v.status.replaceAll("_", " ")}</td>
                <td className="px-3 py-2 font-mono tabular-nums">{money(v.fuel)}</td>
                <td className="px-3 py-2 font-mono tabular-nums">{v.lPer100 ?? "—"}</td>
                <td className="px-3 py-2 font-mono tabular-nums">{money(v.maintenance)}</td>
                <td className="px-3 py-2 font-mono tabular-nums">{kmText(v.km)}</td>
                <td className="px-3 py-2 font-mono tabular-nums">{v.perKm == null ? "—" : money(v.perKm)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
