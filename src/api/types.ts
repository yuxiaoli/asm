export interface ApiSkill {
  id: string;
  name: string;
  description: string;
  owner: string;
  repo: string;
  relPath: string;
  version: string;
  license: string;
  creator: string;
  compatibility: string;
  allowedTools: string[];
  tags: string[];
  dependencies?: string[];
  categories: string[];
  verified: boolean;
  installUrl: string;
  skillUrl: string;
  sourceCommit?: string;
  contentHash?: string;
  sourcePath?: string;
  indexedAt: string;
  tokenCount?: number;
  stars?: number;
  featured?: boolean;
  evalSummary?: {
    grade: string;
    overallScore: number;
    categories?: unknown[];
    evaluatedAt?: string;
  };
}

export interface FeedEvent {
  id: string;
  skillId: string;
  type: "added" | "updated";
  observedAt: string;
  snapshotId: string;
  skill: Pick<
    ApiSkill,
    | "name"
    | "description"
    | "owner"
    | "repo"
    | "categories"
    | "tags"
    | "skillUrl"
  >;
}

export interface FeedState {
  schemaVersion: 1;
  snapshotId: string;
  sourceRevision: string;
  generatedAt: string;
  known: Record<
    string,
    {
      metadataHash: string;
      contentHash?: string;
      firstSeenAt: string;
      lastChangedAt: string;
      present: boolean;
    }
  >;
  knownCount: number;
  events: FeedEvent[];
}

