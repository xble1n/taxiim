import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import { prepareSignIn } from "@/lib/taxi/handlers.server";

async function handle(request: Request) {
  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname.includes("sign-in/email")) {
    try {
      await prepareSignIn();
    } catch (err) {
      console.error("[taxi] sign-in setup", err instanceof Error ? err.message : err);
    }
  }
  return auth.handler(request);
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(request),
      POST: ({ request }) => handle(request),
    },
  },
});
