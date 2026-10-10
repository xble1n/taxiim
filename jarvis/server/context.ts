import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import type { LlmProvider } from "./llm/provider.ts";

/** Dependencies shared by every module. Constructed once in app.ts. */
export interface AppContext {
  db: Db;
  config: Config;
  llm: LlmProvider;
  /** Injectable clock for tests. */
  now: () => Date;
}

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
