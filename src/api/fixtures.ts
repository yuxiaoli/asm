import MiniSearch from "minisearch";
import { MINISEARCH_OPTIONS } from "../../scripts/minisearch-options";
import { buildFeedState } from "./feed";
import { sha256, type ApiSkill, type ApiSnapshot } from "./types";

export async function fixtureSnapshot(
  content = "# Skill\nRead these instructions.\n",
  snapshotId = "snapshot-a",
): Promise<ApiSnapshot> {
  const base: ApiSkill = {
    id: "alpha/skills::::review",
    name: "review",
    description: "Review React code",
    owner: "alpha",
    repo: "skills",
    relPath: "",
    version: "1.0.0",
    license: "MIT",
    creator: "A",
    compatibility: "Codex",
    allowedTools: ["Read"],
    tags: ["React", "testing"],
    categories: ["development"],
    verified: true,
    installUrl: "github:alpha/skills",
    skillUrl: "https://github.com/alpha/skills/blob/dev/SKILL.md",
    indexedAt: "2026-10-01T00:00:00Z",
    sourceCommit: "a".repeat(40),
    contentHash: await sha256(content),
    tokenCount: 100,
    stars: 30,
    evalSummary: { grade: "A", overallScore: 95 },
  };
  const skills = [
    base,
    {
      ...base,
      id: "beta/library::nested::review",
      owner: "beta",
      repo: "library",
      relPath: "nested",
      description: "Review security code",
      license: "Apache 2.0",
      tags: ["security"],
      categories: ["security"],
      verified: false,
      allowedTools: [],
      tokenCount: 500,
      stars: 10,
      evalSummary: { grade: "B", overallScore: 80 },
    },
  ];
  const generatedAt = "2026-10-11T00:00:00Z",
    sourceRevision = "c".repeat(40);
  const search = new MiniSearch(MINISEARCH_OPTIONS);
  search.addAll(
    skills.map((s, i) => ({
      id: i,
      name: s.name,
      description: s.description,
      categoriesStr: [...s.categories, ...s.tags].join(" "),
    })),
  );
  return {
    schemaVersion: 1,
    snapshotId,
    generatedAt,
    sourceRevision,
    siteUrl: "https://example.com/asm/",
    version: "1.0.0",
    repos: skills.map((s) => ({
      owner: s.owner,
      repo: s.repo,
      indexedAt: s.indexedAt,
      sourceCommit: s.sourceCommit,
    })),
    skills,
    searchIndex: { ...search.toJSON(), generatedAt, snapshotId },
    feed: await buildFeedState(skills, {
      snapshotId,
      generatedAt,
      sourceRevision,
    }),
  };
}
