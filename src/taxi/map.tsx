import { useEffect, useRef, useState } from "react";
import { LocateFixed } from "lucide-react";
import maplibregl, { type GeoJSONSource, type Map as MlMap, type Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { LatLng, Presence } from "@/lib/taxi/logic";
import borders from "@/lib/taxi/kosovo-borders.json";

export type MapDriver = {
  id: string;
  name: string;
  presence: Presence;
  latitude: number | null;
  longitude: number | null;
  speedKmh: number | null;
  gpsStale?: boolean;
};

const STATUS_WORD: Record<Presence, string> = {
  ONLINE: "Available",
  ON_RIDE: "On ride",
  OFFLINE: "Offline",
};

const PIN: Record<Presence, string> = {
  ONLINE: "var(--color-ok)",
  ON_RIDE: "var(--color-accent)",
  OFFLINE: "var(--color-muted)",
};

const DARK_STYLE = "https://tiles.openfreemap.org/styles/dark";
const SAT_TILES = "/api/tiles?k=sat&z={z}&x={x}&y={y}";

const REGION_COLOR: Record<string, string> = {
  Prishtinë: "#7ce4f7",
  Prizren: "#9ad7ff",
  Pejë: "#8fd6c4",
  Gjakovë: "#d7c4ff",
  Ferizaj: "#f2d48a",
  Gjilan: "#f0b7c8",
  Mitrovicë: "#b7d4ff",
};

const REGIONS = [
  { name: "Prishtinë" },
  { name: "Prizren" },
  { name: "Pejë" },
  { name: "Gjakovë" },
  { name: "Ferizaj" },
  { name: "Gjilan" },
  { name: "Mitrovicë" },
];

export type MapMode = "streets" | "satellite" | "hybrid";

function esc(value: string) {
  return value.replaceAll("&", "\u0026amp;").replaceAll("<", "\u0026lt;").replaceAll(">", "\u0026gt;");
}

function line(points: LatLng[]) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "LineString" as const, coordinates: points.map((p) => [p.lng, p.lat]) },
  };
}

function keepLayer(id: string, mode: "satellite" | "hybrid") {
  if (id.startsWith("boundary") || id.startsWith("place_")) return true;
  if (mode === "hybrid" && (id.startsWith("highway") || id.startsWith("road_") || id.startsWith("waterway") || id === "water_name")) return true;
  return false;
}

async function styleFor(mode: MapMode) {
  const satellite = {
    type: "raster",
    tiles: [new URL(SAT_TILES, window.location.origin).toString()],
    tileSize: 256,
    maxzoom: 19,
    attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
  };
  if (mode === "streets") return DARK_STYLE;
  const imagery = {
    version: 8 as const,
    sources: { satellite },
    layers: [{ id: "satellite", type: "raster" as const, source: "satellite" }],
  };
  try {
    const base = (await fetch(DARK_STYLE).then((res) => {
      if (!res.ok) throw new Error("style");
      return res.json();
    })) as { glyphs?: string; sprite?: string; sources: Record<string, unknown>; layers: Array<{ id: string; type: string; paint?: { "line-color"?: string } }> };
    const layers = base.layers.filter((layer) => keepLayer(layer.id, mode)).map((layer) => {
      if (layer.type === "line" && layer.paint) layer.paint["line-color"] = "#f4f7fb";
      return layer;
    });
    return { version: 8, glyphs: base.glyphs, sprite: base.sprite, sources: { ...base.sources, satellite }, layers: [imagery.layers[0], ...layers] };
  } catch {
    return imagery;
  }
}

type Motion = {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  start: number;
  dur: number;
};

function visualPose(id: string, lat: number, lng: number, motions: Map<string, Motion>, shown: Map<string, LatLng>) {
  const now = performance.now();
  const motion = motions.get(id);
  const current = shown.get(id);
  if (motion && Math.abs(motion.toLat - lat) < 1e-6 && Math.abs(motion.toLng - lng) < 1e-6) {
    const t = Math.min(1, (now - motion.start) / motion.dur);
    const pose = {
      lat: motion.fromLat + (motion.toLat - motion.fromLat) * t,
      lng: motion.fromLng + (motion.toLng - motion.fromLng) * t,
    };
    shown.set(id, pose);
    return pose;
  }
  if (!current || (Math.abs(current.lat - lat) < 0.00002 && Math.abs(current.lng - lng) < 0.00002)) {
    const pose = { lat, lng };
    shown.set(id, pose);
    motions.set(id, { fromLat: lat, fromLng: lng, toLat: lat, toLng: lng, start: now, dur: 1 });
    return pose;
  }
  motions.set(id, { fromLat: current.lat, fromLng: current.lng, toLat: lat, toLng: lng, start: now, dur: 900 });
  return current;
}

