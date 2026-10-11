import MiniSearch from "minisearch";
import { MINISEARCH_OPTIONS } from "../../scripts/minisearch-options";
import { applyFilters } from "../../website-src/src/lib/filter-sort.js";
import { licenseBucket, skillSource } from "../../website-src/src/lib/utils.js";
import { ApiError, type ApiSnapshot, type ApiSkill } from "./types";

export const DEFAULT_FIELDS = [
  "id",
  "name",
  "description",
  "owner",
  "repo",
  "categories",
  "verified",
  "skillUrl",
  "installUrl",
];
export const FIELDS = [
  ...DEFAULT_FIELDS,
  "relPath",
  "version",
  "license",
  "creator",
  "compatibility",
  "allowedTools",
  "tags",
  "dependencies",
  "sourceCommit",
  "contentHash",
  "indexedAt",
  "tokenCount",
  "stars",
  "featured",
  "evalSummary",
];
export const SORTS = [
  "relevance",
  "stars",
  "name",
  "grade",
  "tokens-asc",
  "tokens-desc",
];
export const RESPONSE_BUDGET = 90_000;
const FILTERS = [
  "q",
  "category",
  "repo",
  "author",
  "tags",
  "license",
  "grade",
  "source",
  "usesTools",
  "verified",
  "minTokens",
  "maxTokens",
  "sort",
  "fields",
  "limit",
  "cursor",
];

export function integer(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === null) return fallback;
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < min ||
    Number(value) > max
  )
    throw new ApiError(
      400,
      "INVALID_PARAMETER",
      `Expected integer from ${min} to ${max}`,
    );
  return Number(value);
}

export function selectFields(
  skill: ApiSkill,
  fields: string[],
): Record<string, unknown> {
  return Object.fromEntries(
    ["id", ...fields]
      .filter(
        (f, i, all) =>
          all.indexOf(f) === i && skill[f as keyof ApiSkill] !== undefined,
      )
      .map((f) => [f, skill[f as keyof ApiSkill]]),
  );
}

export function fieldSelection(
  params: URLSearchParams,
  fallback: string[] = DEFAULT_FIELDS,
): string[] {
  const fields = params.has("fields")
    ? params
        .get("fields")!
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
    : fallback;
  if (!fields.length || fields.some((v) => !FIELDS.includes(v)))
    throw new ApiError(
      400,
      "INVALID_FIELDS",
      "fields must contain public metadata fields; content is a separate operation",
    );
  return fields;
}

export function assertParameters(
  params: URLSearchParams,
  allowed: string[],
): void {
  for (const key of params.keys()) {
    if (!allowed.includes(key))
      throw new ApiError(400, "INVALID_PARAMETER", `Unknown parameter: ${key}`);
    if (params.getAll(key).length > 1)
      throw new ApiError(
        400,
        "INVALID_PARAMETER",
        `Use comma-separated values for ${key}`,
      );
    const maximum = key === "cursor" ? 65_536 : 2048;
    if ((params.get(key)?.length ?? 0) > maximum)
      throw new ApiError(
        400,
        "INVALID_PARAMETER",
        `${key} exceeds ${maximum} characters`,
      );
  }
}

