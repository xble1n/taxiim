/** Shared Taxi IM rules. Safe to import from client and server. */

export const MAX_ADMINS = 1;
export const MAX_DRIVERS = 50;
export const MAX_CHAT = 500;
export const MAX_SPEED_KMH = 180;
export const SPEED_ALERT_DEFAULT = 120;
export const STALE_SECONDS_DEFAULT = 90;

export const ORDER_STATUSES = [
  "PENDING",
  "DISPATCHED",
  "ACCEPTED",
  "ON_THE_WAY",
  "DECLINED",
  "ARRIVED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type Role = "ADMIN" | "DRIVER";
export type Presence = "OFFLINE" | "ONLINE" | "ON_RIDE";
export type AccountStatus = "ACTIVE" | "DISABLED";

export type OrderAction =
  | "dispatch"
  | "accept"
  | "decline"
  | "enroute"
  | "arrived"
  | "start"
  | "complete"
  | "cancel"
  | "reassign";

export type LatLng = { lat: number; lng: number };

export type ApiFailure = { success: false; message: string; code: string };

export const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: "Pending",
  DISPATCHED: "Dispatched",
  ACCEPTED: "Confirmed",
  ON_THE_WAY: "On the way",
  DECLINED: "Declined",
  ARRIVED: "Arrived",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const ACTIVE_STATUSES: readonly OrderStatus[] = [
  "DISPATCHED",
  "ACCEPTED",
  "ON_THE_WAY",
  "ARRIVED",
  "IN_PROGRESS",
];

const NEXT: Record<OrderStatus, Partial<Record<OrderAction, OrderStatus>>> = {
  PENDING: { dispatch: "DISPATCHED", cancel: "CANCELLED" },
  DISPATCHED: {
    accept: "ACCEPTED",
    decline: "DECLINED",
    cancel: "CANCELLED",
    reassign: "DISPATCHED",
  },
  ACCEPTED: { enroute: "ON_THE_WAY", cancel: "CANCELLED", reassign: "DISPATCHED" },
  ON_THE_WAY: { arrived: "ARRIVED", cancel: "CANCELLED", reassign: "DISPATCHED" },
  DECLINED: { reassign: "DISPATCHED", cancel: "CANCELLED" },
  ARRIVED: { start: "IN_PROGRESS", cancel: "CANCELLED", reassign: "DISPATCHED" },
  IN_PROGRESS: { complete: "COMPLETED", cancel: "CANCELLED" },
  COMPLETED: {},
  CANCELLED: {},
};

export function fail(message: string, code: string): ApiFailure {
  return { success: false, message, code };
}

export function canCreateAccount(role: Role, current: number): boolean {
  if (role === "ADMIN") return current < MAX_ADMINS;
  return current < MAX_DRIVERS;
}

export function nextStatus(from: OrderStatus, action: OrderAction): OrderStatus | null {
  return NEXT[from][action] ?? null;
}

export function actionAllowedFor(role: Role, action: OrderAction): boolean {
  if (role === "ADMIN") {
    return action === "cancel" || action === "reassign" || action === "dispatch" || action === "complete";
  }
  return (
    action === "accept" ||
    action === "decline" ||
    action === "enroute" ||
    action === "arrived" ||
    action === "start" ||
    action === "complete"
  );
}

export function isValidCoord(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dp = ((b.lat - a.lat) * Math.PI) / 180;
  const dl = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function litersPer100(liters: number, kilometers: number): number | null {
  if (!Number.isFinite(liters) || !Number.isFinite(kilometers) || liters < 0 || kilometers <= 0) return null;
  return round2((liters / kilometers) * 100);
}

export function costPerKm(cost: number, kilometers: number): number | null {
  if (!Number.isFinite(cost) || !Number.isFinite(kilometers) || cost < 0 || kilometers <= 0) return null;
  return round2(cost / kilometers);
}

export function fuelTotal(liters: number, pricePerLiter: number): number {
  return round2(Math.max(0, liters) * Math.max(0, pricePerLiter));
}

export function unusualFuel(litersPer100km: number | null, limit = 12): boolean {
  return litersPer100km != null && litersPer100km > limit;
}

export type GpsPoint = {
  lat: number;
  lng: number;
  accuracyM: number | null;
  speedMps: number | null;
  at: number;
};

export type GpsDecision = {
  accept: boolean;
  code: string;
  message: string;
  speedKmh: number | null;
  addedKm: number;
};

const MAX_ACCURACY_M = 2500;
const MIN_MOVE_M = 12;
const MAX_JUMP_M = 2000;
const MAX_JUMP_WINDOW_MS = 10_000;

export function assessGps(
  prev: { lat: number; lng: number; at: number } | null,
  next: GpsPoint,
): GpsDecision {
  if (!isValidCoord(next.lat, next.lng)) {
    return {
      accept: false,
      code: "GPS_INVALID",
      message: "Location is outside the valid coordinate range.",
      speedKmh: null,
      addedKm: 0,
    };
  }
  if (next.accuracyM != null && (!Number.isFinite(next.accuracyM) || next.accuracyM < 0 || next.accuracyM > MAX_ACCURACY_M)) {
    return {
      accept: false,
      code: "GPS_INVALID",
      message: "GPS accuracy is too poor to record.",
      speedKmh: null,
      addedKm: 0,
    };
  }

  let addedKm = 0;
  let computed: number | null = null;
  if (prev && isValidCoord(prev.lat, prev.lng)) {
    const meters = haversineMeters(prev, next);
    const dt = Math.max(0, next.at - prev.at);
    if (dt > 0 && dt <= MAX_JUMP_WINDOW_MS && meters > MAX_JUMP_M) {
      return {
        accept: false,
        code: "GPS_JUMP",
        message: "That location jumped too far to be real and was rejected.",
        speedKmh: null,
        addedKm: 0,
      };
    }
    if (dt >= 1000) {
      computed = meters / 1000 / (dt / 3_600_000);
      if (computed > MAX_SPEED_KMH) {
        return {
          accept: false,
          code: "GPS_JUMP",
          message: "Implied speed is impossible. Update rejected.",
          speedKmh: null,
          addedKm: 0,
        };
      }
    }
    if (meters >= MIN_MOVE_M) addedKm = meters / 1000;
  }

  let speedKmh: number | null = null;
  if (next.speedMps != null && Number.isFinite(next.speedMps) && next.speedMps >= 0) {
    const fromDevice = next.speedMps * 3.6;
    if (fromDevice <= MAX_SPEED_KMH) speedKmh = fromDevice;
  }
  if (speedKmh == null && computed != null && computed <= MAX_SPEED_KMH) speedKmh = computed;
  return { accept: true, code: "OK", message: "", speedKmh, addedKm: round2(addedKm) };
}

export type GpsQuality = "off" | "active" | "weak" | "unavailable";

export function gpsQuality(input: {
  online: boolean;
  error: string | null;
  accuracyM: number | null;
  stale: boolean;
  hasFix: boolean;
}): GpsQuality {
  if (!input.online) return "off";
  if (input.error || input.stale || !input.hasFix) return "unavailable";
  if (input.accuracyM == null || input.accuracyM > 40) return "weak";
  return "active";
}

export function quoteEuros(
  base: number,
  perKm: number,
  perMin: number,
  distanceKm: number,
  durationMin: number,
  minFare = 0,
): number {
  if (perKm === 0 && perMin === 0) return round2(Math.max(0, base));
  const raw = round2(base + perKm * Math.max(0, distanceKm) + perMin * Math.max(0, durationMin));
  const floor = Number.isFinite(minFare) && minFare > 0 ? round2(minFare) : 0;
  return round2(Math.max(raw, floor));
}

export function validatePrice(input: {
  name: string;
  basePrice: number;
  perKm: number;
  perMin: number;
  minFare?: number;
}): ApiFailure | { success: true; name: string; basePrice: number; perKm: number; perMin: number; minFare: number } {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) {
    return fail("Destination name must be 2–80 characters.", "PRICE_INVALID");
  }
  const minFare = input.minFare ?? 0;
  const fields: Array<[string, number]> = [
    ["Base price", input.basePrice],
    ["Per kilometre price", input.perKm],
    ["Per minute price", input.perMin],
    ["Minimum fare", minFare],
  ];
  for (const [label, n] of fields) {
    if (!Number.isFinite(n) || n < 0 || n > 10000) return fail(`${label} is not a valid amount.`, "PRICE_INVALID");
  }
  return {
    success: true,
    name,
    basePrice: round2(input.basePrice),
    perKm: round2(input.perKm),
    perMin: round2(input.perMin),
    minFare: round2(minFare),
  };
}

export function validatePassword(password: string): ApiFailure | { success: true } {
  if (password.length < 8 || password.length > 72) {
    return fail("Password must be 8–72 characters.", "VALIDATION");
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return fail("Password needs at least one letter and one number.", "VALIDATION");
  }
  return { success: true };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string | null {
  const v = email.trim().toLowerCase();
  if (!EMAIL_RE.test(v) || v.length > 120) return null;
  return v;
}

export function sanitizeChat(raw: string): ApiFailure | { success: true; text: string } {
  const text = raw.replace(/<[^>]*>/g, "").replace(/[<>]/g, "").trim();
  if (!text) return fail("Message is empty.", "MESSAGE_EMPTY");
  if (text.length > MAX_CHAT) return fail("Message is too long (500 characters max).", "MESSAGE_TOO_LONG");
  return { success: true, text };
}

export function nextDriverCode(existing: string[]): string {
  const set = new Set(existing);
  let n = 1;
  for (;;) {
    const code = `D-${String(n).padStart(2, "0")}`;
    if (!set.has(code)) return code;
    n += 1;
    if (n > 999) return `D-${Date.now().toString(36).toUpperCase()}`;
  }
}

export function interpolate(a: LatLng, b: LatLng, steps: number): LatLng[] {
  const out: LatLng[] = [];
  const n = Math.max(2, steps);
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    out.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
  }
  return out;
}

export function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

export type StaffDto = {
  id: string;
  role: Role;
  name: string;
  email: string;
  phone: string;
  status: AccountStatus;
  deleted: boolean;
  driverCode: string | null;
  vehicle: string;
  plate: string;
  presence: Presence;
  latitude: number | null;
  longitude: number | null;
  accuracyM: number | null;
  speedKmh: number | null;
  lastGpsAt: string | null;
  todayKm: number;
  yesterdayKm: number;
  weekKm: number;
  monthKm: number;
  heading: number | null;
  simulated: boolean;
  gpsStale: boolean;
  vehicleFuel: string | null;
  vehicleOdometer: number | null;
  vehicleStatus: string | null;
};

export type OrderDto = {
  id: string;
  code: string;
  status: OrderStatus;
  driverId: string | null;
  driverName: string | null;
  driverCode: string | null;
  pickupLabel: string;
  pickupLat: number;
  pickupLng: number;
  destLabel: string;
  destLat: number;
  destLng: number;
  notes: string;
  source: "DISPATCH" | "DIRECT";
  priceEur: number | null;
  distanceKm: number | null;
  durationMin: number | null;
  route: LatLng[] | null;
  alternatives: LatLng[][] | null;
  createdAt: string;
  dispatchedAt: string | null;
  acceptedAt: string | null;
  arrivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
};

export type AlertDto = {
  id: string;
  type: string;
  title: string;
  body: string;
  acknowledged: boolean;
  createdAt: string;
  driverId: string | null;
  driverName: string | null;
  actorName: string | null;
};

export type ChatDto = {
  id: string;
  body: string;
  createdAt: string;
  senderId: string;
  senderName: string;
  senderRole: Role;
};

export type PriceDto = {
  id: string;
  name: string;
  basePrice: number;
  perKm: number;
  perMin: number;
  minFare: number;
  latitude: number | null;
  longitude: number | null;
  enabled: boolean;
};

export type ActivityDto = {
  id: string;
  eventType: string;
  actorName: string | null;
  description: string;
  createdAt: string;
  entityType: string | null;
  entityId: string | null;
};

export type RouteStep = {
  text: string;
  distanceKm: number;
};

export type RouteOption = {
  distanceKm: number;
  durationMin: number;
  coordinates: LatLng[];
  steps?: RouteStep[];
};

export type RouteResult = {
  provider: "mapbox" | "osrm" | "straight";
  traffic: boolean;
  routes: RouteOption[];
};