function markerEl(html: string, className: string) {
  const el = document.createElement("div");
  el.className = className;
  el.innerHTML = html;
  return el;
}

export function FleetMap({
  drivers,
  route,
  alternatives,
  pickup,
  destination,
  selectedId,
  onSelect,
  onMapClick,
  base,
  defaultMode = "streets",
  tracking = false,
  className = "",
}: {
  drivers: MapDriver[];
  route?: LatLng[] | null;
  alternatives?: LatLng[][] | null;
  pickup?: LatLng | null;
  destination?: LatLng | null;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onMapClick?: (point: LatLng) => void;
  base?: { lat: number; lng: number; label: string } | null;
  defaultMode?: MapMode;
  tracking?: boolean;
  className?: string;
}) {
  const el = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markers = useRef(new Map<string, Marker>());
  const onSelectRef = useRef(onSelect);
  const onClickRef = useRef(onMapClick);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<MapMode>(defaultMode);
  const [note, setNote] = useState<string | null>(null);
  const [follow, setFollow] = useState(false);
  const [locateMsg, setLocateMsg] = useState<string | null>(null);
  const fitted = useRef(false);
  const trails = useRef(new Map<string, LatLng[]>());
  const motions = useRef(new Map<string, Motion>());
  const shown = useRef(new Map<string, LatLng>());
  const followRef = useRef(false);
  const selectedRef = useRef<string | null>(null);
  const rafRef = useRef(0);
  followRef.current = follow;
  selectedRef.current = selectedId ?? null;
  onSelectRef.current = onSelect;
  onClickRef.current = onMapClick;

  useEffect(() => {
    const node = el.current;
    if (!node || mapRef.current) return;
    let dead = false;
    const map = new maplibregl.Map({
      container: node,
      style: DARK_STYLE,
      center: [20.9653, 42.8228],
      zoom: 12,
      attributionControl: { compact: true },
      fadeDuration: 0,
    });
    mapRef.current = map;
    map.on("load", () => {
      map.resize();
      if (!dead) setReady(true);
    });
    map.on("error", () => {
      if (!dead) setNote("Map tiles are slow. The last good view stays on screen.");
    });
    map.on("click", (event) => {
      onClickRef.current?.({ lat: event.lngLat.lat, lng: event.lngLat.lng });
    });
    map.on("dragstart", () => setFollow(false));
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(node);
    return () => {
      dead = true;
      ro.disconnect();
      markers.current.forEach((marker) => marker.remove());
      markers.current.clear();
      cancelAnimationFrame(rafRef.current);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    void styleFor(mode)
      .then((style) => {
        if (cancelled || !mapRef.current) return;
        map.setStyle(style as maplibregl.StyleSpecification | string);
        map.once("idle", () => {
          map.resize();
          if (!cancelled) setNote(null);
        });
      })
      .catch(() => {
        if (!cancelled) setNote("The current map style is unavailable. Showing the last loaded view.");
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const draw = () => {
      if (!map.getStyle()) return;
      if (!map.getSource("borders")) {
        map.addSource("borders", { type: "geojson", data: borders as never });
        map.addLayer({
          id: "muni-line",
          type: "line",
          source: "borders",
          paint: { "line-color": "#e7eef8", "line-width": 1.4, "line-opacity": 0.85 },
        });
        map.addLayer({
          id: "muni-label",
          type: "symbol",
          source: "borders",
          layout: {
            "text-field": ["get", "name"],
            "text-size": 11,
            "text-font": ["Noto Sans Regular"],
          },
          paint: { "text-color": "#f4f7fb", "text-halo-color": "#111113", "text-halo-width": 1.2 },
        });
      }
      const features = [
        ...(alternatives ?? []).filter((alt) => alt.length >= 2).map((alt) => ({ ...line(alt), properties: { kind: "alt" } })),
        ...(route && route.length >= 2 ? [{ ...line(route), properties: { kind: "main" } }] : []),
        ...[...trails.current.entries()]
          .filter(([, trail]) => trail.length >= 2)
          .map(([id, trail]) => ({ ...line(trail), properties: { kind: id === selectedId ? "trail-hot" : "trail" } })),
      ];
      const data = { type: "FeatureCollection" as const, features };
      const source = map.getSource("routes") as GeoJSONSource | undefined;
      if (source) source.setData(data);
      else {
        map.addSource("routes", { type: "geojson", data });
        map.addLayer({
          id: "route-alt",
          type: "line",
          source: "routes",
          filter: ["==", ["get", "kind"], "alt"],
          paint: { "line-color": "#8ea0b8", "line-width": 3, "line-dasharray": [1.2, 1.2] },
        });
        map.addLayer({
          id: "route-main",
          type: "line",
          source: "routes",
          filter: ["==", ["get", "kind"], "main"],
          paint: { "line-color": "#7ce4f7", "line-width": 5 },
        });
        map.addLayer({
          id: "route-trail",
          type: "line",
          source: "routes",
          filter: ["in", ["get", "kind"], ["literal", ["trail", "trail-hot"]]],
          paint: { "line-color": "#9ad7ff", "line-width": 2, "line-opacity": 0.8 },
        });
      }
    };
    if (map.isStyleLoaded()) draw();
    else map.once("idle", draw);
  }, [ready, mode, route, alternatives, selectedId, drivers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const seen = new Set<string>();
    const place = (key: string, lng: number, lat: number, html: string, className: string, onClick?: () => void) => {
      seen.add(key);
      const existing = markers.current.get(key);
      if (existing) {
        existing.setLngLat([lng, lat]);
        const root = existing.getElement();
        if (root.innerHTML !== html) root.innerHTML = html;
        return;
      }
      const element = markerEl(html, className);
      if (onClick) element.addEventListener("click", (event) => {
        event.stopPropagation();
        onClick();
      });
      const marker = new maplibregl.Marker({ element, anchor: "center" }).setLngLat([lng, lat]).addTo(map);
      markers.current.set(key, marker);
    };
    if (base) {
      place("base", base.lng, base.lat, `<span class="taxi-base-mark">BASE</span><span class="taxi-pin-name">${esc(base.label)}</span>`, "taxi-base");
    }
    if (pickup) place("pickup", pickup.lng, pickup.lat, `<span class="taxi-stop-mark" style="--pin:#7ce4f7">P</span>`, "taxi-stop");
    if (destination) place("dest", destination.lng, destination.lat, `<span class="taxi-stop-mark" style="--pin:#e7eef8">D</span>`, "taxi-stop");
    const pump = () => {
      const now = performance.now();
      let moving = false;
      for (const [id, motion] of motions.current) {
        const t = Math.min(1, (now - motion.start) / Math.max(1, motion.dur));
        const pose = {
          lat: motion.fromLat + (motion.toLat - motion.fromLat) * t,
          lng: motion.fromLng + (motion.toLng - motion.fromLng) * t,
        };
        shown.current.set(id, pose);
        markers.current.get(id)?.setLngLat([pose.lng, pose.lat]);
        if (t < 1) moving = true;
        if (followRef.current && id === selectedRef.current) map.setCenter([pose.lng, pose.lat]);
      }
      rafRef.current = moving ? requestAnimationFrame(pump) : 0;
    };
    for (const driver of drivers) {
      if (driver.latitude == null || driver.longitude == null) continue;
      const trail = trails.current.get(driver.id) ?? [];
      const last = trail[trail.length - 1];
      if (!last || Math.abs(last.lat - driver.latitude) > 0.00005 || Math.abs(last.lng - driver.longitude) > 0.00005) {
        trail.push({ lat: driver.latitude, lng: driver.longitude });
        if (trail.length > 40) trail.shift();
        trails.current.set(driver.id, trail);
      }
      const pose = visualPose(driver.id, driver.latitude, driver.longitude, motions.current, shown.current);
      const selected = driver.id === selectedId;
      const first = esc(driver.name.split(" ")[0] ?? driver.name);
      place(
        driver.id,
        pose.lng,
        pose.lat,
        `<span class="taxi-mark" style="--pin:${PIN[driver.presence]}"></span><span class="taxi-pin-name">${first}</span><span class="taxi-pin-state">${STATUS_WORD[driver.presence]}</span>`,
        `taxi-pin${selected ? " taxi-pin-selected" : ""}`,
        () => {
          onSelectRef.current?.(driver.id);
          setFollow(true);
        },
      );
    }
    for (const [key, marker] of markers.current) {
      if (!seen.has(key)) {
        marker.remove();
        markers.current.delete(key);
        motions.current.delete(key);
        shown.current.delete(key);
      }
    }
    const stillMoving = [...motions.current.values()].some((motion) => performance.now() - motion.start < motion.dur);
    if (stillMoving && !rafRef.current) rafRef.current = requestAnimationFrame(pump);
    if (!fitted.current) {
      const points = drivers
        .filter((d) => d.latitude != null && d.longitude != null)
        .map((d) => [d.longitude!, d.latitude!] as [number, number]);
      if (base) points.push([base.lng, base.lat]);
      if (points.length === 1) map.jumpTo({ center: points[0], zoom: 13 });
      else if (points.length > 1) {
        const bounds = points.reduce((box, point) => box.extend(point), new maplibregl.LngLatBounds(points[0], points[0]));
        map.fitBounds(bounds, { padding: 48, maxZoom: 13, animate: false });
      }
      fitted.current = points.length > 0;
    }
  }, [ready, drivers, pickup, destination, selectedId, base]);

  useEffect(() => {
    if (tracking) setFollow(true);
  }, [tracking, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !follow) return;
    const pose = selectedId ? shown.current.get(selectedId) : undefined;
    const driver = drivers.find((d) => d.id === selectedId && d.latitude != null && d.longitude != null);
    const lat = pose?.lat ?? driver?.latitude;
    const lng = pose?.lng ?? driver?.longitude;
    if (lat == null || lng == null) return;
    map.easeTo({ center: [lng, lat], duration: 400 });
  }, [ready, follow, selectedId]);

  function locateMe() {
    const map = mapRef.current;
    if (!map) return;
    if (!navigator.geolocation) {
      setLocateMsg("This browser has no GPS.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        map.easeTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: Math.max(map.getZoom(), 15) });
        setFollow(false);
        setLocateMsg(null);
      },
      () => setLocateMsg("Location permission denied."),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 },
    );
  }

  function trackFleet() {
    const map = mapRef.current;
    if (!map) return;
    const spots = drivers.filter((d) => d.latitude != null && d.longitude != null);
    if (spots.length === 0) return;
    const bounds = spots.reduce(
      (box, driver) => box.extend([driver.longitude!, driver.latitude!]),
      new maplibregl.LngLatBounds([spots[0].longitude!, spots[0].latitude!], [spots[0].longitude!, spots[0].latitude!]),
    );
    map.fitBounds(bounds, { padding: 56, maxZoom: 14 });
    const live = spots.find((d) => d.presence !== "OFFLINE") ?? spots[0];
    if (live) {
      onSelectRef.current?.(live.id);
      setFollow(true);
    }
  }

  const located = drivers.filter((d) => d.latitude != null && d.longitude != null);
  const live = located.filter((d) => d.presence !== "OFFLINE" && !d.gpsStale).length;

  return (
    <div className={`relative h-full min-h-64 w-full min-w-0 overflow-hidden ${className}`}>
      <div ref={el} style={{ position: "absolute", inset: 0 }} />
      <div className="absolute top-3 right-3 z-[2] flex max-w-[calc(100%-1.5rem)] overflow-hidden rounded-md border border-line bg-surface text-xs">
        {(["streets", "satellite", "hybrid"] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={`h-11 shrink-0 px-2.5 sm:px-3 ${mode === item ? "bg-accent text-on-accent" : "text-muted"}`}
            onClick={() => setMode(item)}
          >
            {item === "streets" ? "Map" : item === "satellite" ? "Satellite" : "Hybrid"}
          </button>
        ))}
      </div>
      <div className="absolute right-3 bottom-3 z-[2] flex flex-col gap-1">
        <button type="button" className="grid h-11 w-11 place-items-center rounded-md border border-line bg-surface text-fg" onClick={locateMe} aria-label="Current location">
          <LocateFixed className="size-4" />
        </button>
        <button type="button" className="grid h-11 w-11 place-items-center rounded-md border border-line bg-surface text-lg text-fg" onClick={() => mapRef.current?.zoomIn()} aria-label="Zoom in">+</button>
        <button type="button" className="grid h-11 w-11 place-items-center rounded-md border border-line bg-surface text-lg text-fg" onClick={() => mapRef.current?.zoomOut()} aria-label="Zoom out">−</button>
      </div>
      {mode !== "streets" ? (
        <div className="absolute bottom-14 left-3 z-[2] hidden max-w-[calc(100%-4.75rem)] flex-wrap gap-x-2 gap-y-1 rounded-md border border-line bg-surface/95 px-2 py-1 text-[11px] text-fg sm:flex">
          {REGIONS.map((region) => (
            <span key={region.name} className="inline-flex items-center gap-1">
              <span className="size-2 rounded-full" style={{ background: REGION_COLOR[region.name] }} />
              {region.name}
            </span>
          ))}
        </div>
      ) : null}
      <div className="absolute bottom-3 left-3 z-[2] flex max-w-[calc(100%-4.75rem)] flex-wrap items-center gap-2 rounded-md border border-line bg-surface/95 px-2 py-1.5 text-xs">
        <span className="font-medium text-fg">GPS tracking</span>
        <span className="text-muted">{live} live · {located.length} on the map</span>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-ok" /> Available</span>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-accent" /> On ride</span>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-muted" /> Offline</span>
        <button type="button" className="h-8 rounded-md bg-accent px-2 font-medium text-on-accent" onClick={trackFleet}>
          {follow ? "Following" : "Track fleet"}
        </button>
        {note ? <span className="text-warn">{note}</span> : null}
        {locateMsg ? <span className="text-warn">{locateMsg}</span> : null}
      </div>
    </div>
  );
}
