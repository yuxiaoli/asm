import { describe, it, expect, vi } from "vitest";
import { fixtureSnapshot } from "./fixtures";
import { createWorker, type WorkerEnv } from "./worker";
import { createCatalogQuery } from "./query";
import { buildFeedState, renderRss } from "./feed";
import { validateFeedState, validateSnapshot } from "./types";
import { openApiDocument } from "./openapi";
import { applyFilters } from "../../website-src/src/lib/filter-sort.js";

const env: WorkerEnv = {
  SITE_BASE_URL: "https://example.com/asm/",
  API_BEARER_TOKEN: "fixture-secret",
};
const request = (path: string, authorized = true) =>
  new Request(`https://api.example.com${path}`, {
    headers: authorized ? { Authorization: "Bearer fixture-secret" } : {},
  });

describe("catalog API", () => {
  it("maps numeric website search hits to canonical IDs and matches website sorts", async () => {
    const s = await fixtureSnapshot();
    const query = createCatalogQuery(s);
    expect(
      query.search(new URLSearchParams("q=React")).data.map((x) => x.id),
    ).toEqual([s.skills[0].id]);
    for (const sort of [
      "stars",
      "name",
      "grade",
      "tokens-asc",
      "tokens-desc",
    ]) {
      const browser = applyFilters(s.skills, {
        searchQuery: "",
        activeCategories: new Set(),
        activeRepo: "all",
        sort,
        activeFacets: Object.fromEntries(
          ["license", "grade", "source", "usesTools", "author", "tags"].map(
            (k) => [k, new Set<string>()],
          ),
        ),
      });
      expect(
        query.search(new URLSearchParams({ sort })).data.map((x) => x.id),
      ).toEqual(browser.map((x) => x.id));
    }
  });

  it("applies every facet, category OR, tags AND, token ranges and projection", async () => {
    const s = await fixtureSnapshot(),
      query = createCatalogQuery(s);
    for (const filter of [
      "category=development",
      "repo=alpha/skills",
      "author=alpha",
      "tags=react,testing",
      "license=MIT",
      "grade=A",
      "source=verified",
      "usesTools=yes",
      "verified=true",
      "minTokens=50&maxTokens=150",
    ]) {
      expect(
        query.search(new URLSearchParams(filter)).data.map((x) => x.id),
      ).toEqual([s.skills[0].id]);
    }
    expect(
      query.search(new URLSearchParams("category=development,security")).total,
    ).toBe(2);
    expect(query.search(new URLSearchParams("tags=React,security")).total).toBe(
      0,
    );
    expect(
      query.search(new URLSearchParams("repo=beta/library&grade=A")).total,
    ).toBe(0);
    expect(query.search(new URLSearchParams("fields=name")).data[0]).toEqual({
      id: s.skills[0].id,
      name: "review",
    });
    s.skills[0].tokenCount = undefined;
    expect(
      query.search(new URLSearchParams("minTokens=0&maxTokens=150")).total,
    ).toBe(0);
  });

  it("rejects invalid parameters and binds pagination to snapshot and filters", async () => {
    const s = await fixtureSnapshot(),
      query = createCatalogQuery(s);
    for (const invalid of [
      "agent=codex",
      "fields=content",
      "grade=Z",
      "source=vendor",
      "limit=51",
      "limit=0",
      "minTokens=-1",
      "minTokens=50&maxTokens=10",
      "sort=newest",
      "q=a&q=b",
    ]) {
      expect(() => query.search(new URLSearchParams(invalid))).toThrow();
    }
    const first = query.search(new URLSearchParams("limit=1"));
    const next = new URLSearchParams({ limit: "1", cursor: first.nextCursor! });
    expect(query.search(next).data[0].id).not.toBe(first.data[0].id);
    next.set("q", "security");
    expect(() => query.search(next)).toThrow("Cursor does not match");
    next.delete("q");
    expect(() =>
      createCatalogQuery({ ...s, snapshotId: "new" }).search(next),
    ).toThrow("Registry changed");
    expect(query.get(s.skills[0].id).relPath).toBe("");
    expect(query.get(s.skills[1].id).relPath).toBe("nested");
  });

  it("encodes Unicode cursor queries", async () => {
    const s = await fixtureSnapshot();
    s.skills.forEach((x) => {
      x.name = "中文";
      x.id = `${x.owner}/${x.repo}::${x.relPath}::中文`;
    });
    // Non-search selectors still include Unicode in cursor bindings.
    const q = createCatalogQuery(s),
      params = new URLSearchParams("tags=中文&limit=1");
    s.skills.forEach((x) => {
      x.tags = ["中文"];
    });
    const first = q.search(params);
    params.set("cursor", first.nextCursor!);
    expect(q.search(params).data).toHaveLength(1);
  });

  it("requires Bearer for data but exposes OpenAPI and RSS", async () => {
    const s = await fixtureSnapshot();
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify(s)),
    );
    const worker = createWorker(fetcher);
    expect((await worker.fetch(request("/v1/skills", false), env)).status).toBe(
      401,
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      (await worker.fetch(request("/openapi.json", false), env)).status,
    ).toBe(200);
    expect((await worker.fetch(request("/rss.xml", false), env)).status).toBe(
      200,
    );
    expect(
      (await worker.fetch(request("/v1/skills?limit=51"), env)).status,
    ).toBe(400);
    expect(
      (await worker.fetch(request("/v1/skill?id=absent"), env)).status,
    ).toBe(404);
    const rateLimited = await worker.fetch(request("/v1/skills"), {
      ...env,
      RATE_LIMITER: { limit: async () => ({ success: false }) },
    });
    expect(rateLimited.status).toBe(429);
    expect(rateLimited.headers.get("Retry-After")).toBe("60");
  });

  it("caches validated snapshots and serves marked stale data on refresh failure", async () => {
    const s = await fixtureSnapshot();
    let clock = 0;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(s)))
      .mockRejectedValue(new Error("offline"));
    const worker = createWorker(fetcher, () => clock);
    expect(
      (await (await worker.fetch(request("/v1/skills"), env)).json()).stale,
    ).toBe(false);
    clock = 299999;
    await worker.fetch(request("/v1/skills"), env);
    expect(fetcher).toHaveBeenCalledTimes(1);
    clock = 300001;
    expect(
      (await (await worker.fetch(request("/v1/skills"), env)).json()).stale,
    ).toBe(true);
    const bad = { ...s, feed: { ...s.feed, snapshotId: "mixed" } };
    expect(
      (
        await createWorker(async () => new Response(JSON.stringify(bad))).fetch(
          request("/v1/skills"),
          env,
        )
      ).status,
    ).toBe(503);
    const badSearch = {
      ...s,
      searchIndex: {
        ...(s.searchIndex as object),
        documentIds: { 0: 9, 1: 1 },
      },
    };
    expect(
      (
        await createWorker(
          async () => new Response(JSON.stringify(badSearch)),
        ).fetch(request("/v1/skills"), env)
      ).status,
    ).toBe(503);
  });

  it("reads fixed commits, verifies bytes, and reconstructs escaped Unicode content", async () => {
    const content = "你好 🧠\n" + "\u0000".repeat(32000) + "\nend";
    const s = await fixtureSnapshot(content);
    const fetcher = vi.fn<typeof fetch>(
      async (input) =>
        new Response(
          String(input).includes("api-snapshot") ? JSON.stringify(s) : content,
        ),
    );
    const worker = createWorker(fetcher);
    let offset: number | null = 0,
      reassembled = "";
    while (offset !== null) {
      const response = await worker.fetch(
        request(
          `/v1/skill/content?id=${encodeURIComponent(s.skills[0].id)}&offset=${offset}`,
        ),
        env,
      );
      const raw = await response.text();
      expect(raw.length).toBeLessThanOrEqual(90000);
      const result = JSON.parse(raw);
      expect(response.status).toBe(200);
      reassembled += result.data.content;
      offset = result.data.nextOffset;
    }
    expect(reassembled).toBe(content);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1][0])).toBe(
      `https://raw.githubusercontent.com/alpha/skills/${"a".repeat(40)}/SKILL.md`,
    );
    expect(fetcher.mock.calls[1][1]?.headers).toBeUndefined();
    expect(
      (
        await worker.fetch(
          request(
            `/v1/skill/content?id=${encodeURIComponent(s.skills[0].id)}&contentHash=wrong`,
          ),
          env,
        )
      ).status,
    ).toBe(409);
  });

  it("reports legacy provenance, unavailable upstream and mismatched hash", async () => {
    for (const scenario of ["legacy", "missing", "hash", "timeout"]) {
      const s = await fixtureSnapshot();
      if (scenario === "legacy") delete s.skills[0].sourceCommit;
      const fetcher: typeof fetch = async (input) => {
        if (String(input).includes("api-snapshot"))
          return new Response(JSON.stringify(s));
        if (scenario === "timeout")
          throw new DOMException("timeout", "TimeoutError");
        return new Response("wrong", {
          status: scenario === "missing" ? 404 : 200,
        });
      };
      const response = await createWorker(fetcher).fetch(
        request(`/v1/skill/content?id=${encodeURIComponent(s.skills[0].id)}`),
        env,
      );
      expect(response.status).toBe(scenario === "legacy" ? 409 : 502);
      expect((await response.json()).error.code).toBe(
        scenario === "legacy"
          ? "PROVENANCE_MISSING"
          : scenario === "hash"
            ? "CONTENT_HASH_MISMATCH"
            : "SOURCE_UNAVAILABLE",
      );
    }
  });
});

