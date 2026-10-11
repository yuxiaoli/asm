import {
  ApiError,
  sha256,
  validateFeedState,
  type ApiSkill,
  type FeedState,
} from "./types";

export async function buildFeedState(
  skills: ApiSkill[],
  context: Pick<FeedState, "snapshotId" | "generatedAt" | "sourceRevision">,
  previous?: FeedState,
): Promise<FeedState> {
  if (previous) validateFeedState(previous);
  const known: FeedState["known"] = Object.fromEntries(
    Object.entries(previous?.known ?? {}).map(([id, entry]) => [
      id,
      { ...entry, present: false },
    ]),
  );
  const events = [...(previous?.events ?? [])];
  for (const s of skills) {
    const metadataHash = await sha256(
      JSON.stringify({
        name: s.name,
        description: s.description,
        version: s.version,
        license: s.license,
        tags: [...s.tags].sort(),
        compatibility: s.compatibility,
        allowedTools: [...s.allowedTools].sort(),
        dependencies: [...(s.dependencies ?? [])].sort(),
      }),
    );
    const prior = previous?.known[s.id];
    // Filling legacy provenance alone is not evidence of a body update.
    const changed =
      !!prior &&
      (!prior.present ||
        prior.metadataHash !== metadataHash ||
        (prior.contentHash !== undefined &&
          s.contentHash !== undefined &&
          prior.contentHash !== s.contentHash));
    known[s.id] = {
      metadataHash,
      contentHash: s.contentHash ?? prior?.contentHash,
      firstSeenAt: prior?.firstSeenAt ?? context.generatedAt,
      lastChangedAt: changed
        ? context.generatedAt
        : (prior?.lastChangedAt ?? context.generatedAt),
      present: true,
    };
    if (previous && (!prior || changed)) {
      const type = prior ? "updated" : "added";
      events.push({
        id: await sha256(
          JSON.stringify([
            context.snapshotId,
            s.id,
            type,
            metadataHash,
            s.contentHash,
          ]),
        ),
        skillId: s.id,
        type,
        observedAt: context.generatedAt,
        snapshotId: context.snapshotId,
        skill: {
          name: s.name,
          description: s.description,
          owner: s.owner,
          repo: s.repo,
          categories: [...s.categories],
          tags: [...s.tags],
          skillUrl: s.skillUrl,
        },
      });
    }
  }
  events.sort(
    (a, b) =>
      b.observedAt.localeCompare(a.observedAt) || a.id.localeCompare(b.id),
  );
  return { schemaVersion: 1, ...context, known, events: events.slice(0, 1000) };
}

const escapeXml = (value: string) =>
  value
    .replace(
      // XML 1.0 permits only tab/newline/carriage-return among control characters.
      // eslint-disable-next-line no-control-regex
      /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu,
      "\uFFFD",
    )
    .replace(
      /[<>&"']/g,
      (c) =>
        ({
          "<": "&lt;",
          ">": "&gt;",
          "&": "&amp;",
          '"': "&quot;",
          "'": "&apos;",
        })[c]!,
    );

export function renderRss(
  state: FeedState,
  siteUrl: string,
  selfUrl: string,
  filters = new URLSearchParams(),
): string {
  const allowed = new Set(["category", "repo", "tags", "event"]);
  for (const key of filters.keys())
    if (!allowed.has(key))
      throw new ApiError(400, "INVALID_FILTER", `Unknown RSS filter: ${key}`);
  const values = (key: string) =>
    filters
      .getAll(key)
      .flatMap((v) => v.split(","))
      .map((v) => v.trim())
      .filter(Boolean);
  const types = values("event");
  if (types.some((v) => v !== "added" && v !== "updated"))
    throw new ApiError(400, "INVALID_FILTER", "event must be added or updated");
  const categories = values("category"),
    repos = values("repo"),
    tags = values("tags").map((v) => v.toLowerCase());
  const events = state.events
    .filter(
      (e) =>
        (!types.length || types.includes(e.type)) &&
        (!categories.length ||
          categories.some((c) => e.skill.categories.includes(c))) &&
        (!repos.length || repos.includes(`${e.skill.owner}/${e.skill.repo}`)) &&
        tags.every((t) => e.skill.tags.some((v) => v.toLowerCase() === t)),
    )
    .slice(0, 100);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>ASM skill updates</title><link>${escapeXml(siteUrl)}</link><description>New and substantively updated skills in the published catalog. Dates describe registry observation, not upstream modification.</description><atom:link href="${escapeXml(selfUrl)}" rel="self" type="application/rss+xml"/><lastBuildDate>${new Date(state.generatedAt).toUTCString()}</lastBuildDate>${events.map((e) => `<item><guid isPermaLink="false">urn:asm:${e.id}</guid><title>${escapeXml(`${e.type}: ${e.skill.name}`)}</title><link>${escapeXml(new URL(`#/skills/${encodeURIComponent(e.skillId)}`, siteUrl).href)}</link><description>${escapeXml(e.skill.description)}</description><pubDate>${new Date(e.observedAt).toUTCString()}</pubDate>${e.skill.categories.map((c) => `<category>${escapeXml(c)}</category>`).join("")}</item>`).join("")}</channel></rss>`;
}
