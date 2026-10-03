import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const workerSource = readFileSync(fileURLToPath(new URL("../../public/service-worker.js", import.meta.url)), "utf8");
function harness(scope = "https://yuxiaoli.github.io/asm/") {
  const listeners = {};
  const cache = { addAll: vi.fn().mockResolvedValue(undefined), put: vi.fn().mockResolvedValue(undefined) };
  const caches = { open: vi.fn().mockResolvedValue(cache), keys: vi.fn().mockResolvedValue([]), delete: vi.fn().mockResolvedValue(true), match: vi.fn().mockResolvedValue(undefined) };
  const response = { ok: true, clone: vi.fn(() => ({})) };
  const fetch = vi.fn().mockResolvedValue(response);
  vm.runInNewContext(workerSource, { URL, caches, fetch, self: { registration: { scope }, addEventListener: (name, fn) => { listeners[name] = fn; }, skipWaiting: vi.fn(), clients: { claim: vi.fn() } } });
  return { listeners, cache, caches, fetch, response };
}

describe("GitHub Pages service worker", () => {
  it.each(["https://yuxiaoli.github.io/asm/", "https://example.com/"])("caches data under its actual scope %s", async (scope) => {
    const h = harness(scope);
    let work;
    h.listeners.install({ waitUntil: (p) => { work = p; } });
    await work;
    expect(h.cache.addAll).toHaveBeenCalledWith([scope + "skills.min.json", scope + "search.idx.json"]);
  });
  it("never deletes sibling projects' caches", async () => {
    const h = harness();
    h.caches.keys.mockResolvedValue(["md-cache", "asm-catalog:https://example.com/:v1", "asm-catalog:https://yuxiaoli.github.io/asm/:v1", "asm-catalog:https://yuxiaoli.github.io/asm/:v2"]);
    let work;
    h.listeners.activate({ waitUntil: (p) => { work = p; } });
    await work;
    expect(h.caches.delete.mock.calls).toEqual([["asm-catalog:https://yuxiaoli.github.io/asm/:v1"]]);
  });
  it("fetches fresh HTML rather than pinning an old deployment", async () => {
    const h = harness();
    h.caches.match.mockResolvedValue({ stale: true });
    const request = { url: "https://yuxiaoli.github.io/asm/", mode: "navigate" };
    let result;
    h.listeners.fetch({ request, respondWith: (p) => { result = p; } });
    expect(await result).toBe(h.response);
    expect(h.fetch).toHaveBeenCalledWith(request);
  });
  it("serves cached HTML when offline", async () => {
    const h = harness();
    const cached = { offline: true };
    h.fetch.mockRejectedValue(new Error("offline"));
    h.caches.match.mockResolvedValue(cached);
    let result;
    h.listeners.fetch({ request: { url: "https://yuxiaoli.github.io/asm/", mode: "navigate" }, respondWith: (p) => { result = p; } });
    expect(await result).toBe(cached);
  });
  it("registers relative to Vite's base instead of the origin root", async () => {
    const source = readFileSync(fileURLToPath(new URL("../main.jsx", import.meta.url)), "utf8");
    const block = source.slice(source.indexOf('// Register service worker')).replaceAll('import.meta.env.BASE_URL', JSON.stringify('./'));
    let load;
    const register = vi.fn().mockResolvedValue({ scope: "https://yuxiaoli.github.io/asm/" });
    vm.runInNewContext(block, { window: { addEventListener: (_, fn) => { load = fn; } }, navigator: { serviceWorker: { register } }, console: { log: vi.fn(), error: vi.fn() } });
    load();
    expect(register).toHaveBeenCalledWith("./service-worker.js");
    expect(new URL(register.mock.calls[0][0], "https://yuxiaoli.github.io/asm/#/skills").href).toBe("https://yuxiaoli.github.io/asm/service-worker.js");
  });
});
