import {
  ApiError,
  sha256,
  validateSnapshot,
  type ApiSnapshot,
  type ApiSkill,
} from "./types";
import {
  assertParameters,
  createCatalogQuery,
  fieldSelection,
  FIELDS,
  integer,
  RESPONSE_BUDGET,
  selectFields,
} from "./query";
import { renderRss } from "./feed";
import { openApiDocument } from "./openapi";

export interface WorkerEnv {
  SITE_BASE_URL: string;
  API_BEARER_TOKEN: string;
  RATE_LIMITER?: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
}
const TTL = 300_000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "X-Content-Type-Options": "nosniff",
};

export function createWorker(
  fetcher: typeof fetch = (...args) => fetch(...args),
  now = () => Date.now(),
) {
  let current:
    | {
        snapshot: ApiSnapshot;
        query: ReturnType<typeof createCatalogQuery>;
        checked: number;
        site: string;
      }
    | undefined;
  let pending: Promise<void> | undefined;
  const bodies = new Map<string, string>();
  let bodyBytes = 0;
  const localLimits = new Map<string, { count: number; end: number }>();

  async function snapshot(site: string) {
    if (current?.site !== site) current = undefined;
    let stale = false;
    if (!current || now() - current.checked >= TTL) {
      try {
        pending ??= (async () => {
          const response = await fetcher(
            new URL(
              `api-snapshot.json?refresh=${Math.floor(now() / TTL)}`,
              site,
            ),
            { signal: AbortSignal.timeout(10_000), cache: "no-store" },
          );
          if (!response.ok) throw new Error("Registry origin unavailable");
          const value: unknown = await response.json();
          validateSnapshot(value);
          // RSS serves historical events; the full baseline is needed only by
          // publication validation, not by an isolate's live query cache.
          value.feed.known = {};
          const query = createCatalogQuery(value, () => {
            value.searchIndex = undefined;
          });
          query.validateSearch();
          current = { snapshot: value, query, checked: now(), site };
        })();
        await pending;
      } catch {
        stale = true;
        if (!current)
          throw new ApiError(
            503,
            "REGISTRY_UNAVAILABLE",
            "No validated published snapshot is available",
          );
      } finally {
        pending = undefined;
      }
    }
    return { ...current!, stale };
  }

  async function loadBody(
    skill: ApiSkill,
  ): Promise<{ content: string; sourceUrl: string }> {
    if (!skill.sourceCommit || !skill.contentHash)
      throw new ApiError(
        409,
        "PROVENANCE_MISSING",
        "This legacy entry needs re-indexing before content can be read",
      );
    const path = (
      skill.sourcePath
        ? skill.sourcePath.split("/")
        : [...skill.relPath.split(/[\\/]/).filter(Boolean), "SKILL.md"]
    )
      .map(encodeURIComponent)
      .join("/");
    const sourceUrl = `https://raw.githubusercontent.com/${skill.owner}/${skill.repo}/${skill.sourceCommit}/${path}`;
    const cacheKey = `${sourceUrl}:${skill.contentHash}`;
    const cached = bodies.get(cacheKey);
    if (cached !== undefined) return { content: cached, sourceUrl };
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      const response = await fetcher(sourceUrl, {
        signal: AbortSignal.timeout(10_000),
        // workerd supports manual/follow only. Reject redirect status codes
        // below to preserve the commit-pinned origin contract.
        redirect: "manual",
      });
      if (!response.ok || !response.body) throw new Error("Source unavailable");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.byteLength;
        if (length > MAX_BODY_BYTES) {
          await reader.cancel();
          throw new ApiError(
            502,
            "CONTENT_TOO_LARGE",
            "Source exceeds the 8 MiB content budget; use its commit-pinned source URL",
          );
        }
        chunks.push(part.value);
      }
      bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        502,
        "SOURCE_UNAVAILABLE",
        "Commit-pinned source is unavailable or timed out",
      );
    }
    if ((await sha256(bytes)) !== skill.contentHash)
      throw new ApiError(
        502,
        "CONTENT_HASH_MISMATCH",
        "Source content differs from the published hash",
      );
    let content: string;
    try {
      content = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(bytes);
    } catch {
      throw new ApiError(
        502,
        "CONTENT_ENCODING_UNSUPPORTED",
        "SKILL.md must contain valid UTF-8 text",
      );
    }
    while (bodyBytes + content.length * 2 > MAX_BODY_BYTES && bodies.size) {
      const key = bodies.keys().next().value!;
      bodyBytes -= bodies.get(key)!.length * 2;
      bodies.delete(key);
    }
    if (content.length * 2 <= MAX_BODY_BYTES) {
      bodies.set(cacheKey, content);
      bodyBytes += content.length * 2;
    }
    return { content, sourceUrl };
  }

  const json = (data: unknown, status = 200) => {
    const text = JSON.stringify(data);
    if (text.length > RESPONSE_BUDGET)
      throw new ApiError(
        413,
        "RESPONSE_TOO_LARGE",
        "Response exceeds the Actions budget; select fewer metadata fields",
      );
    return new Response(text, {
      status,
      headers: {
        ...headers,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  };
  return {
    async fetch(request: Request, env: WorkerEnv): Promise<Response> {
      try {
        const url = new URL(request.url);
        if (request.method === "OPTIONS")
          return new Response(null, { status: 204, headers });
        if (request.method !== "GET")
          return json(
            {
              error: {
                code: "METHOD_NOT_ALLOWED",
                message: "Only GET is supported",
              },
            },
            405,
          );
        const route = url.pathname;
        if (
          ![
            "/openapi.json",
            "/rss.xml",
            "/v1/registry",
            "/v1/skills",
            "/v1/skill",
            "/v1/skill/content",
          ].includes(route)
        )
          throw new ApiError(404, "NOT_FOUND", "Unknown endpoint");
        if (
          route.startsWith("/v1/") &&
          (!env.API_BEARER_TOKEN ||
            request.headers.get("Authorization") !==
              `Bearer ${env.API_BEARER_TOKEN}`)
        )
          throw new ApiError(
            401,
            "UNAUTHORIZED",
            "A valid Bearer token is required",
          );
        const key = request.headers.get("CF-Connecting-IP") ?? "local";
        if (env.RATE_LIMITER) {
          if (!(await env.RATE_LIMITER.limit({ key })).success)
            throw new ApiError(429, "RATE_LIMITED", "Try again in 60 seconds");
        } else {
          // Local development fallback; production uses the Cloudflare binding.
          if (localLimits.size > 10_000)
            for (const [k, v] of localLimits)
              if (v.end <= now()) localLimits.delete(k);
          const slot = localLimits.get(key);
          const next =
            !slot || slot.end <= now()
              ? { count: 1, end: now() + 60_000 }
              : { ...slot, count: slot.count + 1 };
          localLimits.set(key, next);
          if (next.count > 120)
            throw new ApiError(429, "RATE_LIMITED", "Try again in 60 seconds");
        }
        if (route === "/openapi.json") return json(openApiDocument(url.origin));
        if (!env.SITE_BASE_URL)
          throw new ApiError(
            503,
            "CONFIGURATION_MISSING",
            "SITE_BASE_URL must identify this registry's GitHub Pages site",
          );
        const site = env.SITE_BASE_URL.replace(/\/?$/, "/");
        const { snapshot: s, query, stale } = await snapshot(site);
        const envelope = {
          snapshotId: s.snapshotId,
          generatedAt: s.generatedAt,
          stale,
        };
        if (route === "/rss.xml")
          return new Response(
            renderRss(s.feed, s.siteUrl, url.href, url.searchParams),
            {
              headers: {
                ...headers,
                "Content-Type": "application/rss+xml; charset=utf-8",
                "Cache-Control": "public, max-age=60",
                "X-ASM-Snapshot": s.snapshotId,
                "X-ASM-Stale": String(stale),
              },
            },
          );
        if (route === "/v1/registry") {
          assertParameters(url.searchParams, []);
          return json({
            ...envelope,
            data: {
              version: s.version,
              sourceRevision: s.sourceRevision,
              totalSkills: s.skills.length,
              totalRepos: s.repos.length,
              repos: s.repos,
              filters: query.facets,
            },
          });
        }
        if (route === "/v1/skills")
          return json({ ...envelope, ...query.search(url.searchParams) });
        assertParameters(
          url.searchParams,
          route === "/v1/skill"
            ? ["id", "fields"]
            : ["id", "offset", "limit", "contentHash"],
        );
        if (!url.searchParams.get("id"))
          throw new ApiError(400, "INVALID_PARAMETER", "id is required");
        const skill = query.get(url.searchParams.get("id")!);
        if (route === "/v1/skill")
          return json({
            ...envelope,
            data: selectFields(skill, fieldSelection(url.searchParams, FIELDS)),
          });
        const { content, sourceUrl } = await loadBody(skill);
        if (
          url.searchParams.has("contentHash") &&
          url.searchParams.get("contentHash") !== skill.contentHash
        )
          throw new ApiError(
            409,
            "CONTENT_CHANGED",
            "Restart content reading with the new published hash",
          );
        const offset = integer(
          url.searchParams.get("offset"),
          0,
          0,
          content.length,
        );
        if (
          offset > 0 &&
          /[\uDC00-\uDFFF]/.test(content[offset] ?? "") &&
          /[\uD800-\uDBFF]/.test(content[offset - 1])
        )
          throw new ApiError(
            400,
            "INVALID_OFFSET",
            "Offset splits a Unicode character",
          );
        let end = Math.min(
          content.length,
          offset + integer(url.searchParams.get("limit"), 32000, 1, 32000),
        );
        const result = () => ({
          ...envelope,
          data: {
            id: skill.id,
            content: content.slice(offset, end),
            contentHash: skill.contentHash,
            sourceCommit: skill.sourceCommit,
            sourceUrl,
            offset,
            totalLength: content.length,
            nextOffset: end < content.length ? end : null,
          },
        });
        while (JSON.stringify(result()).length > RESPONSE_BUDGET)
          end = offset + Math.max(1, Math.floor((end - offset) / 2));
        if (end < content.length && /[\uD800-\uDBFF]/.test(content[end - 1]))
          end--;
        if (end === offset && offset < content.length) end = offset + 2;
        return json(result());
      } catch (error) {
        const failure =
          error instanceof ApiError
            ? error
            : new ApiError(
                500,
                "INTERNAL_ERROR",
                "Unable to complete the request",
              );
        const response = json(
          { error: { code: failure.code, message: failure.message } },
          failure.status,
        );
        if (failure.status === 429) response.headers.set("Retry-After", "60");
        if (failure.status === 401)
          response.headers.set("WWW-Authenticate", "Bearer");
        return response;
      }
    },
  };
}

export default createWorker();
