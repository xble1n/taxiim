import { createFileRoute } from "@tanstack/react-router";

/**
 * Location upload for the installed TAXI IM app's background tracking.
 *
 * The native plugin keeps reporting GPS while the phone is locked, but Android throttles
 * requests made from the WebView after a few minutes in the background, so the app posts
 * here through native HTTP with the driver's session token (`Authorization: Bearer …`).
 * The same checks as the in-app GPS apply (`postLocation`): signed-in driver, online,
 * plausible coordinates and timestamp.
 */
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export const Route = createFileRoute("/api/gps")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { auth } = await import("@/lib/auth/server");
        const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
        if (!session?.user) return json({ success: false, code: "UNAUTHORIZED", message: "Sign in again." }, 401);
        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return json({ success: false, code: "VALIDATION", message: "Body must be JSON." }, 400);
        }
        const lat = num(body.lat);
        const lng = num(body.lng);
        if (lat == null || lng == null) return json({ success: false, code: "VALIDATION", message: "lat and lng are required." }, 400);
        const { postLocation } = await import("@/lib/taxi/handlers.server");
        const res = await postLocation(session.user.id, {
          lat,
          lng,
          accuracyM: num(body.accuracyM),
          speedMps: num(body.speedMps),
          heading: num(body.heading),
          altitudeM: num(body.altitudeM),
          at: num(body.at),
        });
        return json(res, "success" in res && res.success ? 200 : 422);
      },
    },
  },
});
