import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const destDir = join(root, ".vercel/output/functions/__server.func/_libs");
if (!existsSync(destDir)) process.exit(0);

const srcDir = join(root, "node_modules/@electric-sql/pglite/dist");
for (const name of ["pglite.data", "pglite.wasm", "initdb.wasm"]) {
  const from = join(srcDir, name);
  if (!existsSync(from)) continue;
  copyFileSync(from, join(destDir, name));
}
