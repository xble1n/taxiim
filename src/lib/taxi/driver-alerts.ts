/**
 * Alerts a driver about a new order or a ring from the desk: sound, vibration and a
 * system notification, each with its own sound so the two cannot be confused.
 *
 * - Installed Android/iPhone app: a native notification on its own channel
 *   ("taxi_dispatch" / "taxi_ring" sounds from apps/mobile res/raw). It also works with the
 *   screen locked, because background GPS keeps the app running and every location upload
 *   returns new orders and rings (see `events` from /api/gps).
 * - Browser: Web Audio sound and vibration while the page is open, plus a notification
 *   through a small service worker when the driver allowed notifications.
 */
import { VIBRATE_DISPATCH, VIBRATE_RING, playDispatch, playRing } from "@/taxi/sound";

export type DriverEvent = { key: string; kind: "dispatch" | "ring"; title: string; body: string };

type LocalNotificationsPlugin = {
  createChannel(channel: { id: string; name: string; description?: string; sound?: string; importance?: number; visibility?: number; vibration?: boolean }): Promise<void>;
  requestPermissions(): Promise<{ display: string }>;
  checkPermissions(): Promise<{ display: string }>;
  schedule(options: {
    notifications: Array<{ id: number; title: string; body: string; channelId?: string; sound?: string; extra?: unknown }>;
  }): Promise<unknown>;
};

const CHANNEL = { dispatch: "taxi-dispatch", ring: "taxi-ring" } as const;

function native(): LocalNotificationsPlugin | undefined {
  if (typeof window === "undefined") return undefined;
  const cap = (window as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean; Plugins?: { LocalNotifications?: LocalNotificationsPlugin } };
  }).Capacitor;
  return cap?.isNativePlatform?.() ? cap.Plugins?.LocalNotifications : undefined;
}

let nativeReady: Promise<boolean> | null = null;

/** Creates the two Android channels once and reports whether notifications are allowed. */
function nativeSetup(plugin: LocalNotificationsPlugin, ask: boolean): Promise<boolean> {
  if (nativeReady && !ask) return nativeReady;
  nativeReady = (async () => {
    try {
      // Importance 5 = heads-up with sound; visibility 1 = shown on the lock screen.
      await plugin.createChannel({ id: CHANNEL.dispatch, name: "New orders", description: "A new taxi order for you", sound: "taxi_dispatch.wav", importance: 5, visibility: 1, vibration: true });
      await plugin.createChannel({ id: CHANNEL.ring, name: "Control center calling", description: "The desk is ringing you", sound: "taxi_ring.wav", importance: 5, visibility: 1, vibration: true });
      const state = ask ? await plugin.requestPermissions() : await plugin.checkPermissions();
      return state.display === "granted";
    } catch {
      return false;
    }
  })();
  return nativeReady;
}

let worker: Promise<ServiceWorkerRegistration | null> | null = null;

function browserWorker() {
  worker ??= (async () => {
    try {
      if (!("serviceWorker" in navigator)) return null;
      await navigator.serviceWorker.register("/notify-sw.js");
      return await navigator.serviceWorker.ready;
    } catch {
      return null;
    }
  })();
  return worker;
}

/** Call from a tap (going online): asks once for permission to show notifications. */
export function enableDriverAlerts() {
  const plugin = native();
  if (plugin) {
    void nativeSetup(plugin, true);
    return;
  }
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    void Notification.requestPermission().then((p) => {
      if (p === "granted") void browserWorker();
    });
  } else if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    void browserWorker();
  }
}

/** Whether this phone will show alerts: true, false (not yet allowed / blocked), or null when unknown. */
export async function alertsAllowed(): Promise<boolean | null> {
  const plugin = native();
  if (plugin) return nativeSetup(plugin, false);
  if (typeof Notification === "undefined") return null;
  return Notification.permission === "granted";
}

const seen = new Set<string>();

function numericId(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  return Math.abs(h) % 2_000_000_000;
}

/** Alerts once per event key (an order id or a ring alert id). */
export async function alertDriver(event: DriverEvent) {
  if (seen.has(event.key)) return;
  seen.add(event.key);
  const plugin = native();
  if (plugin && (await nativeSetup(plugin, false))) {
    // The channel plays its own sound and vibration, also on a locked phone.
    try {
      await plugin.schedule({
        notifications: [
          {
            id: numericId(event.key),
            title: event.title,
            body: event.body,
            channelId: CHANNEL[event.kind],
            sound: event.kind === "ring" ? "taxi_ring.wav" : "taxi_dispatch.wav",
          },
        ],
      });
      return;
    } catch {
      // Fall through to the in-page sound.
    }
  }
  if (document.visibilityState === "visible") {
    void (event.kind === "ring" ? playRing() : playDispatch());
  } else {
    navigator.vibrate?.(event.kind === "ring" ? VIBRATE_RING : VIBRATE_DISPATCH);
  }
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    const reg = await browserWorker();
    const options = {
      body: event.body,
      tag: event.key,
      icon: "/__grok/icon-180.png",
      requireInteraction: event.kind === "ring",
      vibrate: event.kind === "ring" ? VIBRATE_RING : VIBRATE_DISPATCH,
    } as NotificationOptions;
    try {
      if (reg) await reg.showNotification(event.title, options);
      else new Notification(event.title, options);
    } catch {
      /* Notifications are a bonus on top of the sound. */
    }
  }
}

/** The repeat while an order or ring is still waiting on screen (no native notification spam). */
export function replaySound(kind: DriverEvent["kind"]) {
  if (document.visibilityState !== "visible") return;
  void (kind === "ring" ? playRing() : playDispatch());
}
