import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { getDriverDay, getFleet } from "@/lib/taxi/api";
import { errText, eur, isFail, kmText, todayISO } from "@/lib/taxi/format";
import { STATUS_LABEL, type LatLng } from "@/lib/taxi/logic";
import { FleetMap, type MapDriver } from "./map";
import { Banner, Btn, Empty, PageHead, Panel, Stat, filterFieldClass } from "./ui";

const ZONE = "Europe/Belgrade";

function clock(t: number | null | undefined) {
  if (t == null) return "—";
  return new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: ZONE });
}

function hours(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h ${m} min` : `${m} min`;
}

function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type TimelineItem = { at: number; kind: "stop" | "gap" | "order"; title: string; detail: string };

/** Where one car was during a day: the GPS route, a time slider, stops, GPS gaps and trips. */
export function HistoryPage({ driverId }: { driverId?: string }) {
  const fleet = useQuery({ queryKey: ["fleet"], queryFn: () => getFleet() });
  const drivers = fleet.data && !isFail(fleet.data) && fleet.data.success ? fleet.data.drivers : [];
  const [id, setId] = useState(driverId ?? "");
  const [date, setDate] = useState(() => todayISO());
  const today = todayISO();
  const firstDriverId = drivers[0]?.id;
  useEffect(() => {
    if (!id && firstDriverId) setId(firstDriverId);
  }, [id, firstDriverId]);

  const day = useQuery({
    queryKey: ["driver-day", id, date],
    queryFn: () => getDriverDay({ data: { driverId: id, date } }),
    enabled: Boolean(id),
    // Today's route keeps growing while the shift runs.
    refetchInterval: date === today ? 15_000 : false,
  });
  const data = day.data && !isFail(day.data) && day.data.success ? day.data : null;
  const track = useMemo(() => data?.track ?? [], [data]);
  const points = useMemo<LatLng[]>(() => track.map((p) => ({ lat: p.lat, lng: p.lng })), [track]);

  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(false);
  // Jump to the latest position whenever another driver or day is loaded.
  useEffect(() => {
    setPos(Math.max(0, track.length - 1));
    setPlaying(false);
  }, [id, date, track.length]);
  useEffect(() => {
    if (!playing) return;
    const step = Math.max(1, Math.round(track.length / 300));
    const timer = window.setInterval(() => {
      setPos((p) => {
        if (p + step >= track.length - 1) {
          setPlaying(false);
          return track.length - 1;
        }
        return p + step;
      });
    }, 100);
    return () => window.clearInterval(timer);
  }, [playing, track.length]);

  const current = track[pos];
  const marker: MapDriver[] = current
    ? [{ id: "history-car", name: data?.driver.name ?? "Car", presence: "ON_RIDE", latitude: current.lat, longitude: current.lng, speedKmh: current.speedKmh }]
    : [];

  const timeline: TimelineItem[] = data
    ? [
        ...data.stops.map((s) => ({ at: s.from, kind: "stop" as const, title: `Stopped ${hours(s.minutes)}`, detail: `${clock(s.from)}–${clock(s.to)}` })),
        ...data.gaps.map((g) => ({ at: g.from, kind: "gap" as const, title: `No GPS for ${hours(g.minutes)}`, detail: `${clock(g.from)}–${clock(g.to)} · phone off, locked or offline` })),
        ...data.orders.map((o) => ({
          at: new Date(o.createdAt).getTime(),
          kind: "order" as const,
          title: `${o.code} · ${STATUS_LABEL[o.status]}${o.source === "DIRECT" ? " · Driver-registered" : ""}`,
          detail: `${o.pickupLabel} → ${o.destLabel}${o.priceEur != null ? ` · ${eur(o.priceEur)}` : ""}`,
        })),
      ].sort((a, b) => a.at - b.at)
    : [];

  function seek(at: number) {
    if (!track.length) return;
    let best = 0;
    for (let i = 1; i < track.length; i += 1) if (Math.abs(track[i].t - at) < Math.abs(track[best].t - at)) best = i;
    setPlaying(false);
    setPos(best);
  }

  return (
    <div className="space-y-3">
      <PageHead title="Route history">
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <select className={`${filterFieldClass} sm:w-56`} value={id} onChange={(e) => setId(e.target.value)} aria-label="Driver">
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.driverCode ? ` · ${d.driverCode}` : ""}
              </option>
            ))}
          </select>
          <div className="flex w-full gap-2 sm:w-auto">
            <Btn variant="ghost" className="w-11 shrink-0 px-0" aria-label="Previous day" onClick={() => setDate((d) => shiftDate(d, -1))}>
              <ChevronLeft className="size-4" />
            </Btn>
            <input className={`${filterFieldClass} sm:w-44`} type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Day" />
            <Btn variant="ghost" className="w-11 shrink-0 px-0" aria-label="Next day" disabled={date >= today} onClick={() => setDate((d) => shiftDate(d, 1))}>
              <ChevronRight className="size-4" />
            </Btn>
          </div>
        </div>
      </PageHead>
      {day.isError ? <Banner>{errText(day.error)}</Banner> : null}
      {isFail(day.data) ? <Banner>{day.data.message}</Banner> : null}

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="First seen" value={clock(data?.stats.firstAt)} />
        <Stat label="Last seen" value={clock(data?.stats.lastAt)} />
        <Stat label="Distance" value={`${kmText(data?.stats.km ?? null)} km`} hint="From GPS samples" />
        <Stat label="Driving" value={data ? hours(data.stats.movingMinutes) : "—"} />
        <Stat label="Trips" value={data ? `${data.stats.completed}/${data.stats.trips}` : "—"} hint="Completed / all" />
        <Stat label="Revenue" value={eur(data?.stats.revenue ?? null)} hint="Completed trips" />
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_22rem]">
        <Panel title={data ? `${data.driver.name}${data.driver.plate ? ` · ${data.driver.plate}` : ""}` : "Route"}>
          <div className="relative h-[26rem] lg:h-[34rem]">
            <FleetMap
              drivers={marker}
              route={points}
              pickup={points[0] ?? null}
              destination={points.length > 1 ? points[points.length - 1] : null}
              fitTo={points}
              defaultMode="hybrid"
              legend={false}
            />
            {data && track.length === 0 ? (
              <div className="pointer-events-none absolute inset-x-3 top-16 z-[3] rounded-md border border-line bg-surface/95 p-3 text-sm">
                No GPS for this day. The driver was offline, or the app was not open while driving.
              </div>
            ) : null}
          </div>
          {track.length > 1 ? (
            <div className="flex items-center gap-3 border-t border-line p-3">
              <Btn className="w-11 shrink-0 px-0" aria-label={playing ? "Pause" : "Play the day"} onClick={() => {
                if (!playing && pos >= track.length - 1) setPos(0);
                setPlaying((v) => !v);
              }}>
                {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
              </Btn>
              <input
                type="range"
                className="h-11 min-w-0 flex-1 accent-[var(--color-accent)]"
                min={0}
                max={track.length - 1}
                value={pos}
                onChange={(e) => {
                  setPlaying(false);
                  setPos(Number(e.target.value));
                }}
                aria-label="Time of day"
              />
              <span className="w-24 shrink-0 text-right font-mono text-sm tabular-nums">
                {clock(current?.t)}
                <span className="block text-xs text-muted">{current?.speedKmh != null ? `${Math.round(current.speedKmh)} km/h` : "—"}</span>
              </span>
            </div>
          ) : null}
        </Panel>
        <Panel title="Timeline" className="lg:max-h-[38rem]">
          <div className="overflow-auto p-3">
            {!data ? <p className="text-sm text-muted">{day.isPending && id ? "Loading the day…" : "Pick a driver."}</p> : null}
            {data && timeline.length === 0 ? <Empty title="Nothing recorded" body="No stops, trips or GPS gaps on this day." /> : null}
            <ul className="space-y-2">
              {timeline.map((item, i) => (
                <li key={`${item.kind}-${item.at}-${i}`}>
                  <button type="button" className="w-full rounded-md border border-line px-3 py-2 text-left hover:bg-surface-2" onClick={() => seek(item.at)}>
                    <span className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate">{item.title}</span>
                      <span className="shrink-0 font-mono text-xs text-muted">{clock(item.at)}</span>
                    </span>
                    <span className={`mt-0.5 block text-xs ${item.kind === "gap" ? "text-warn" : "text-muted"}`}>{item.detail}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </Panel>
      </div>
      <p className="text-xs text-muted">
        Routes are kept for 30 days. GPS is recorded only while the driver is online with TAXI IM open; a locked phone shows as a gap.
      </p>
    </div>
  );
}