export interface ApiSnapshot {
  schemaVersion: 1;
  snapshotId: string;
  sourceRevision: string;
  generatedAt: string;
  siteUrl: string;
  apiUrl?: string;
  version: string;
  repos: Array<{
    owner: string;
    repo: string;
    indexedAt: string;
    sourceCommit?: string;
  }>;
  skills: ApiSkill[];
  searchIndex: unknown;
  feed: FeedState;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function sha256(
  value: string | Uint8Array<ArrayBuffer>,
): Promise<string> {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}

export function validateFeedState(
  value: unknown,
  fullBaseline = true,
): asserts value is FeedState {
  const state = value as FeedState;
  if (
    !state ||
    state.schemaVersion !== 1 ||
    typeof state.snapshotId !== "string" ||
    !state.snapshotId ||
    typeof state.sourceRevision !== "string" ||
    !/^[a-f0-9]{40}$/i.test(state.sourceRevision) ||
    !Number.isFinite(Date.parse(state.generatedAt)) ||
    !state.known ||
    Array.isArray(state.known) ||
    typeof state.known !== "object" ||
    !Array.isArray(state.events) ||
    state.events.length > 1000 ||
    !Number.isSafeInteger(state.knownCount) ||
    state.knownCount < 0 ||
    (fullBaseline && Object.keys(state.known).length !== state.knownCount)
  ) {
    throw new Error("Invalid feed-state schema; history must not be reset");
  }
  for (const entry of Object.values(state.known)) {
    if (
      !entry ||
      !/^[a-f0-9]{64}$/.test(entry.metadataHash) ||
      (entry.contentHash !== undefined &&
        !/^[a-f0-9]{64}$/.test(entry.contentHash)) ||
      !Number.isFinite(Date.parse(entry.firstSeenAt)) ||
      !Number.isFinite(Date.parse(entry.lastChangedAt)) ||
      typeof entry.present !== "boolean"
    )
      throw new Error("Invalid feed baseline entry");
  }
  const ids = new Set<string>();
  for (const event of state.events) {
    if (
      !event ||
      typeof event.id !== "string" ||
      !/^[a-f0-9]{64}$/.test(event.id) ||
      ids.has(event.id) ||
      !["added", "updated"].includes(event.type) ||
      typeof event.skillId !== "string" ||
      (fullBaseline && !Object.hasOwn(state.known, event.skillId)) ||
      typeof event.snapshotId !== "string" ||
      !Number.isFinite(Date.parse(event.observedAt)) ||
      !event.skill ||
      ["name", "description", "owner", "repo", "skillUrl"].some(
        (k) => typeof event.skill[k as keyof typeof event.skill] !== "string",
      ) ||
      !Array.isArray(event.skill.categories) ||
      !Array.isArray(event.skill.tags) ||
      ![...event.skill.categories, ...event.skill.tags].every(
        (v) => typeof v === "string",
      )
    ) {
      throw new Error("Invalid or duplicate feed event");
    }
    ids.add(event.id);
  }
}

export function validateSnapshot(value: unknown): asserts value is ApiSnapshot {
  const snapshot = value as ApiSnapshot;
  if (
    !snapshot ||
    snapshot.schemaVersion !== 1 ||
    typeof snapshot.snapshotId !== "string" ||
    !Number.isFinite(Date.parse(snapshot.generatedAt)) ||
    typeof snapshot.siteUrl !== "string" ||
    typeof snapshot.sourceRevision !== "string" ||
    !Array.isArray(snapshot.skills) ||
    !Array.isArray(snapshot.repos)
  ) {
    throw new Error("Invalid registry snapshot");
  }
  validateFeedState(snapshot.feed, false);
  if (
    snapshot.feed.snapshotId !== snapshot.snapshotId ||
    snapshot.feed.sourceRevision !== snapshot.sourceRevision ||
    snapshot.feed.generatedAt !== snapshot.generatedAt
  )
    throw new Error("Mixed registry/feed snapshots");
  const ids = new Set<string>();
  for (const s of snapshot.skills) {
    if (
      !s ||
      [
        "id",
        "name",
        "description",
        "owner",
        "repo",
        "relPath",
        "license",
        "skillUrl",
        "installUrl",
      ].some((k) => typeof s[k as keyof ApiSkill] !== "string") ||
      s.id !== `${s.owner}/${s.repo}::${s.relPath}::${s.name}` ||
      ids.has(s.id) ||
      !/^[\w.-]+$/.test(s.owner) ||
      !/^[\w.-]+$/.test(s.repo) ||
      s.relPath.split(/[\\/]/).some((p) => p === ".." || p === ".") ||
      s.relPath.startsWith("/") ||
      !Array.isArray(s.categories) ||
      !Array.isArray(s.tags) ||
      !Array.isArray(s.allowedTools) ||
      ![...s.categories, ...s.tags, ...s.allowedTools].every(
        (v) => typeof v === "string",
      ) ||
      typeof s.verified !== "boolean" ||
      (s.sourceCommit !== undefined &&
        !/^[a-f0-9]{40}$/i.test(s.sourceCommit)) ||
      (s.contentHash !== undefined && !/^[a-f0-9]{64}$/.test(s.contentHash)) ||
      (s.sourcePath !== undefined &&
        (typeof s.sourcePath !== "string" ||
          !s.sourcePath ||
          s.sourcePath.startsWith("/") ||
          s.sourcePath.split(/[\\/]/).some((p) => p === ".." || p === ".")))
    )
      throw new Error("Invalid or duplicate registry skill");
    ids.add(s.id);
  }
  const search = snapshot.searchIndex as {
    generatedAt?: string;
    snapshotId?: string;
    documentCount?: number;
    serializationVersion?: number;
    documentIds?: Record<string, number>;
    index?: unknown[];
  };
  if (
    !search ||
    search.generatedAt !== snapshot.generatedAt ||
    search.snapshotId !== snapshot.snapshotId
  )
    throw new Error("Mixed search snapshot");
  if (
    search.documentCount !== snapshot.skills.length ||
    search.serializationVersion !== 2 ||
    !Array.isArray(search.index) ||
    !search.documentIds ||
    Object.values(search.documentIds).length !== snapshot.skills.length ||
    Object.values(search.documentIds).some((id, position) => id !== position)
  )
    throw new Error("Invalid search document mapping");
}
