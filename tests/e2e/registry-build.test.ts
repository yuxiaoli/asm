import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { validateSnapshot } from "../../src/api/types";

const execute = promisify(execFile);
let output: string;
afterEach(async () => {
  if (output) await rm(output, { recursive: true, force: true });
});
describe("catalog publication artifacts", () => {
  it("generates a coherent snapshot and preview baseline entirely in a temp directory", async () => {
    output = await mkdtemp(join(tmpdir(), "asm-registry-build-"));
    const env = {
      ...process.env,
      GITHUB_SHA: "c".repeat(40),
      ASM_WEBSITE_OUTPUT_DIR: output,
      ASM_SKIP_STAR_FETCH: "1",
      ASM_SITE_BASE_URL: "https://example.test/asm/",
      ASM_API_BASE_URL: "https://api.example.test",
      ASM_PRODUCTION: "",
      ASM_FEED_STATE_FILE: "",
      ASM_FEED_BOOTSTRAP: "",
    };
    const args = [
      resolve("node_modules/tsx/dist/cli.mjs"),
      resolve("scripts/build-catalog.ts"),
    ];
    await execute(process.execPath, args, {
      env,
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const snapshot = JSON.parse(
      await readFile(join(output, "api-snapshot.json"), "utf8"),
    );
    validateSnapshot(snapshot);
    expect(snapshot.skills.length).toBeGreaterThan(1000);
    expect(snapshot.feed.events).toEqual([]);
    for (const file of [
      "catalog.json",
      "skills.min.json",
      "search.idx.json",
      "feed-state.json",
    ]) {
      expect(
        JSON.parse(await readFile(join(output, file), "utf8")).snapshotId,
      ).toBe(snapshot.snapshotId);
    }
    expect(await readFile(join(output, "rss.xml"), "utf8")).not.toContain(
      "<item>",
    );
    expect(await readFile(join(output, "llms.txt"), "utf8")).toContain(
      "https://api.example.test/openapi.json",
    );
    const baseline = join(output, "previous-feed.json");
    await writeFile(baseline, await readFile(join(output, "feed-state.json"), "utf8"));
    await execute(process.execPath, args, {
      env: { ...env, ASM_FEED_STATE_FILE: baseline },
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const rebuilt = JSON.parse(
      await readFile(join(output, "feed-state.json"), "utf8"),
    );
    expect(rebuilt.events).toEqual([]);
    expect(rebuilt.snapshotId).not.toBe(snapshot.snapshotId);
    await writeFile(baseline, '{"schemaVersion":1}');
    await expect(
      execute(process.execPath, args, {
        env: { ...env, ASM_FEED_STATE_FILE: baseline },
        timeout: 30_000,
        maxBuffer: 2 * 1024 * 1024,
      }),
    ).rejects.toThrow();
  });
});
