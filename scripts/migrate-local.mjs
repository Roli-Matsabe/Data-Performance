// Apply pending migrations to local development storage only.
import "./sites-env.mjs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { projectRoot } from "./sites-env.mjs";

const builtConfig = path.join(projectRoot, "dist/server/wrangler.json");
let config;
try {
  config = JSON.parse(readFileSync(builtConfig, "utf8"));
} catch (error) {
  if (error.code === "ENOENT") {
    throw new Error("Run npm run build before migrating the local database.");
  }
  throw error;
}
const database = config.d1_databases?.find((binding) => binding.binding === "DB");
if (!database) throw new Error("The built worker has no DB binding.");

const runtimeDirectory = path.join(projectRoot, ".sites-runtime");
mkdirSync(runtimeDirectory, { recursive: true });
const migrationConfig = path.join(runtimeDirectory, "d1-migrations.json");
writeFileSync(migrationConfig, JSON.stringify({
  name: config.name,
  compatibility_date: config.compatibility_date,
  d1_databases: [{ ...database, migrations_dir: path.join(projectRoot, "drizzle") }],
}, null, 2) + "\n");

const result = spawnSync(process.execPath, [
  path.join(projectRoot, "node_modules/wrangler/bin/wrangler.js"),
  "d1", "migrations", "apply", "DB", "--local",
  "--config", migrationConfig,
  "--persist-to", path.join(projectRoot, ".wrangler/state"),
], { cwd: projectRoot, stdio: ["ignore", "inherit", "inherit"] });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