export function createCatalogQuery(
  snapshot: ApiSnapshot,
  releaseSerializedSearch = () => {},
) {
  let search: MiniSearch | undefined;
  const validateSearch = () => {
    if (!search) {
      search = MiniSearch.loadJS(
        snapshot.searchIndex as ReturnType<MiniSearch["toJSON"]>,
        MINISEARCH_OPTIONS,
      );
      releaseSerializedSearch();
    }
    return search;
  };
  const csv = (p: URLSearchParams, key: string) =>
    (p.get(key) ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  const facets = {
    category: [...new Set(snapshot.skills.flatMap((s) => s.categories))].sort(),
    repo: [
      ...new Set(snapshot.skills.map((s) => `${s.owner}/${s.repo}`)),
    ].sort(),
    author: [...new Set(snapshot.skills.map((s) => s.owner))].sort(),
    tags: [...new Set(snapshot.skills.flatMap((s) => s.tags))].sort(),
    license: [
      ...new Set(snapshot.skills.map((s) => licenseBucket(s.license))),
    ].sort(),
    grade: ["A", "B", "C", "D", "F"],
    source: ["official", "verified", "community"],
    usesTools: ["yes", "no"],
    verified: ["true", "false"],
    sort: SORTS,
    fields: FIELDS,
  };
  return {
    facets,
    validateSearch,
    search(params: URLSearchParams) {
      assertParameters(params, FILTERS);
      for (const key of [
        "license",
        "grade",
        "source",
        "usesTools",
        "verified",
      ]) {
        if (
          csv(params, key).some(
            (v) => !facets[key as keyof typeof facets].includes(v),
          )
        )
          throw new ApiError(400, "INVALID_FILTER", `Unknown ${key} value`);
      }
      const q = (params.get("q") ?? "").trim();
      const sort = params.get("sort") || (q ? "relevance" : "stars");
      if (!SORTS.includes(sort))
        throw new ApiError(400, "INVALID_SORT", "Unknown sort");
      const fields = fieldSelection(params),
        limit = integer(params.get("limit"), 20, 1, 50);
      const min = integer(
        params.get("minTokens"),
        0,
        0,
        Number.MAX_SAFE_INTEGER,
      );
      const max = integer(
        params.get("maxTokens"),
        Number.MAX_SAFE_INTEGER,
        0,
        Number.MAX_SAFE_INTEGER,
      );
      if (min > max)
        throw new ApiError(
          400,
          "INVALID_FILTER",
          "minTokens exceeds maxTokens",
        );
      const repo = csv(params, "repo"),
        verified = csv(params, "verified");
      let rows = snapshot.skills.filter(
        (s) =>
          (!repo.length || repo.includes(`${s.owner}/${s.repo}`)) &&
          (!verified.length || verified.includes(String(s.verified))) &&
          (!(params.has("minTokens") || params.has("maxTokens")) ||
            (s.tokenCount !== undefined &&
              s.tokenCount >= min &&
              s.tokenCount <= max)),
      );
      let scoreById: Map<string, number> | null = null;
      if (q) {
        scoreById = new Map(
          validateSearch()
            .search(q)
            .map((hit) => [
              typeof hit.id === "number"
                ? snapshot.skills[hit.id].id
                : String(hit.id),
              hit.score,
            ]),
        );
      }
      rows = applyFilters(
        rows,
        {
          searchQuery: q,
          activeCategories: new Set(csv(params, "category")),
          activeRepo: "all",
          sort,
          activeFacets: Object.fromEntries(
            ["license", "grade", "source", "usesTools", "author", "tags"].map(
              (key) => [key, new Set(csv(params, key))],
            ),
          ),
        },
        { scoreById },
      );
      // A canonical query binds cursor to filters, selected fields and page size.
      const canonical = [...params.entries()]
        .filter(([k]) => k !== "cursor")
        .sort(([a], [b]) => a.localeCompare(b));
      const binding = JSON.stringify(canonical);
      let offset = 0;
      if (params.has("cursor")) {
        let cursor: { snapshot: string; query: string; offset: number };
        try {
          cursor = JSON.parse(
            new TextDecoder().decode(
              Uint8Array.from(atob(params.get("cursor")!), (c) =>
                c.charCodeAt(0),
              ),
            ),
          );
        } catch {
          throw new ApiError(400, "INVALID_CURSOR", "Invalid cursor");
        }
        if (!cursor || typeof cursor !== "object")
          throw new ApiError(400, "INVALID_CURSOR", "Invalid cursor");
        if (cursor.snapshot !== snapshot.snapshotId)
          throw new ApiError(
            409,
            "SNAPSHOT_CHANGED",
            "Registry changed; restart pagination without cursor",
          );
        if (
          cursor.query !== binding ||
          !Number.isSafeInteger(cursor.offset) ||
          cursor.offset < 0 ||
          cursor.offset > rows.length
        )
          throw new ApiError(
            400,
            "INVALID_CURSOR",
            "Cursor does not match this query",
          );
        offset = cursor.offset;
      }
      const cursorFor = (n: number) =>
        n < rows.length
          ? btoa(
              String.fromCharCode(
                ...new TextEncoder().encode(
                  JSON.stringify({
                    snapshot: snapshot.snapshotId,
                    query: binding,
                    offset: n,
                  }),
                ),
              ),
            )
          : null;
      const data: Record<string, unknown>[] = [];
      for (const row of rows.slice(offset, offset + limit)) {
        const selected = selectFields(row, fields);
        const candidate = {
          snapshotId: snapshot.snapshotId,
          generatedAt: snapshot.generatedAt,
          stale: true,
          total: rows.length,
          data: [...data, selected],
          nextCursor: cursorFor(offset + data.length + 1),
        };
        if (JSON.stringify(candidate).length > RESPONSE_BUDGET) {
          if (!data.length)
            throw new ApiError(
              413,
              "RESPONSE_TOO_LARGE",
              "Select fewer fields",
            );
          break;
        }
        data.push(selected);
      }
      return {
        total: rows.length,
        data,
        nextCursor: cursorFor(offset + data.length),
      };
    },
    get(id: string): ApiSkill {
      const skill = snapshot.skills.find((s) => s.id === id);
      if (!skill)
        throw new ApiError(404, "SKILL_NOT_FOUND", "Unknown skill id");
      return skill;
    },
    sources: [...new Set(snapshot.skills.map(skillSource))],
  };
}
