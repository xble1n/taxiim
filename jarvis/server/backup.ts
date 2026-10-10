import type { AppContext } from "./context.ts";

/**
 * Logical export of business data. Excludes credentials: owner password hash,
 * TOTP secret and session tokens are never exported.
 */
const TABLES = [
  "settings", "standing_authorizations", "approvals", "memories", "documents", "document_chunks", "research_reports",
  "conversations", "chat_messages", "projects", "tasks", "opportunities", "leads", "lead_activities", "drafts", "invoices",
  "transactions", "monthly_cycles", "crypto_destinations", "jobs", "notifications", "audit_log",
];

export async function exportAll(ctx: AppContext) {
  const data: Record<string, unknown[]> = {};
  for (const t of TABLES) {
    const rows = await ctx.db.query<Record<string, unknown>>(`SELECT * FROM ${t} ORDER BY 1`);
    data[t] = rows.map(({ tsv: _tsv, ...rest }) => rest);
  }
  return { format: "jarvis-backup/1", exported_at: ctx.now().toISOString(), tables: data };
}
