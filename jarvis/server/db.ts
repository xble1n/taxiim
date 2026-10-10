import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Minimal driver-agnostic database surface (PGlite locally, Postgres in production). */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  driver: "pglite" | "postgres";
}

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");

export async function openDb(opts: { databaseUrl: string | null; dataDir?: string | null }): Promise<Db> {
  if (opts.databaseUrl) return openPostgres(opts.databaseUrl);
  return openPglite(opts.dataDir ? path.join(opts.dataDir, "pglite") : null);
}

async function openPglite(dir: string | null): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = dir ? new PGlite(dir) : new PGlite(); // null => in-memory (tests)
  await pg.waitReady;
  return wrapPglite(pg);
}

/** Wraps an existing PGlite instance (used by tests to clone a migrated template). */
export function wrapPglite(pg: import("@electric-sql/pglite").PGliteInterface): Db {
  // PGlite's tx object exposes the same query/exec surface.
  type Q = { query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[] }>; exec: (s: string) => Promise<unknown> };
  const wrap = (q: Q, inTx: boolean): Db => ({
    driver: "pglite",
    async query<T>(sql: string, params: unknown[] = []) {
      return (await q.query(sql, params)).rows as T[];
    },
    async exec(sql: string) {
      await q.exec(sql);
    },
    async tx<T>(fn: (db: Db) => Promise<T>) {
      if (inTx) return fn(wrap(q, true));
      return pg.transaction((t) => fn(wrap(t as unknown as Q, true)));
    },
    async close() {
      if (!inTx) await pg.close();
    },
  });
  return wrap(pg as unknown as Q, false);
}

async function openPostgres(url: string): Promise<Db> {
  const pgMod = await import("pg");
  const pool = new pgMod.default.Pool({ connectionString: url, max: 10 });
  // Return int8/numeric as JS numbers (cents fit well within 2^53).
  pgMod.default.types.setTypeParser(20, (v: string) => Number(v));
  pgMod.default.types.setTypeParser(1700, (v: string) => Number(v));
  type C = { query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[] }> };
  const wrap = (c: C, inTx: boolean): Db => ({
    driver: "postgres",
    async query<T>(sql: string, params: unknown[] = []) {
      return (await c.query(sql, params)).rows as T[];
    },
    async exec(sql: string) {
      await c.query(sql);
    },
    async tx<T>(fn: (db: Db) => Promise<T>) {
      if (inTx) return fn(wrap(c, true));
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn(wrap(client, true));
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
    async close() {
      if (!inTx) await pool.end();
    },
  });
  return wrap(pool, false);
}

/** Applies migrations/*.sql in lexical order, once each. */
export async function migrate(db: Db): Promise<string[]> {
  await db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
  );
  const done = new Set((await db.query<{ name: string }>("SELECT name FROM schema_migrations")).map((r) => r.name));
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
    await db.tx(async (t) => {
      await t.exec(sql);
      await t.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
    });
    applied.push(f);
  }
  return applied;
}

/** Numeric coercion for aggregate results (drivers differ on int8/numeric). */
export const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
