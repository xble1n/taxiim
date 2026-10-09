import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createDispatch, findPlaces, getRoute } from "@/lib/taxi/api";
import type { LatLng, PriceDto, StaffDto } from "@/lib/taxi/logic";
import { quoteEuros } from "@/lib/taxi/logic";
import { eur, isFail, kmText } from "@/lib/taxi/format";
import { Banner, Btn, Field, fieldClass } from "./ui";

type Point = { label: string; lat: number; lng: number };

function usePhoneLayout() {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia("(max-width: 767px)");
      const obs = new MutationObserver(notify);
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-device"] });
      mq.addEventListener("change", notify);
      return () => {
        obs.disconnect();
        mq.removeEventListener("change", notify);
      };
    },
    () => {
      const device = document.documentElement.dataset.device;
      return device === "ios" || device === "android" || window.matchMedia("(max-width: 767px)").matches;
    },
    () => false,
  );
}

export function DispatchForm({
  drivers,
  prices,
  presetDriverId,
  pickup,
  destination,
  busyIds,
  onPicked,
  onRoute,
}: {
  drivers: StaffDto[];
  prices: PriceDto[];
  presetDriverId?: string;
  pickup?: Point | null;
  destination?: Point | null;
  busyIds?: string[];
  onPicked?: (which: "pickup" | "dest", point: Point) => void;
  onRoute?: (route: LatLng[] | null, alts: LatLng[][] | null) => void;
}) {
  const qc = useQueryClient();
  const [driverId, setDriverId] = useState(presetDriverId ?? "");
  const [pickupLabel, setPickupLabel] = useState(pickup?.label ?? "");
  const [destLabel, setDestLabel] = useState(destination?.label ?? "");
  const [pickupPt, setPickupPt] = useState<Point | null>(pickup ?? null);
  const [destPt, setDestPt] = useState<Point | null>(destination ?? null);
  const [notes, setNotes] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [manual, setManual] = useState("");
  const [focus, setFocus] = useState<"pickup" | "dest">("pickup");
  const [step, setStep] = useState(0);
  const phone = usePhoneLayout();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => setDriverId(presetDriverId ?? ""), [presetDriverId]);
  useEffect(() => {
    if (pickup) {
      setPickupPt(pickup);
      setPickupLabel(pickup.label);
    }
  }, [pickup]);
  useEffect(() => {
    if (destination) {
      setDestPt(destination);
      setDestLabel(destination.label);
    }
  }, [destination]);

  const q = focus === "pickup" ? pickupLabel : destLabel;
  const [search, setSearch] = useState("");
  useEffect(() => {
    const id = window.setTimeout(() => setSearch(q.trim()), 400);
    return () => window.clearTimeout(id);
  }, [q]);
  const places = useQuery({
    queryKey: ["places", search],
    queryFn: () => findPlaces({ data: { q: search } }),
    enabled: search.length >= 2,
  });

  const route = useQuery({
    queryKey: ["route", pickupPt?.lat, pickupPt?.lng, destPt?.lat, destPt?.lng],
    queryFn: () => getRoute({ data: { from: { lat: pickupPt!.lat, lng: pickupPt!.lng }, to: { lat: destPt!.lat, lng: destPt!.lng } } }),
    enabled: Boolean(pickupPt && destPt),
  });

  const onRouteRef = useRef(onRoute);
  onRouteRef.current = onRoute;

  useEffect(() => {
    if (!route.data || isFail(route.data) || !route.data.success) {
      onRouteRef.current?.(null, null);
      return;
    }
    const primary = route.data.route.routes[0];
    onRouteRef.current?.(primary?.coordinates ?? null, route.data.route.routes.slice(1).map((r) => r.coordinates));
  }, [route.data]);

  const matched = prices.find((p) => p.enabled && p.name.toLowerCase() === destLabel.trim().toLowerCase());
  const primary = route.data && !isFail(route.data) && route.data.success ? route.data.route.routes[0] : undefined;
  const quoted =
    matched && primary
      ? quoteEuros(matched.basePrice, matched.perKm, matched.perMin, primary.distanceKm, primary.durationMin, matched.minFare)
      : null;

  function choosePlace(place: { label: string; lat: number; lng: number }) {
    const point = { label: place.label, lat: place.lat, lng: place.lng };
    if (focus === "pickup") {
      setPickupPt(point);
      setPickupLabel(place.label);
    } else {
      setDestPt(point);
      setDestLabel(place.label);
    }
    onPicked?.(focus, point);
  }

  function choosePrice(id: string) {
    const price = prices.find((p) => p.id === id);
    if (!price || price.latitude == null || price.longitude == null) return;
    const point = { label: price.name, lat: price.latitude, lng: price.longitude };
    setDestPt(point);
    setDestLabel(price.name);
    setFocus("dest");
    onPicked?.("dest", point);
  }

  async function submit() {
    setError(null);
    setInfo(null);
    if (driverId) {
      const chosen = drivers.find((d) => d.id === driverId);
      if (busyIds?.includes(driverId)) return setError("Could not dispatch this driver. They already have an open order.");
      if (chosen && (chosen.vehicleStatus === "MAINTENANCE" || chosen.vehicleStatus === "OUT_OF_SERVICE")) {
        return setError(`Unable to dispatch order. ${chosen.vehicle || "The vehicle"} is ${chosen.vehicleStatus.replaceAll("_", " ").toLowerCase()}.`);
      }
    }
    if (!pickupPt || !destPt) return setError("Set a pickup and a destination before dispatching.");
    const manualPrice = manual.trim() === "" ? null : Number(manual.replace(",", "."));
    if (manualPrice != null && !Number.isFinite(manualPrice)) {
      return setError("Price must be a number in euros, or leave it blank to use the desk price.");
    }
    setBusy(true);
    const res = await createDispatch({
      data: {
        driverId: driverId || undefined,
        broadcast: !driverId,
        pickupLabel,
        pickupLat: pickupPt.lat,
        pickupLng: pickupPt.lng,
        destLabel,
        destLat: destPt.lat,
        destLng: destPt.lng,
        notes: [notes, customerName || customerPhone ? `Customer: ${[customerName, customerPhone].filter(Boolean).join(" · ")}` : ""].filter(Boolean).join("\n"),
        price: manualPrice,
      },
    });
    setBusy(false);
    if (isFail(res) || !res.success) {
      setError(isFail(res) ? res.message : "Dispatch failed.");
      return;
    }
    toast.success(res.message);
    setInfo(res.message);
    setNotes("");
    setManual("");
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
    void qc.invalidateQueries({ queryKey: ["orders"] });
    void qc.invalidateQueries({ queryKey: ["pulse"] });
    void qc.invalidateQueries({ queryKey: ["alerts"] });
    void qc.invalidateQueries({ queryKey: ["activity"] });
  }

  const suggestions = places.data && !isFail(places.data) && places.data.success ? places.data.places : [];
  const placeError = places.isError ? "Place search is unavailable. Use a saved destination or click the map." : null;
  const activeDrivers = drivers.filter((d) => !d.deleted && d.status === "ACTIVE");
  const busyIdsSet = new Set(busyIds ?? []);
  const selected = activeDrivers.find((d) => d.id === driverId);

  const stepNames = ["Driver", "Pickup", "Destination", "Price", "Review"];
  const show = (index: number) => !phone || step === index;

  return (
    <div className="flex min-h-full flex-col gap-3">
      <div className="sticky top-0 z-10 -mx-3 bg-surface px-3 pb-3">
        <Btn className="w-full" disabled={busy} onClick={() => void submit()}>
          {busy ? "Dispatching…" : "Dispatch order"}
        </Btn>
        {error ? <div className="mt-2"><Banner>{error}</Banner></div> : null}
      </div>
      {phone ? <p className="text-xs text-muted">Step {step + 1} of 5 · {stepNames[step]}</p> : null}
      {placeError ? <Banner tone="info">{placeError}</Banner> : null}
      {info ? <Banner tone="ok">{info}</Banner> : null}
      {show(0) ? (
      <>
      <Field label="Driver">
        <select className={fieldClass} value={driverId} onChange={(e) => setDriverId(e.target.value)}>
          <option value="">All online drivers</option>
          {activeDrivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.driverCode ?? "—"} · {d.name} · {busyIdsSet.has(d.id) ? "busy" : d.presence === "OFFLINE" ? "offline" : d.presence === "ON_RIDE" ? "on ride" : "available"} · {d.vehicle || "no vehicle"}
            </option>
          ))}
        </select>
      </Field>
      {selected ? (
        <p className="text-xs text-muted">
          Vehicle {selected.vehicle || "not assigned"}{selected.plate ? ` · ${selected.plate}` : ""}
          {selected.presence === "OFFLINE" ? " This driver is offline and will see the job when they open the app." : ""}
          {selected.vehicleStatus === "MAINTENANCE" || selected.vehicleStatus === "OUT_OF_SERVICE" ? ` Vehicle is ${selected.vehicleStatus.replaceAll("_", " ").toLowerCase()}.` : ""}
        </p>
      ) : (
        <p className="text-xs text-muted">This order is offered to every online driver who is free. The first to confirm gets it.</p>
      )}
      </>
      ) : null}
      {show(1) || show(2) ? (
      <>
      {show(2) ? (
      <Field label="Saved destination">
        <select className={fieldClass} value="" onChange={(e) => choosePrice(e.target.value)}>
          <option value="">Use a price-book destination</option>
          {prices.filter((p) => p.enabled && p.latitude != null).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {eur(p.perKm === 0 && p.perMin === 0 ? p.basePrice : quoteEuros(p.basePrice, p.perKm, p.perMin, 0, 0, p.minFare))}{p.perKm === 0 && p.perMin === 0 ? " fixed" : ""}
            </option>
          ))}
        </select>
      </Field>
      ) : null}
      {show(1) ? (
      <Field label="Pickup">
        <input
          className={fieldClass}
          value={pickupLabel}
          placeholder="Search or click the map"
          onFocus={() => setFocus("pickup")}
          onChange={(e) => {
            setPickupLabel(e.target.value);
            setPickupPt(null);
            setFocus("pickup");
          }}
        />
      </Field>
      ) : null}
      {show(2) ? (
      <Field label="Destination">
        <input
          className={fieldClass}
          value={destLabel}
          placeholder="Search or click the map"
          onFocus={() => setFocus("dest")}
          onChange={(e) => {
            setDestLabel(e.target.value);
            setDestPt(null);
            setFocus("dest");
          }}
        />
      </Field>
      ) : null}
      {suggestions.length ? (
        <ul className="border border-line bg-bg">
          {suggestions.map((p) => (
            <li key={`${p.lat}-${p.lng}-${p.label}`}>
              <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => choosePlace(p)}>
                {p.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-muted">
        Map clicks set the {focus === "pickup" ? "pickup" : "destination"}. Street search uses OpenStreetMap (Photon, Nominatim fallback) for Vushtrri, Mitrovica, and Prishtina. Results are cached.
      </p>
      </>
      ) : null}
      {show(3) ? (
      <>
      <Field label="Customer name">
        <input className={fieldClass} value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
      </Field>
      <Field label="Customer phone">
        <input className={fieldClass} inputMode="tel" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
      </Field>
      <Field label="Notes">
        <input className={fieldClass} value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <Field label="Price (EUR)">
        <input
          className={fieldClass}
          inputMode="decimal"
          value={manual}
          placeholder={quoted != null ? `Desk price ${eur(quoted)}` : "Leave blank to use the desk price"}
          onChange={(e) => setManual(e.target.value)}
        />
      </Field>
      </>
      ) : null}
      {show(4) ? (
      <>
      {primary ? (
        <p className="font-mono text-xs text-muted tabular-nums">
          {kmText(primary.distanceKm)} km · {Math.round(primary.durationMin)} min ETA
          {route.data && !isFail(route.data) && route.data.success
            ? ` · ${route.data.route.provider === "mapbox" ? "Mapbox traffic" : route.data.route.provider === "osrm" ? "OSRM (no live traffic)" : "straight-line fallback"}`
            : ""}
          {route.data && !isFail(route.data) && route.data.success && route.data.route.routes.length > 1
            ? ` · ${route.data.route.routes.length - 1} alternative${route.data.route.routes.length > 2 ? "s" : ""}`
            : ""}
        </p>
      ) : <p className="text-xs text-muted">Set pickup and destination to see distance and ETA.</p>}
      <p className="text-sm">{selected ? `${selected.name} · ${selected.vehicle || "no vehicle"}` : "All online drivers"}</p>
      <p className="text-sm text-muted">{pickupLabel || "No pickup"} → {destLabel || "No destination"}</p>
      <p className="font-mono text-sm">{manual.trim() ? `${manual} €` : quoted != null ? eur(quoted) : "Desk price"}</p>
      </>
      ) : null}
      {phone ? (
        <div className="flex gap-2">
          {step > 0 ? <Btn variant="ghost" className="flex-1" onClick={() => setStep((value) => value - 1)}>Back</Btn> : null}
          {step < 4 ? <Btn className="flex-1" onClick={() => setStep((value) => value + 1)}>Next</Btn> : null}
        </div>
      ) : null}
    </div>
  );
}
