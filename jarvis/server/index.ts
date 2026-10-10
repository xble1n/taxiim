import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { loadConfig } from "./config.ts";
import { migrate, openDb } from "./db.ts";
import { createApp } from "./app.ts";
import type { AppContext } from "./context.ts";
import { AnthropicProvider } from "./llm/anthropic.ts";
import { UnavailableProvider } from "./llm/provider.ts";
import { setupStatus } from "./auth/owner.ts";
import { registerJobs, startScheduler } from "./scheduler.ts";
import { seedDesignatedDestination } from "./business/crypto.ts";
import { DESIGNATED_WALLET } from "./owner-designations.ts";
import { logEvent } from "./events.ts";

const config = loadConfig();
const db = await openDb({ databaseUrl: config.databaseUrl, dataDir: config.dataDir });
const applied = await migrate(db);
const llm = config.anthropicApiKey
  ? new AnthropicProvider({ apiKey: config.anthropicApiKey, model: config.llmModel, effort: config.llmEffort })
  : new UnavailableProvider("ANTHROPIC_API_KEY is not set. Operator chat and web research are disabled until a key is configured.");
const ctx: AppContext = { db, config, llm, now: () => new Date() };

await seedDesignatedDestination(ctx, DESIGNATED_WALLET);
await registerJobs(ctx);
await logEvent(db, "info", "boot", `JARVIS started (${db.driver}, llm=${llm.name})`, { migrations: applied });

const app = createApp(ctx);
const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web/dist");
if (existsSync(webDist)) {
  app.use("/assets/*", serveStatic({ root: path.relative(process.cwd(), webDist) }));
  app.get("/assets/*", (c) => c.text("Not found", 404)); // never answer a missing asset with HTML
  app.get("/favicon.svg", serveStatic({ path: path.relative(process.cwd(), path.join(webDist, "favicon.svg")) }));
  // Read per request so a rebuilt bundle is picked up without a restart.
  app.get("*", (c) => c.html(readFileSync(path.join(webDist, "index.html"), "utf8")));
}

if (config.schedulerEnabled) startScheduler(ctx);

const status = await setupStatus(ctx);
serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`[jarvis] listening on http://${info.address}:${info.port} (${config.env})`);
  if (!status.setupComplete) {
    // Printed once to the operator console only; never logged to the database.
    console.log(`[jarvis] Owner setup required. One-time setup token: ${config.setupToken}`);
  }
});

const shutdown = async () => {
  await db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
