import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Home, Map as MapIcon, MessageSquare, Receipt, Route, UserRound } from "lucide-react";
import {
  acknowledgeAlert,
  createDirectRide,
  findPlaces,
  getDriverBoard,
  getPrices,
  getRoute,
  getSession,
  logOutEvent,
  orderAction,
  sendLocation,
  setOnline,
} from "@/lib/taxi/api";
import { signOut } from "@/lib/auth/client";
import type { OrderDto } from "@/lib/taxi/logic";
import { gpsQuality, STATUS_LABEL, type GpsQuality } from "@/lib/taxi/logic";
import { errText, eur, isFail, kmText, speedText, when } from "@/lib/taxi/format";
import { ChatBox } from "./chat-box";
import { FleetMap } from "./map";
import { playRing, unlockAudio } from "./sound";
import { Banner, BootScreen, Btn, Empty, Field, Logo, OrderPill, PresencePill, fieldClass } from "./ui";

export const DRIVE_SECTIONS = ["home", "orders", "map", "chat", "prices", "profile"] as const;
export type DriveSection = (typeof DRIVE_SECTIONS)[number];

const NAV: Array<{ id: DriveSection; label: string; icon: typeof Home }> = [
  { id: "home", label: "Home", icon: Home },
  { id: "orders", label: "Orders", icon: Route },
  { id: "map", label: "Map", icon: MapIcon },
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "prices", label: "Prices", icon: Receipt },
  { id: "profile", label: "Profile", icon: UserRound },
];

function primeGps() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    () => {},
    () => {},
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
  );
}

function useGps(enabled: boolean) {
  const [error, setError] = useState<string | null>(null);
  const [accuracyM, setAccuracyM] = useState<number | null>(null);
  const [hasFix, setHasFix] = useState(false);
  const qc = useQueryClient();
  const last = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setHasFix(false);
      setAccuracyM(null);
      setError(null);
      return;
    }
    if (!navigator.geolocation) {
      setError("This browser cannot read GPS.");
      return;
    }
    const send = (pos: GeolocationPosition) => {
      const now = Date.now();
      const moving = pos.coords.speed != null && pos.coords.speed > 1;
      if (now - last.current < (moving ? 2000 : 5000)) return;
      last.current = now;
      const accuracy = Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null;
      setAccuracyM(accuracy);
      setHasFix(true);
      void sendLocation({
        data: {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: accuracy,
          speedMps: pos.coords.speed,
          heading: Number.isFinite(pos.coords.heading ?? NaN) ? pos.coords.heading : null,
          altitudeM: Number.isFinite(pos.coords.altitude ?? NaN) ? pos.coords.altitude : null,
          at: pos.timestamp || now,
        },
      }).then((res) => {
        if (isFail(res)) setError(res.message);
        else {
          setError(null);
          void qc.invalidateQueries({ queryKey: ["board"] });
        }
      });
    };
    const onError = (err: GeolocationPositionError) => {
      setHasFix(false);
      if (err.code === err.PERMISSION_DENIED) setError("LOCATION PERMISSION REQUIRED");
      else if (err.code === err.POSITION_UNAVAILABLE) setError("GPS is unavailable on this device right now.");
      else setError("GPS timed out. The watch will keep trying while you stay online.");
    };
    const options: PositionOptions = { enableHighAccuracy: true, maximumAge: 4000, timeout: 20000 };
    const id = navigator.geolocation.watchPosition(send, onError, options);
    const onVisible = () => {
      if (document.visibilityState === "visible") navigator.geolocation.getCurrentPosition(send, onError, options);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      navigator.geolocation.clearWatch(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, qc]);

  return { error, accuracyM, hasFix };
}

