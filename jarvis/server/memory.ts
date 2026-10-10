import { z } from "zod";
import { audit, type Actor } from "./audit.ts";
import { HttpError, type AppContext } from "./context.ts";
import { detectSecret } from "./security/redact.ts";

export const MEMORY_KINDS = ["preference", "decision", "project", "config", "lesson", "fact", "business"] as const;

export const MemoryInput = z.object({
  kind: z.enum(MEMORY_KINDS),
  content: z.string().min(3).max(4000),
  tags: z.array(z.string().max(40)).max(12).default([]),
  pinned: z.boolean().default(false),
});

function guard(content: string) {
  const s = detectSecret(content);
  if (s) throw new HttpError(400, "secret_refused", `Refusing to store memory: it appears to contain a ${s}. Store secrets in the environment, not in memory.`);
}

export async function addMemory(ctx: AppContext, raw: z.input<typeof MemoryInput>, actor: Actor) {
  const v = MemoryInput.parse(raw);
  guard(v.content);
  const [row] = await ctx.db.query<{ id: number }>(
    "INSERT INTO memories (kind, content, tags, source, pinned) VALUES ($1,$2,$3,$4,$5) RETURNING id",
    [v.kind, v.content, v.tags, actor, v.pinned]);
  await audit(ctx.db, { actor, action: "memory.add", category: "data", target: `mem:${row.id}`, outcome: "success", detail: { kind: v.kind } });
  return row;
}

export async function updateMemory(ctx: AppContext, id: number, raw: Partial<z.input<typeof MemoryInput>>) {
  const v = MemoryInput.partial().parse(raw);
  if (v.content) guard(v.content);
  const [cur] = await ctx.db.query<{ id: number }>("SELECT id FROM memories WHERE id = $1", [id]);
  if (!cur) throw new HttpError(404, "not_found", "Memory not found.");
  await ctx.db.query(
    `UPDATE memories SET kind = COALESCE($2, kind), content = COALESCE($3, content), tags = COALESCE($4, tags),
       pinned = COALESCE($5, pinned), updated_at = now() WHERE id = $1`,
    [id, v.kind ?? null, v.content ?? null, v.tags ?? null, v.pinned ?? null]);
  await audit(ctx.db, { actor: "owner", action: "memory.update", category: "data", target: `mem:${id}`, outcome: "success" });
}

export async function deleteMemory(ctx: AppContext, id: number) {
  await ctx.db.query("DELETE FROM memories WHERE id = $1", [id]);
  await audit(ctx.db, { actor: "owner", action: "memory.delete", category: "data", target: `mem:${id}`, outcome: "success" });
}

export async function deleteAllMemories(ctx: AppContext) {
  const r = await ctx.db.query("DELETE FROM memories RETURNING id");
  await audit(ctx.db, { actor: "owner", action: "memory.delete_all", category: "data", outcome: "success", detail: { count: r.length } });
  return r.length;
}

export async function searchMemories(ctx: AppContext, q: string | undefined, limit = 50) {
  if (!q?.trim()) return ctx.db.query("SELECT id, kind, content, tags, source, pinned, created_at, updated_at FROM memories ORDER BY pinned DESC, updated_at DESC LIMIT $1", [limit]);
  return ctx.db.query(
    `SELECT id, kind, content, tags, source, pinned, created_at, updated_at,
            ts_rank(tsv, websearch_to_tsquery('simple', $1)) AS rank
     FROM memories
     WHERE tsv @@ websearch_to_tsquery('simple', $1) OR content ILIKE '%' || $1 || '%'
     ORDER BY pinned DESC, rank DESC, updated_at DESC LIMIT $2`, [q, limit]);
}

export async function exportMemories(ctx: AppContext) {
  const rows = await ctx.db.query("SELECT id, kind, content, tags, source, pinned, created_at, updated_at FROM memories ORDER BY id");
  await audit(ctx.db, { actor: "owner", action: "memory.export", category: "data", outcome: "success", detail: { count: rows.length } });
  return { exported_at: ctx.now().toISOString(), count: rows.length, memories: rows };
}

/** Pinned + most recent memories injected into the agent's context. */
export async function contextMemories(ctx: AppContext, limit = 25) {
  return ctx.db.query<{ id: number; kind: string; content: string }>(
    "SELECT id, kind, content FROM memories ORDER BY pinned DESC, updated_at DESC LIMIT $1", [limit]);
}
