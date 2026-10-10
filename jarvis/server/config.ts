import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";

/**
 * Runtime configuration. Everything sensitive comes from the environment;
 * nothing secret is ever committed or written to logs.
 */
export interface Config {
  env: "development" | "production" | "test";
  port: number;
  host: string;
  dataDir: string;
  databaseUrl: string | null;
  /** 32-byte key used to encrypt secrets at rest (TOTP seeds). */
  masterKey: Buffer;
  /** One-time token required to create the owner account. */
  setupToken: string;
  anthropicApiKey: string | null;
  llmModel: string;
  llmEffort: "low" | "medium" | "high" | "xhigh" | "max";
  sessionTtlHours: number;
  publicOrigin: string | null;
  schedulerEnabled: boolean;
}

function readOrCreateKeyFile(file: string): Buffer {
  if (existsSync(file)) return Buffer.from(readFileSync(file, "utf8").trim(), "base64");
  const key = randomBytes(32);
  writeFileSync(file, key.toString("base64"), { mode: 0o600 });
  chmodSync(file, 0o600);
  return key;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const env = (process.env.NODE_ENV as Config["env"]) || "development";
  const dataDir = path.resolve(process.env.JARVIS_DATA_DIR || ".data");
  if (!overrides.masterKey) mkdirSync(dataDir, { recursive: true });

  let masterKey: Buffer;
  if (overrides.masterKey) masterKey = overrides.masterKey;
  else if (process.env.JARVIS_MASTER_KEY) {
    masterKey = Buffer.from(process.env.JARVIS_MASTER_KEY, "base64");
  } else if (env === "production") {
    throw new Error("JARVIS_MASTER_KEY is required in production (32 random bytes, base64).");
  } else {
    // Development convenience: a local key file, 0600, ignored by git.
    masterKey = readOrCreateKeyFile(path.join(dataDir, "master.key"));
  }
  if (masterKey.length !== 32) throw new Error("JARVIS_MASTER_KEY must decode to exactly 32 bytes.");

  const effort = (process.env.JARVIS_LLM_EFFORT || "medium") as Config["llmEffort"];
  return {
    env,
    port: Number(process.env.PORT || 8787),
    host: process.env.HOST || "127.0.0.1",
    dataDir,
    databaseUrl: process.env.DATABASE_URL || null,
    masterKey,
    setupToken: process.env.JARVIS_SETUP_TOKEN || randomBytes(18).toString("base64url"),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || null,
    llmModel: process.env.JARVIS_LLM_MODEL || "claude-opus-5-5",
    llmEffort: effort,
    sessionTtlHours: Number(process.env.JARVIS_SESSION_TTL_HOURS || 12),
    publicOrigin: process.env.JARVIS_PUBLIC_ORIGIN || null,
    schedulerEnabled: process.env.JARVIS_SCHEDULER !== "off",
    ...overrides,
  };
}
