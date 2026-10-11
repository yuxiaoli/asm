import { execFileSync, spawnSync } from "node:child_process";

// Wrangler reads its Cloudflare credentials from the inherited environment.
try {
  process.loadEnvFile();
} catch {
  /* CI uses repository secrets. */
}
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const repository =
  process.env.GITHUB_REPOSITORY ||
  execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" })
    .trim()
    .replace(/^.*github\.com[:/]/, "")
    .replace(/\.git$/, "");
let site = process.env.ASM_SITE_BASE_URL;
if (!site) {
  const response = await fetch(
    `https://api.github.com/repos/${repository}/pages`,
    {
      headers: {
        "User-Agent": "asm-api-deploy",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok)
    throw new Error("Set ASM_SITE_BASE_URL to the actual Pages URL");
  site = ((await response.json()) as { html_url: string }).html_url;
}
const result = spawnSync(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "deploy",
    "--var",
    `SITE_BASE_URL:${site}`,
  ],
  { stdio: "inherit", env: process.env },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