describe("published feed history", () => {
  it("bootstraps without events and preserves events across irrelevant rebuilds", async () => {
    const s = await fixtureSnapshot();
    expect(s.feed.events).toHaveLength(0);
    const next = {
      snapshotId: "b",
      sourceRevision: "b".repeat(40),
      generatedAt: "2026-10-12T00:00:00Z",
    };
    const skills = s.skills.map((x) => ({
      ...x,
      stars: 9999,
      sourceCommit: "d".repeat(40),
      indexedAt: next.generatedAt,
      evalSummary: { grade: "A", overallScore: 99 },
    }));
    expect((await buildFeedState(skills, next, s.feed)).events).toHaveLength(0);
    skills[0].contentHash = "b".repeat(64);
    const changed = await buildFeedState(skills, next, s.feed);
    expect(changed.events[0].type).toBe("updated");
    const rebuilt = await buildFeedState(
      skills,
      { ...next, snapshotId: "c" },
      changed,
    );
    expect(rebuilt.events).toEqual(changed.events);
    expect(s.feed.events).toHaveLength(0); // candidate builds never mutate their baseline
  });

  it("tracks additions, XML escaping, historical filters, and content cycles", async () => {
    const s = await fixtureSnapshot();
    const ctx = {
      snapshotId: "next",
      sourceRevision: "b".repeat(40),
      generatedAt: "2026-10-12T00:00:00Z",
    };
    const added = {
      ...s.skills[0],
      id: "new/skills::::<skill>",
      owner: "new",
      name: "<skill>",
      description: "A&B <C>\u0001🧠",
      tags: ["React"],
    };
    const state = await buildFeedState([...s.skills, added], ctx, s.feed);
    expect(state.events[0].type).toBe("added");
    const xml = renderRss(
      state,
      s.siteUrl,
      "https://api.example.com/rss.xml?repo=new%2Fskills&tags=React",
      new URLSearchParams("repo=new/skills&tags=react&event=added"),
    );
    expect(xml).toContain("A&amp;B &lt;C&gt;");
    expect(xml).toContain("\uFFFD🧠");
    expect(xml).not.toContain("\u0001");
    expect(xml).toContain("&lt;skill&gt;");
    expect(xml.match(/<item>/g)).toHaveLength(1);
    expect(() =>
      renderRss(state, s.siteUrl, "x", new URLSearchParams("event=removed")),
    ).toThrow();
    const updatedSkills = s.skills.map((x) => ({
      ...x,
      contentHash: "f".repeat(64),
    }));
    const b = await buildFeedState(updatedSkills, ctx, s.feed);
    const a = await buildFeedState(
      s.skills,
      { ...ctx, snapshotId: "again", generatedAt: "2026-10-13T00:00:00Z" },
      b,
    );
    const bb = await buildFeedState(
      updatedSkills,
      { ...ctx, snapshotId: "again-b", generatedAt: "2026-10-14T00:00:00Z" },
      a,
    );
    expect(new Set(bb.events.map((x) => x.id)).size).toBe(6);
    const removed = await buildFeedState(
      [],
      { ...ctx, snapshotId: "removed" },
      state,
    );
    expect(removed.events).toEqual(state.events);
    expect(removed.known[added.id].present).toBe(false);
  });

  it("fails closed for corrupt or mixed publication state and marks Actions read-only", async () => {
    const s = await fixtureSnapshot();
    expect(() =>
      validateFeedState({ ...s.feed, known: { bad: {} } }),
    ).toThrow();
    expect(() =>
      validateSnapshot({
        ...s,
        searchIndex: { ...(s.searchIndex as object), snapshotId: "bad" },
      }),
    ).toThrow();
    const schema = openApiDocument("https://api.example.com/");
    expect(schema.openapi).toBe("3.1.0");
    for (const operation of Object.values(schema.paths)) {
      expect(operation.get["x-openai-isConsequential"]).toBe(false);
      expect(operation.get.security).toEqual([{ bearerAuth: [] }]);
      expect(operation.get.description.length).toBeLessThanOrEqual(300);
    }
  });
});
