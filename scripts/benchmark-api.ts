import { readFile } from "node:fs/promises";
import { createWorker, type WorkerEnv } from "../src/api/worker";

// Node measurements are a repeatable local estimate; remote CPU is measured separately.
const serialized = await readFile(
  process.env.ASM_SNAPSHOT_FILE || "website/api-snapshot.json",
  "utf8",
);
const baseline = process.memoryUsage().heapUsed;
const env: WorkerEnv = {
  SITE_BASE_URL: "https://fixture.invalid/",
  API_BEARER_TOKEN: "benchmark-only",
};
const worker = createWorker(async () => new Response(serialized));
async function measure(path: string) {
  const cpu = process.cpuUsage(),
    started = performance.now();
  const response = await worker.fetch(
    new Request(`https://fixture.invalid${path}`, {
      headers: { Authorization: "Bearer benchmark-only" },
    }),
    env,
  );
  const body = await response.text();
  const used = process.cpuUsage(cpu);
  if (!response.ok)
    throw new Error(
      `Benchmark ${path}: ${response.status} ${body.slice(0, 300)}`,
    );
  const wallMs = +(performance.now() - started).toFixed(2);
  const heapMiB = +(
    (process.memoryUsage().heapUsed - baseline) /
    1024 /
    1024
  ).toFixed(2);
  global.gc?.();
  return {
    path,
    wallMs,
    cpuMs: +((used.user + used.system) / 1000).toFixed(2),
    responseCharacters: body.length,
    heapMiB,
    retainedHeapMiB: global.gc
      ? +((process.memoryUsage().heapUsed - baseline) / 1024 / 1024).toFixed(2)
      : null,
  };
}
const measurements = [];
for (const path of [
  "/v1/skills",
  "/v1/skills?q=react",
  "/v1/skills?q=react",
  "/v1/skills?q=security&grade=A&usesTools=yes",
  "/v1/registry",
])
  measurements.push(await measure(path));
console.log(
  JSON.stringify(
    {
      runtime: process.version,
      snapshotBytes: Buffer.byteLength(serialized),
      measurements,
    },
    null,
    2,
  ),
);
