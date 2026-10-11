import { spawnSync } from "node:child_process";
try {
  process.loadEnvFile();
} catch {
  /* Local credentials are optional. */
}
const result = spawnSync(
  process.execPath,
  ["node_modules/wrangler/bin/wrangler.js", "dev", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false" },
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
