/**
 * Background GPS for the installed TAXI IM app (Capacitor shell in apps/mobile).
 *
 * The website runs inside the app's WebView, where Capacitor exposes native plugins on
 * `window.Capacitor`. When the BackgroundGeolocation plugin is present, location comes
 * from the native watcher, which keeps running with the screen locked (Android shows a
 * "TAXI IM is sharing your location" notification). Fixes are posted to /api/gps through
 * native HTTP, because Android throttles WebView requests after ~5 minutes in the
 * background. In a normal browser none of this exists and the page keeps using
 * navigator.geolocation.
 */
import { authClient } from "@/lib/auth/client";

type NativeLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  speed: number | null;
  bearing: number | null;
  time: number | null;
};
type NativeError = { code?: string; message?: string };
type BackgroundGeolocationPlugin = {
  addWatcher(
    options: {
      backgroundTitle?: string;
      backgroundMessage?: string;
      requestPermissions?: boolean;
      stale?: boolean;
      distanceFilter?: number;
    },
    callback: (location?: NativeLocation, error?: NativeError) => void,
  ): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
  openSettings(): Promise<void>;
};
type HttpPlugin = {
  post(options: { url: string; headers: Record<string, string>; data: unknown }): Promise<{ status: number; data: unknown }>;
};
type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  Plugins?: { BackgroundGeolocation?: BackgroundGeolocationPlugin; CapacitorHttp?: HttpPlugin };
};

function capacitor(): CapacitorGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

function plugin() {
  const cap = capacitor();
  return cap?.isNativePlatform?.() ? cap.Plugins?.BackgroundGeolocation : undefined;
}

/** True inside the installed Android/iPhone app that has background GPS. */
export function hasBackgroundGps() {
  return Boolean(plugin());
}

export function openLocationSettings() {
  void plugin()?.openSettings();
}

export type NativeFix = {
  lat: number;
  lng: number;
  accuracyM: number | null;
  speedMps: number | null;
  heading: number | null;
  altitudeM: number | null;
  at: number;
};

let token: string | null = null;

async function sessionToken(refresh = false) {
  if (token && !refresh) return token;
  const res = await authClient.getSession();
  token = (res.data?.session as { token?: string } | undefined)?.token ?? null;
  return token;
}

/** Posts one fix through native HTTP. Returns the server's JSON reply. */
type FixReply = {
  success?: boolean;
  message?: string;
  code?: string;
  events?: Array<{ key: string; kind: "dispatch" | "ring"; title: string; body: string }>;
};

export async function postNativeFix(fix: NativeFix): Promise<FixReply> {
  const http = capacitor()?.Plugins?.CapacitorHttp;
  const url = `${window.location.origin}/api/gps`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const bearer = await sessionToken(attempt > 0);
    if (!bearer) return { success: false, message: "Sign in again to share your location.", code: "UNAUTHORIZED" };
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` };
    const res = http
      ? await http.post({ url, headers, data: fix })
      : await fetch(url, { method: "POST", headers, body: JSON.stringify(fix) }).then(async (r) => ({ status: r.status, data: await r.json() }));
    if (res.status === 401 && attempt === 0) continue;
    const data = typeof res.data === "string" ? (JSON.parse(res.data) as object) : (res.data as object);
    return data as FixReply;
  }
  return { success: false, message: "Sign in again to share your location.", code: "UNAUTHORIZED" };
}

/**
 * Starts the native watcher. `onFix` gets every location (foreground and locked);
 * `onError` gets a message, with `settings: true` when the driver must allow location.
 * Returns a function that stops tracking and removes the notification.
 */
export async function startBackgroundGps(
  onFix: (fix: NativeFix) => void,
  onError: (message: string, settings: boolean) => void,
): Promise<() => void> {
  const bg = plugin();
  if (!bg) return () => {};
  const id = await bg.addWatcher(
    {
      backgroundTitle: "TAXI IM is sharing your location",
      backgroundMessage: "The control center sees your car while you are online. Go offline in TAXI IM to stop.",
      requestPermissions: true,
      stale: false,
      distanceFilter: 0,
    },
    (location, error) => {
      if (error) {
        if (error.code === "NOT_AUTHORIZED") onError("Location is not allowed. Open Settings and allow location \"Always\" for TAXI IM.", true);
        else onError(error.message ?? "GPS is unavailable right now.", false);
        return;
      }
      if (!location) return;
      onFix({
        lat: location.latitude,
        lng: location.longitude,
        accuracyM: Number.isFinite(location.accuracy) ? location.accuracy : null,
        speedMps: location.speed != null && Number.isFinite(location.speed) ? location.speed : null,
        heading: location.bearing != null && Number.isFinite(location.bearing) ? location.bearing : null,
        altitudeM: location.altitude != null && Number.isFinite(location.altitude) ? location.altitude : null,
        at: location.time ?? Date.now(),
      });
    },
  );
  return () => {
    void bg.removeWatcher({ id });
  };
}
