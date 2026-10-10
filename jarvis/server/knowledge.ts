import { z } from "zod";
import { audit, type Actor } from "./audit.ts";
import { HttpError, type AppContext } from "./context.ts";
import { detectSecret } from "./security/redact.ts";

/**
 * Knowledge base: targeted ingestion + Postgres full-text retrieval (RAG).
 * Every document keeps its source URL and retrieval timestamp so answers can cite it.
 * Semantic (vector) retrieval is a planned upgrade — see docs/ARCHITECTURE.md.
 */
const CHUNK = 1800;
const OVERLAP = 200;
const MAX_FETCH_BYTES = 3_000_000;

export function chunkText(text: string): string[] {
  const clean = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= CHUNK) return clean ? [clean] : [];
  const out: string[] = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(clean.length, i + CHUNK);
    if (end < clean.length) {
      const br = clean.lastIndexOf("\n", end);
      const sp = clean.lastIndexOf(". ", end);
      const cut = Math.max(br, sp);
      if (cut > i + CHUNK / 2) end = cut + 1;
    }
    out.push(clean.slice(i, end).trim());
    if (end >= clean.length) break;
    i = Math.max(end - OVERLAP, i + 1);
  }
  return out;
}

export function htmlToText(html: string): { title: string; text: string; published: string | null } {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const published =
    html.match(/<meta[^>]+(?:property|name)=["'](?:article:published_time|date|pubdate|og:published_time)["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? null;
  const text = html
    .replace(/<(script|style|noscript|svg|nav|footer|header|form)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|br|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return { title: decodeEntities(title), text, published };
}
const decodeEntities = (s: string) => s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');

export const NoteInput = z.object({
  title: z.string().min(2).max(300),
  content: z.string().min(1).max(500_000),
  source_url: z.string().url().nullable().optional(),
  source_type: z.enum(["note", "research", "file", "url"]).default("note"),
  license_note: z.string().max(500).nullable().optional(),
});

export async function addDocument(ctx: AppContext, raw: z.input<typeof NoteInput> & { published_at?: string | null }, actor: Actor) {
  const v = NoteInput.parse(raw);
  const secret = detectSecret(v.content);
  if (secret) throw new HttpError(400, "secret_refused", `Refusing to index content containing a ${secret}.`);
  const chunks = chunkText(v.content);
  if (!chunks.length) throw new HttpError(400, "empty", "No indexable text.");
  const published = raw.published_at && !Number.isNaN(Date.parse(raw.published_at)) ? new Date(raw.published_at) : null;
  return ctx.db.tx(async (t) => {
    const [doc] = await t.query<{ id: number }>(
      `INSERT INTO documents (title, source_url, source_type, published_at, license_note, content_chars, retrieved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [v.title, v.source_url ?? null, v.source_type, published, v.license_note ?? null, v.content.length, ctx.now()]);
    for (let i = 0; i < chunks.length; i++) {
      await t.query("INSERT INTO document_chunks (document_id, idx, content) VALUES ($1,$2,$3)", [doc.id, i, chunks[i]]);
    }
    await audit(t, { actor, action: "knowledge.add", category: "data", target: `doc:${doc.id}`, outcome: "success", detail: { chunks: chunks.length, source: v.source_url ?? v.source_type } });
    return { id: doc.id, chunks: chunks.length };
  });
}

/** Blocks SSRF to private/internal networks when JARVIS fetches URLs. */
export function assertPublicUrl(u: URL) {
  if (!["http:", "https:"].includes(u.protocol)) throw new HttpError(400, "bad_url", "Only http(s) URLs can be ingested.");
  const h = u.hostname.toLowerCase();
  if (
    h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h === "metadata.google.internal" ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === "[::1]" || /^\[?f[cd]/.test(h)
  ) {
    throw new HttpError(400, "bad_url", "Private or internal addresses cannot be ingested.");
  }
}

export async function ingestUrl(ctx: AppContext, url: string, actor: Actor, fetchImpl: typeof fetch = fetch) {
  const u = new URL(url);
  assertPublicUrl(u);
  const res = await fetchImpl(u, { headers: { "user-agent": "JARVIS-research/0.1 (+owner-operated)" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new HttpError(502, "fetch_failed", `Fetch failed: HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (!/text\/html|text\/plain|application\/xhtml/.test(type)) throw new HttpError(415, "unsupported", `Unsupported content type: ${type}`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_FETCH_BYTES) throw new HttpError(413, "too_large", "Document too large.");
  const body = new TextDecoder().decode(buf);
  const parsed = type.includes("html") ? htmlToText(body) : { title: u.hostname + u.pathname, text: body, published: null };
  return addDocument(ctx, {
    title: parsed.title || u.hostname, content: parsed.text, source_url: u.toString(), source_type: "url", published_at: parsed.published,
    license_note: "Fetched for private research use; check the source's terms before republishing.",
  }, actor);
}

export async function searchKnowledge(ctx: AppContext, q: string, limit = 8) {
  if (!q.trim()) return [];
  return ctx.db.query<{ document_id: number; title: string; source_url: string | null; retrieved_at: Date; snippet: string; rank: number }>(
    `SELECT c.document_id, d.title, d.source_url, d.retrieved_at, d.published_at,
            ts_headline('simple', c.content, websearch_to_tsquery('simple', $1), 'MaxWords=60, MinWords=25') AS snippet,
            ts_rank(c.tsv, websearch_to_tsquery('simple', $1)) AS rank
     FROM document_chunks c JOIN documents d ON d.id = c.document_id
     WHERE c.tsv @@ websearch_to_tsquery('simple', $1)
     ORDER BY rank DESC LIMIT $2`, [q, limit]);
}

export async function listDocuments(ctx: AppContext) {
  return ctx.db.query("SELECT * FROM documents ORDER BY created_at DESC LIMIT 300");
}

export async function deleteDocument(ctx: AppContext, id: number) {
  await ctx.db.query("DELETE FROM documents WHERE id = $1", [id]);
  await audit(ctx.db, { actor: "owner", action: "knowledge.delete", category: "data", target: `doc:${id}`, outcome: "success" });
}