function GpsLight({ state }: { state: GpsQuality }) {
  if (state === "off") return null;
  const label = state === "active" ? "GPS Active" : state === "weak" ? "GPS Weak" : "GPS Unavailable";
  const dot = state === "active" ? "bg-ok" : state === "weak" ? "bg-warn" : "bg-danger";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span className={`size-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

export function DriverApp({ section, asId }: { section: DriveSection; asId?: string }) {
  const navigate = useNavigate();
  const session = useQuery({ queryKey: ["session"], queryFn: () => getSession() });
  const board = useQuery({
    queryKey: ["board", asId ?? "self"],
    queryFn: () => getDriverBoard({ data: { asId } }),
    refetchInterval: 3000,
  });

  const who = session.data;
  const boardOk = board.data && !isFail(board.data) && board.data.success ? board.data : null;
  const gps = useGps(Boolean(boardOk && !boardOk.viewing && boardOk.driver.presence !== "OFFLINE"));
  const blocked = !session.isPending && (!who || isFail(who) || !who.success || who.access !== "ok");

  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock);
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  useEffect(() => {
    if (session.isError && /unauthorized/i.test(errText(session.error))) {
      void navigate({ to: "/login" });
    }
  }, [session.isError, session.error, navigate]);

  useEffect(() => {
    if (!who || isFail(who) || !who.success || who.access !== "ok") return;
    if (who.staff.role === "ADMIN" && !asId) {
      void navigate({ to: "/console", search: { s: "dashboard" } });
    }
  }, [who, asId, navigate]);

  if (session.isPending || board.isPending) return <BootScreen />;
  if (session.isError && /unauthorized/i.test(errText(session.error))) return <BootScreen />;
  if (blocked || !who || isFail(who) || !who.success || who.access !== "ok") {
    const message = who && "message" in who ? who.message : errText(session.error);
    return (
      <div className="grid min-h-dvh place-items-center px-6">
        <Banner>{message}</Banner>
      </div>
    );
  }
  if (who.staff.role === "ADMIN" && !asId) return <BootScreen />;
  if (!board.data || isFail(board.data) || !board.data.success) {
    return (
      <div className="grid min-h-dvh place-items-center px-6">
        <Banner>{isFail(board.data) ? board.data.message : "Driver console failed to load."}</Banner>
      </div>
    );
  }
  const { driver, orders, alerts, viewing } = board.data;
  const meId = who.staff.id;
  const incoming = orders.find((order) => order.status === "DISPATCHED");

  return (
    <div className="h-app flex flex-col overflow-hidden bg-bg pt-[env(safe-area-inset-top)] text-fg">
      {viewing ? (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-warn/40 bg-warn/10 px-4 py-2 text-sm">
          <span>Viewing as {driver.name}. Controls that change presence stay on their phone.</span>
          <Link to="/console" search={{ s: "drivers" }} className="shrink-0 font-medium text-accent">Back</Link>
        </div>
      ) : null}
      {incoming && !viewing ? <IncomingOffer order={incoming} /> : null}
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 overflow-hidden border-b border-line px-3">
        <Logo className="logo-sm h-6 w-auto shrink-0" />
        <div className="flex min-w-0 items-center gap-2">
          <PresencePill presence={driver.presence} />
          <GpsLight state={gpsQuality({ online: driver.presence !== "OFFLINE", error: gps.error, accuracyM: driver.accuracyM ?? gps.accuracyM, stale: driver.gpsStale, hasFix: driver.latitude != null || gps.hasFix })} />
          <button
            type="button"
            className="h-11 shrink-0 rounded-md border border-line px-3 text-sm"
            onClick={() => {
              void logOutEvent().finally(() => signOut("/login").catch(() => toast.error("Could not log out. Try again.")));
            }}
          >
            Log out
          </button>
        </div>
      </header>
      <main className={`min-h-0 flex-1 ${section === "map" || section === "chat" ? "overflow-hidden" : "overflow-auto"}`}>
        {section === "home" ? <HomeView driverId={driver.id} viewing={viewing} orders={orders} alerts={alerts} presence={driver.presence} speed={driver.speedKmh} km={driver.todayKm} accuracyM={driver.accuracyM ?? gps.accuracyM} gpsError={gps.error} stale={driver.gpsStale} hasFix={driver.latitude != null || gps.hasFix} /> : null}
        {section === "orders" ? <OrdersView orders={orders} viewing={viewing} /> : null}
        {section === "map" ? <MapView driver={driver} orders={orders} viewing={viewing} /> : null}
        {section === "chat" ? (
          <div className="h-full min-h-0">
            <ChatBox meId={meId} />
          </div>
        ) : null}
        {section === "prices" ? <PricesView /> : null}
        {section === "profile" ? <ProfileView driver={driver} /> : null}
      </main>
      <nav className="grid shrink-0 grid-cols-6 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = item.id === section;
          return (
            <Link
              key={item.id}
              to="/drive"
              search={{ s: item.id, as: asId }}
              className={`flex h-14 min-w-0 flex-col items-center justify-center gap-1 border-t-2 px-0.5 text-[11px] leading-none ${active ? "border-accent text-fg" : "border-transparent text-muted"}`}
            >
              <Icon className="size-5 shrink-0" />
              <span className="max-w-full truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function HomeView({
  viewing,
  orders,
  alerts,
  presence,
  speed,
  km,
  accuracyM,
  gpsError,
  stale,
  hasFix,
}: {
  driverId: string;
  viewing: boolean;
  orders: OrderDto[];
  alerts: { id: string; type: string; title: string; body: string; acknowledged: boolean }[];
  presence: "OFFLINE" | "ONLINE" | "ON_RIDE";
  speed: number | null;
  km: number;
  accuracyM: number | null;
  gpsError: string | null;
  stale: boolean;
  hasFix: boolean;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [soundNote, setSoundNote] = useState<string | null>(null);
  const played = useRef(new Set<string>());
  const online = presence !== "OFFLINE";
  const quality = gpsQuality({ online, error: gpsError, accuracyM, stale, hasFix });
  const ring = alerts.find((a) => a.type === "RING" && !a.acknowledged);
  const incoming = orders.find((o) => o.status === "DISPATCHED");
  const active = orders.find((o) => o.status === "ACCEPTED" || o.status === "ON_THE_WAY" || o.status === "ARRIVED" || o.status === "IN_PROGRESS");

  useEffect(() => {
    if (!ring || played.current.has(ring.id)) return;
    played.current.add(ring.id);
    void playRing().then((ok) => {
      if (!ok) setSoundNote("Sound is blocked until you tap the page. The call is still on screen.");
    });
  }, [ring]);

  async function toggle() {
    if (!online) primeGps();
    setBusy(true);
    const res = await setOnline({ data: { online: !online } });
    setBusy(false);
    if (isFail(res) || !res.success) toast.error(isFail(res) ? res.message : "Could not change status.");
    else toast.success(online ? "You are offline." : "You are online.");
    void qc.invalidateQueries({ queryKey: ["board"] });
  }

  async function ack(id: string) {
    const res = await acknowledgeAlert({ data: { alertId: id } });
    if (isFail(res) || !res.success) toast.error(isFail(res) ? res.message : "Could not acknowledge.");
    void qc.invalidateQueries({ queryKey: ["board"] });
    void qc.invalidateQueries({ queryKey: ["alerts"] });
  }

  return (
    <div className="space-y-3 p-3">
      {ring ? (
        <div className="taxi-pulse rounded-lg border border-accent bg-accent/10 p-4">
          <p className="text-xs tracking-widest text-accent">CONTROL CENTER</p>
          <h2 className="mt-1 text-lg font-medium">{ring.title}</h2>
          <p className="mt-1 text-sm text-muted">{ring.body}</p>
          {soundNote ? <p className="mt-2 text-xs text-warn">{soundNote}</p> : null}
          <Btn className="mt-3 w-full" onClick={() => void ack(ring.id)}>Acknowledge</Btn>
        </div>
      ) : null}
      <section className="rounded-lg border border-line bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-muted">Status</p>
            <div className="mt-1"><PresencePill presence={presence} /></div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={online}
            disabled={viewing || busy}
            onClick={() => void toggle()}
            className={`relative h-12 w-24 rounded-full border border-line ${online ? "bg-accent" : "bg-surface-2"} disabled:opacity-50`}
          >
            <span className={`absolute top-1 size-10 rounded-full transition-all ${online ? "left-12 bg-on-accent" : "left-1 bg-fg"}`} />
          </button>
        </div>
        {viewing ? <p className="mt-3 text-xs text-muted">Preview only. The driver switches themselves online on their phone.</p> : null}
        <p className="mt-3 text-xs text-muted">
          While you are online, this phone sends its real GPS about every 2 seconds when you are moving, and less often when you are stopped, as long as Taxi IM stays open.
          A locked phone or a closed browser cannot keep tracking. That needs the Android or iPhone app.
        </p>
        <div className="mt-2"><GpsLight state={quality} /></div>
        {gpsError ? <p className="mt-2 text-sm text-warn">{gpsError}</p> : null}
        {accuracyM != null && online ? <p className="mt-1 font-mono text-xs text-muted">Accuracy {Math.round(accuracyM)} m</p> : null}
      </section>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-line bg-surface p-4">
          <p className="text-xs text-muted">Speed</p>
          <p className="font-mono text-3xl tabular-nums">{speedText(speed)}<span className="ml-1 text-sm text-muted">km/h</span></p>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <p className="text-xs text-muted">Today</p>
          <p className="font-mono text-3xl tabular-nums">{kmText(km)}<span className="ml-1 text-sm text-muted">km</span></p>
        </div>
      </div>
      {incoming ? <OrderCard order={incoming} viewing={viewing} /> : null}
      {active ? <OrderCard order={active} viewing={viewing} /> : null}
      {!incoming && !active ? <Empty title="No current ride" body="New dispatches from the control center appear here." /> : null}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Alerts</h2>
        {alerts.filter((a) => a.type !== "RING" || a.acknowledged).slice(0, 5).map((a) => (
          <div key={a.id} className="border border-line px-3 py-2 text-sm">
            <p>{a.title}</p>
            <p className="text-xs text-muted">{a.body}</p>
          </div>
        ))}
        {alerts.length === 0 ? <p className="text-sm text-muted">No alerts.</p> : null}
      </section>
    </div>
  );
}

function IncomingOffer({ order }: { order: OrderDto }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const played = useRef(false);
  useEffect(() => {
    if (played.current) return;
    played.current = true;
    void playRing();
  }, [order.id]);
  async function act(action: "accept" | "decline") {
    setBusy(true);
    const res = await orderAction({ data: { orderId: order.id, action } });
    setBusy(false);
    if (isFail(res) || !res.success) toast.error(isFail(res) ? res.message : "Could not update the order.");
    else toast.success(action === "accept" ? `${order.code} is yours.` : `${order.code} declined.`);
    void qc.invalidateQueries({ queryKey: ["board"] });
  }
  return (
    <div className="fixed inset-0 z-[800] flex items-end bg-black/70 p-3 sm:items-center sm:justify-center">
      <div className="w-full max-w-sm rounded-lg border border-accent bg-surface p-4">
        <p className="text-xs tracking-widest text-accent">NEW TAXI ORDER</p>
        <h2 className="mt-1 text-lg font-medium">{order.code}</h2>
        <p className="mt-3 text-sm">Pickup</p>
        <p className="font-medium">{order.pickupLabel}</p>
        <p className="mt-2 text-sm">Destination</p>
        <p className="font-medium">{order.destLabel}</p>
        <p className="mt-3 font-mono text-sm tabular-nums">
          {eur(order.priceEur)} · {order.distanceKm ?? "—"} km · {order.durationMin ? `${Math.round(order.durationMin)} min` : "—"}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Btn className="w-full" disabled={busy} onClick={() => void act("accept")}>Confirm</Btn>
          <Btn variant="danger" className="w-full" disabled={busy} onClick={() => void act("decline")}>Decline</Btn>
        </div>
      </div>
    </div>
  );
}

function OrderCard({ order, viewing }: { order: OrderDto; viewing: boolean }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function act(action: "accept" | "decline" | "enroute" | "arrived" | "start" | "complete") {
    setBusy(true);
    const res = await orderAction({ data: { orderId: order.id, action } });
    setBusy(false);
    if (isFail(res) || !res.success) toast.error(isFail(res) ? res.message : "Could not update the order.");
    else toast.success(`${order.code} updated.`);
    void qc.invalidateQueries({ queryKey: ["board"] });
  }
  const target = order.status === "IN_PROGRESS" || order.status === "ARRIVED"
    ? { lat: order.destLat, lng: order.destLng, label: order.destLabel }
    : { lat: order.pickupLat, lng: order.pickupLng, label: order.pickupLabel };
  const nav = `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}&travelmode=driving`;
  return (
    <article className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-xs">{order.code}</p>
        <OrderPill status={order.status} />
      </div>
      <p className="mt-2 text-sm">Pickup</p>
      <p className="font-medium">{order.pickupLabel}</p>
      <p className="mt-2 text-sm">Destination</p>
      <p className="font-medium">{order.destLabel}</p>
      <p className="mt-2 font-mono text-sm tabular-nums">
        {eur(order.priceEur)} · {order.distanceKm ?? "—"} km · {order.durationMin ? `${Math.round(order.durationMin)} min` : "—"}
      </p>
      <p className="mt-2 text-xs text-muted">{STATUS_LABEL[order.status]}{order.source === "DIRECT" ? " · Direct ride" : ""}</p>
      {order.status === "ON_THE_WAY" ? (
        <div className="mt-3 rounded-md border border-accent bg-accent/10 p-3">
          <p className="text-sm font-medium">Have you arrived?</p>
          <Btn className="mt-2 w-full" disabled={viewing || busy} onClick={() => void act("arrived")}>Arrived</Btn>
        </div>
      ) : null}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {order.status === "DISPATCHED" ? (
          <>
            <Btn disabled={viewing || busy} onClick={() => void act("accept")}>Confirm</Btn>
            <Btn variant="danger" disabled={viewing || busy} onClick={() => void act("decline")}>Decline</Btn>
          </>
        ) : null}
        {order.status === "ACCEPTED" ? <Btn disabled={viewing || busy} onClick={() => void act("enroute")}>On the way</Btn> : null}
        {order.status === "ARRIVED" ? <Btn disabled={viewing || busy} onClick={() => void act("start")}>Start ride</Btn> : null}
        {order.status === "IN_PROGRESS" ? <Btn disabled={viewing || busy} onClick={() => void act("complete")}>Complete ride</Btn> : null}
        <a className="inline-flex h-11 items-center justify-center rounded-md border border-line text-sm" href={nav} target="_blank" rel="noreferrer">Navigate</a>
      </div>
    </article>
  );
}

function OrdersView({ orders, viewing }: { orders: OrderDto[]; viewing: boolean }) {
  const open = orders.filter((o) => ["DISPATCHED", "ACCEPTED", "ON_THE_WAY", "ARRIVED", "IN_PROGRESS"].includes(o.status));
  const past = orders.filter((o) => !open.includes(o));
  return (
    <div className="space-y-3 p-3 pb-4">
      <h1 className="text-xl font-medium tracking-tight">Orders</h1>
      {viewing ? null : <DirectRide blocked={open.some((o) => o.status !== "DISPATCHED")} />}
      {open.length === 0 ? <Empty title="Nothing assigned" body="You will see a dispatch as soon as the desk sends one." /> : open.map((o) => <OrderCard key={o.id} order={o} viewing={viewing} />)}
      {past.length ? <h2 className="pt-2 text-sm text-muted">Recent</h2> : null}
      {past.map((o) => (
        <div key={o.id} className="border border-line px-3 py-2 text-sm">
          <div className="flex items-center justify-between"><span className="font-mono text-xs">{o.code}</span><OrderPill status={o.status} /></div>
          <p className="mt-1">{o.pickupLabel} → {o.destLabel}</p>
          <p className="text-xs text-muted">{when(o.createdAt)}</p>
        </div>
      ))}
    </div>
  );
}

function DirectRide({ blocked }: { blocked: boolean }) {
  const qc = useQueryClient();
  const prices = useQuery({ queryKey: ["prices"], queryFn: () => getPrices() });
  const [open, setOpen] = useState(false);
  const [pickup, setPickup] = useState("");
  const [dest, setDest] = useState("");
  const [pickupPt, setPickupPt] = useState<{ lat: number; lng: number } | null>(null);
  const [destPt, setDestPt] = useState<{ lat: number; lng: number } | null>(null);
  const [focus, setFocus] = useState<"pickup" | "dest">("dest");
  const [customer, setCustomer] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const q = focus === "pickup" ? pickup : dest;
  const [search, setSearch] = useState("");
  useEffect(() => {
    const id = window.setTimeout(() => setSearch(q.trim()), 400);
    return () => window.clearTimeout(id);
  }, [q]);
  const places = useQuery({
    queryKey: ["places", search],
    queryFn: () => findPlaces({ data: { q: search } }),
    enabled: open && search.length >= 2,
  });
  const rows = prices.data && !isFail(prices.data) && prices.data.success ? prices.data.prices : [];
  const matched = rows.find((p) => p.enabled && p.name.toLowerCase() === dest.trim().toLowerCase());
  const fixed = matched && matched.perKm === 0 && matched.perMin === 0 ? matched.basePrice : null;
  const suggestions = places.data && !isFail(places.data) && places.data.success ? places.data.places : [];

  async function submit() {
    setError(null);
    if (!pickupPt || !destPt) {
      setError("Choose a pickup and a destination from the suggestions or the price book.");
      return;
    }
    setBusy(true);
    const res = await createDirectRide({
      data: {
        pickupLabel: pickup,
        pickupLat: pickupPt.lat,
        pickupLng: pickupPt.lng,
        destLabel: dest,
        destLat: destPt.lat,
        destLng: destPt.lng,
        customerName: customer,
        customerPhone: phone,
        notes,
      },
    });
    setBusy(false);
    if (isFail(res) || !res.success) {
      setError(isFail(res) ? res.message : "Could not start the ride.");
      return;
    }
    toast.success(res.message);
    setOpen(false);
    void qc.invalidateQueries({ queryKey: ["board"] });
  }

  if (!open) {
    return (
      <Btn className="w-full" variant="ghost" disabled={blocked} onClick={() => setOpen(true)}>
        {blocked ? "Finish the open ride first" : "New direct ride"}
      </Btn>
    );
  }
  return (
    <section className="space-y-2 rounded-lg border border-line bg-surface p-3">
      <p className="text-sm font-medium">Direct ride</p>
      <p className="text-xs text-muted">The desk price is used. You cannot change it.</p>
      <Field label="Saved destination">
        <select
          className={fieldClass}
          value=""
          onChange={(e) => {
            const price = rows.find((p) => p.id === e.target.value);
            if (!price || price.latitude == null || price.longitude == null) return;
            setDest(price.name);
            setDestPt({ lat: price.latitude, lng: price.longitude });
            setFocus("dest");
          }}
        >
          <option value="">Use a price-book destination</option>
          {rows.filter((p) => p.enabled && p.latitude != null).map((p) => (
            <option key={p.id} value={p.id}>{p.name}{p.perKm === 0 && p.perMin === 0 ? ` · ${eur(p.basePrice)}` : ""}</option>
          ))}
        </select>
      </Field>
      <Field label="Pickup">
        <input className={fieldClass} value={pickup} onFocus={() => setFocus("pickup")} onChange={(e) => { setPickup(e.target.value); setPickupPt(null); setFocus("pickup"); }} />
      </Field>
      <Field label="Destination">
        <input className={fieldClass} value={dest} onFocus={() => setFocus("dest")} onChange={(e) => { setDest(e.target.value); setDestPt(null); setFocus("dest"); }} />
      </Field>
      {suggestions.length ? (
        <ul className="border border-line">
          {suggestions.map((p) => (
            <li key={`${p.lat}-${p.lng}`}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm"
                onClick={() => {
                  if (focus === "pickup") {
                    setPickup(p.label);
                    setPickupPt(p);
                  } else {
                    setDest(p.label);
                    setDestPt(p);
                  }
                }}
              >
                {p.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Field label="Customer name"><input className={fieldClass} value={customer} onChange={(e) => setCustomer(e.target.value)} /></Field>
      <Field label="Customer phone"><input className={fieldClass} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
      <Field label="Notes"><input className={fieldClass} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <p className="font-mono text-sm">{fixed != null ? `Desk price ${eur(fixed)}` : "Desk meter if this destination has no fixed price"}</p>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="grid grid-cols-2 gap-2">
        <Btn variant="ghost" onClick={() => setOpen(false)}>Cancel</Btn>
        <Btn disabled={busy} onClick={() => void submit()}>{busy ? "Saving…" : "Start ride"}</Btn>
      </div>
    </section>
  );
}

function MapView({
  driver,
  orders,
  viewing,
}: {
  driver: { id: string; name: string; presence: "OFFLINE" | "ONLINE" | "ON_RIDE"; latitude: number | null; longitude: number | null; speedKmh: number | null };
  orders: OrderDto[];
  viewing: boolean;
}) {
  const active = orders.find((o) => ["DISPATCHED", "ACCEPTED", "ON_THE_WAY", "ARRIVED", "IN_PROGRESS"].includes(o.status));
  const route = useQuery({
    queryKey: ["driver-route", active?.id, active?.pickupLat, active?.destLat],
    queryFn: () =>
      getRoute({
        data: {
          from: { lat: active!.pickupLat, lng: active!.pickupLng },
          to: { lat: active!.destLat, lng: active!.destLng },
        },
      }),
    enabled: Boolean(active),
  });
  const primary = route.data && !isFail(route.data) && route.data.success ? route.data.route.routes[0] : undefined;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-80 flex-1">
        <FleetMap
          drivers={[driver]}
          route={primary?.coordinates ?? active?.route}
          alternatives={active?.alternatives}
          pickup={active ? { lat: active.pickupLat, lng: active.pickupLng } : null}
          destination={active ? { lat: active.destLat, lng: active.destLng } : null}
          selectedId={driver.id}
        />
      </div>
      {primary ? (
        <div className="max-h-36 shrink-0 overflow-auto border-t border-line bg-surface px-3 py-2 text-xs text-muted">
          <p className="font-mono text-fg">{kmText(primary.distanceKm)} km · {Math.round(primary.durationMin)} min</p>
          <ol className="mt-1 space-y-1">
            {(primary.steps ?? []).map((step, index) => (
              <li key={`${step.text}-${index}`}>{index + 1}. {step.text}</li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

function PricesView() {
  const prices = useQuery({ queryKey: ["prices"], queryFn: () => getPrices() });
  const [q, setQ] = useState("");
  const rows = prices.data && !isFail(prices.data) && prices.data.success ? prices.data.prices : [];
  const shown = rows.filter((p) => p.enabled && p.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="space-y-3 p-3">
      <h1 className="text-xl font-medium tracking-tight">Destination prices</h1>
      <p className="text-sm text-muted">View only. The control center sets these.</p>
      <input className={fieldClass} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      {shown.map((p) => (
        <div key={p.id} className="rounded-lg border border-line px-4 py-3">
          <div className="flex items-center justify-between">
            <p className="font-medium">{p.name}</p>
            <p className="font-mono tabular-nums">{eur(p.basePrice)}</p>
          </div>
          <p className="mt-1 text-xs text-muted">
            {p.perKm === 0 && p.perMin === 0
              ? "Fixed price set by the desk."
              : `${eur(p.perKm)} / km · ${eur(p.perMin)} / min · min ${eur(p.minFare)}`}
          </p>
        </div>
      ))}
      {shown.length === 0 ? <Empty title="No prices" body="Nothing matches that search." /> : null}
    </div>
  );
}

function ProfileView({
  driver,
}: {
  driver: {
    name: string;
    email: string;
    phone: string;
    driverCode: string | null;
    vehicle: string;
    plate: string;
    status: string;
    presence: "OFFLINE" | "ONLINE" | "ON_RIDE";
    vehicleFuel?: string | null;
    vehicleOdometer?: number | null;
    vehicleStatus?: string | null;
  };
}) {
  return (
    <div className="space-y-3 p-3">
      <h1 className="text-xl font-medium tracking-tight">Profile</h1>
      <dl className="overflow-hidden rounded-lg border border-line text-sm">
        {[
          ["Name", driver.name],
          ["Phone", driver.phone || "—"],
          ["Email", driver.email],
          ["Driver ID", driver.driverCode ?? "—"],
          ["Vehicle", driver.vehicle || "—"],
          ["Plate", driver.plate || "—"],
          ["Fuel", driver.vehicleFuel ?? "—"],
          ["Odometer", driver.vehicleOdometer == null ? "—" : `${kmText(driver.vehicleOdometer)} km`],
          ["Vehicle status", driver.vehicleStatus?.replaceAll("_", " ") ?? "—"],
          ["Account", driver.status],
        ].map(([k, v]) => (
          <div key={k} className="grid grid-cols-3 gap-2 border-b border-line px-3 py-3">
            <dt className="text-muted">{k}</dt>
            <dd className="col-span-2">{v}</dd>
          </div>
        ))}
      </dl>
      <PresencePill presence={driver.presence} />
      <p className="text-xs text-muted">Earnings and ratings are not part of this system.</p>
      <Btn
        variant="ghost"
        className="w-full"
        onClick={() => {
          void logOutEvent().finally(() => signOut("/login").catch(() => undefined));
        }}
      >
        Log out
      </Btn>
    </div>
  );
}
