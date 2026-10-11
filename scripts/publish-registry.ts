import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { validateFeedState, type FeedState } from "../src/api/types";
import { publicationBaseline } from "../src/api/publication";

const mode = process.argv[2];
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const sourceRevision = process.env.GITHUB_SHA;
if (!repository || !token || !sourceRevision)
  throw new Error(
    "Publication requires GitHub repository, source revision and token",
  );

async function github(path: string): Promise<any> {
  const response = await fetch(
    `https://api.github.com/repos/${repository}/${path}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "asm-registry-publication",
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok)
    throw new Error(
      `GitHub publication metadata unavailable (${response.status})`,
    );
  return response.json();
}
async function publishedState(site: string): Promise<FeedState | undefined> {
  const response = await fetch(
    new URL(`feed-state.json?publication=${Date.now()}`, site),
    { cache: "no-store", signal: AbortSignal.timeout(15_000) },
  );
  if (response.status === 404) return undefined;
  if (!response.ok)
    throw new Error(`Published feed baseline unavailable (${response.status})`);
  const value: unknown = await response.json();
  validateFeedState(value);
  return value;
}
async function environment(values: Record<string, string>) {
  if (!process.env.GITHUB_ENV) throw new Error("GITHUB_ENV is required");
  await appendFile(
    process.env.GITHUB_ENV,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
  );
}

if (mode === "prepare") {
  const pages = await github("pages");
  const site = String(pages.html_url).replace(/\/?$/, "/");
  const previous = await publishedState(site);
  const deployments = await github(
    "deployments?environment=github-pages&per_page=100",
  );
  let latest: { sha: string } | undefined;
  for (const deployment of deployments) {
    const statuses = await github(
      `deployments/${deployment.id}/statuses?per_page=1`,
    );
    if (statuses[0]?.state === "success") {
      latest = deployment;
      break;
    }
  }
  let isDescendant = true;
  let featureAlreadyPublished = false;
  if (latest) {
    try {
      execFileSync(
        "git",
        ["merge-base", "--is-ancestor", latest.sha, sourceRevision],
        { stdio: "pipe" },
      );
    } catch {
      isDescendant = false;
    }
    try {
      execFileSync("git", ["cat-file", "-e", `${latest.sha}:src/api/feed.ts`], {
        stdio: "pipe",
      });
      featureAlreadyPublished = true;
    } catch {
      /* The first release predates the feed implementation. */
    }
  }
  publicationBaseline({
    previous,
    latestRevision: latest?.sha,
    isDescendant,
    bootstrap: process.env.ASM_FEED_BOOTSTRAP === "1",
    featureAlreadyPublished,
  });
  const values: Record<string, string> = {
    ASM_SITE_BASE_URL: site,
    ASM_PRODUCTION: "1",
  };
  if (!previous) {
    values.ASM_FEED_BOOTSTRAP = "1";
  } else {
    await mkdir(process.env.RUNNER_TEMP || ".cache", { recursive: true });
    const file = join(
      process.env.RUNNER_TEMP || ".cache",
      "asm-feed-baseline.json",
    );
    await writeFile(file, JSON.stringify(previous));
    values.ASM_FEED_STATE_FILE = file;
  }
  await environment(values);
  console.log("Validated production baseline and Pages origin");
} else if (mode === "verify") {
  const expected: { snapshotId: string; sourceRevision: string } = process.env
    .ASM_EXPECTED_SNAPSHOT_ID
    ? {
        snapshotId: process.env.ASM_EXPECTED_SNAPSHOT_ID,
        sourceRevision: process.env.ASM_EXPECTED_SOURCE_REVISION || "",
      }
    : JSON.parse(
        await readFile(
          process.env.ASM_EXPECTED_FEED_STATE_FILE || "website/feed-state.json",
          "utf8",
        ),
      );
  if (!expected.snapshotId || !expected.sourceRevision)
    throw new Error("Expected publication identity is required");
  const pages = await github("pages");
  for (let attempt = 0; attempt < 24; attempt++) {
    try {
      const state = await publishedState(
        String(pages.html_url).replace(/\/?$/, "/"),
      );
      if (
        state?.snapshotId === expected.snapshotId &&
        state.sourceRevision === expected.sourceRevision
      ) {
        const site = String(pages.html_url).replace(/\/?$/, "/");
        for (const file of [
          "api-snapshot.json",
          "skills.min.json",
          "search.idx.json",
        ]) {
          const response = await fetch(
            new URL(`${file}?publication=${Date.now()}`, site),
            { cache: "no-store", signal: AbortSignal.timeout(15_000) },
          );
          if (!response.ok)
            throw new Error("Published snapshot resource unavailable");
          const document = (await response.json()) as { snapshotId?: string };
          if (document.snapshotId !== expected.snapshotId)
            throw new Error("Published resources mix different snapshots");
        }
        console.log(`Verified published registry snapshot ${state.snapshotId}`);
        process.exit(0);
      }
    } catch {
      /* CDN propagation may briefly serve old or incomplete resources. */
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(
    "Pages deployment did not expose the expected feed snapshot; do not advance baseline",
  );
} else throw new Error("Use prepare or verify");
