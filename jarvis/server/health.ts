import type { AppContext } from "./context.ts";
import { verifyAuditChain } from "./audit.ts";
import { monthLlmSpend } from "./agent/orchestrator.ts";
import { getSettings } from "./settings.ts";

export interface IntegrationStatus { name: string; status: "ok" | "degraded" | "not_configured" | "error"; detail: string; required_for: string }

/** Honest integration report: nothing is shown as connected unless it is. */
export async function integrationHealth(ctx: AppContext): Promise<IntegrationStatus[]> {
  const out: IntegrationStatus[] = [];
  try {
    await ctx.db.query("SELECT 1");
    out.push({ name: "Database", status: "ok", detail: ctx.db.driver === "postgres" ? "PostgreSQL (DATABASE_URL)" : "Embedded PGlite (local file)", required_for: "everything" });
  } catch (e) {
    out.push({ name: "Database", status: "error", detail: String(e), required_for: "everything" });
  }
  const settings = await getSettings(ctx.db);
  if (ctx.llm.available()) {
    const spent = await monthLlmSpend(ctx);
    out.push({ name: "Language model", status: spent >= settings.llm_monthly_budget_usd ? "degraded" : "ok", detail: `${ctx.llm.name} · ${ctx.llm.model} · $${spent.toFixed(2)} / $${settings.llm_monthly_budget_usd} this month`, required_for: "operator chat, research" });
    out.push({ name: "Web search", status: "ok", detail: "Provider-hosted web search (Anthropic web_search tool)", required_for: "live research" });
  } else {
    out.push({ name: "Language model", status: "not_configured", detail: ctx.llm.unavailableReason() ?? "", required_for: "operator chat, research" });
    out.push({ name: "Web search", status: "not_configured", detail: "Requires the language-model provider", required_for: "live research" });
  }
  out.push({ name: "URL ingestion", status: "ok", detail: "Direct HTTPS fetch with SSRF guard", required_for: "knowledge base" });
  out.push({ name: "Email (outbound)", status: "not_configured", detail: "No SMTP/provider integration yet; approved drafts are sent manually", required_for: "automated outreach" });
  out.push({ name: "Payments processor", status: "not_configured", detail: "No Stripe/bank feed; payments are entered and verified by the owner", required_for: "automatic revenue import" });
  const [dest] = await ctx.db.query<{ n: unknown }>("SELECT COUNT(*) AS n FROM crypto_destinations WHERE status = 'verified'");
  out.push({ name: "Crypto destination", status: Number(dest.n) > 0 ? "ok" : "not_configured", detail: Number(dest.n) > 0 ? `${dest.n} verified destination(s)` : "Designated address present but network/asset not verified", required_for: "crypto payouts" });
  const chain = await verifyAuditChain(ctx.db);
  out.push({ name: "Audit log integrity", status: chain.ok ? "ok" : "error", detail: chain.ok ? `${chain.entries} entries, hash chain intact` : `Broken at entry ${chain.brokenAt}`, required_for: "security" });
  return out;
}
