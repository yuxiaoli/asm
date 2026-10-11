# Skill Registry API, RSS and Custom GPT Actions

The API reads the latest successfully published website snapshot. Index refreshes
still follow the registry's reviewed publication workflow. It does not search
the developer's local ASM config or fetch a moving branch for skill content.

## Deploy the Worker

Use the repository's API commands in `CLAUDE.md`. Wrangler uses
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` from the environment or the
gitignored `.env`. The deployment helper discovers the current repository's
Pages URL through GitHub, or accepts `ASM_SITE_BASE_URL` explicitly.

Set `API_BEARER_TOKEN` as a Wrangler secret by entering the maintainer's chosen
token at the prompt. Do not commit the token to the config, `.dev.vars`, docs,
OpenAPI, screenshots or logs. Local development can use a gitignored `.dev.vars`.
The development helper keeps unrelated `.env` secrets out of Worker bindings.
Set the public GitHub repository variable `ASM_API_BASE_URL` to the resulting
HTTPS Worker URL. A custom domain can be added later without changing API paths.

For automated Worker deployment, configure repository secrets
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Set the Bearer secret with
Wrangler once; subsequent deployments preserve it.
The workflow only deploys when the public variable `ASM_WORKER_DEPLOY_ENABLED` is
`true`; personal forks can deploy with Wrangler without copying cloud credentials
to GitHub. No workflow enables or purchases a Workers plan.

## Publish the first feed

### Current Free-plan deployment

Live acceptance on 2026-10-11 verified 6,842 skills from 81 repositories,
all selectors and pagination, and a 292,366-character body reconstructed from
10 hash-verified segments. Cloudflare measured API CPU P50 of 1.43 ms and P99
of 560 ms, and isolate memory P99 of approximately 83 MiB. These are sampled
metrics from the acceptance requests, including cold loads.

The account is on Workers Free. Cold loads and snapshot refreshes exceed its
10 ms CPU allowance; repeated refresh testing returned resource-limit 503s.
The maintainer explicitly deferred a paid upgrade. The current deployment is
therefore available for evaluation but cannot guarantee successful cold loads
or refreshes. No subscription was changed.

For a future approved Workers Paid deployment, configure
`"limits": { "cpu_ms": 1000 }` in `wrangler.jsonc`, deploy with Wrangler and
repeat cold-load/refresh acceptance. The Paid subscription starts at US$5/month;
see [Cloudflare pricing](https://developers.cloudflare.com/workers/platform/pricing/).
Free accounts reject this CPU-limit configuration, so it is intentionally absent
from the current config.

The first release requires a manual “Deploy Skill Catalog” run with
`bootstrap_feed=true`. The existing directory becomes the baseline, with no
historical notification flood. Future runs read `feed-state.json` from the last
successful Pages publication and compare its source revision with the latest
completed successful production publication workflow. A later missing/corrupt state cannot be
bootstrapped again: recover the last published artifact instead.

Production publishes are serialized through verification of the new public
snapshot. PR/local builds never fetch or replace production history. Production
reruns cannot rewind a newer successful deployment. An intentional rollback is
a new reviewed revert commit, keeping the published history as the baseline.

## Read API

All `/v1/*` operations require `Authorization: Bearer <token>`. RSS and
`/openapi.json` are public. Browser callers may send Authorization through CORS;
the service uses no session cookies. The Cloudflare rate-limit binding allows
120 requests per IP per minute per Cloudflare location, with a local fallback
for development. This is a basic limiter, not a global exact quota.

| Endpoint                 | Purpose                                                          |
| ------------------------ | ---------------------------------------------------------------- |
| `/v1/registry`           | Snapshot, repo indexing dates, counts and filter values          |
| `/v1/skills`             | Search, filters, sorting, field projection and cursor pagination |
| `/v1/skill?id=…`         | Metadata and source provenance                                   |
| `/v1/skill/content?id=…` | Commit-pinned SKILL.md segments                                  |
| `/rss.xml`               | Public filtered RSS                                              |
| `/openapi.json`          | OpenAPI 3.1 Actions schema                                       |

Use the exact `owner/repo::relPath::name` ID returned by search; skill names alone
are ambiguous. Root-level skills have an empty `relPath`, which is valid.

Search selectors: `q`, `category`, `repo`, `author`, `tags`, `license`, `grade`,
`source`, `usesTools`, `verified`, `minTokens`, `maxTokens`, `sort`, `fields`,
`limit`, `cursor`. Multi-value filters use comma-separated strings. Conditions
intersect; categories/facets accept any selected value; tags require all values
case-insensitively. Missing token counts never satisfy a token range.

`license` uses the website's license buckets. `source=official|verified|community`
uses the existing catalog classification, not author identity verification.
`usesTools=yes|no` tests tool presence. `verified=true|false` reflects indexing
checks, not a human endorsement. Compatibility remains descriptive free text.
Unknown bounded values and invalid parameters return 400; an unknown repo/tag
or keyword legitimately produces an empty result.

Sorts match the website: `relevance`, `stars`, `name`, `grade`, `tokens-asc`,
`tokens-desc`, including its featured-first and popularity diversification.
Default is relevance with a keyword, otherwise stars. Default page size is 20,
maximum 50. `fields` selects public metadata; `id` is always present and `content`
is unavailable in lists. Keep original selectors when following `nextCursor`.
409 `SNAPSHOT_CHANGED` means restart pagination.

JSON includes `snapshotId`, `generatedAt`, `stale` and `data`. Search additionally
returns `total` and `nextCursor`. `generatedAt` is build time; repo `indexedAt`
is collection time. Neither claims an upstream skill modification date.
Snapshots are checked at least every five minutes of active use. Origin failure
preserves a verified snapshot with `stale=true`; a cold unavailable origin yields 503.

Content uses the clone's exact commit and verifies SHA-256 against indexed bytes.
Repository-local symlinks retain their catalog ID; `sourcePath` records the actual
commit-relative blob path used for the source URL and content retrieval. Text is
decoded as UTF-8 without dropping a leading BOM; invalid UTF-8 returns an explicit
`CONTENT_ENCODING_UNSUPPORTED` error.
Pass `offset`, optional `limit` (1–32000), and the previous `contentHash` when
continuing. Follow `nextOffset` until null. Offsets/lengths are UTF-16 code units;
use returned offsets, never calculate them from rendered text. Responses fit a
90000-character serialized JSON budget; escaping may reduce the segment size.
The source fetch has a 10-second timeout and an 8 MiB file budget. Hash mismatch,
missing source and timeout are explicit errors; no branch fallback occurs.
Legacy entries without provenance return 409 `PROVENANCE_MISSING` for content.

## RSS

Pages publishes `rss.xml`; the Worker provides arbitrary combinations of
`category`, `repo`, `tags`, `event=added|updated`. Each feed includes at most
100 events from the retained 1000-event history. All known IDs retain their
baseline independently of that history cap. Metadata is captured at event time,
so removing a skill does not change old feed matches. Dates record observation
in a published registry snapshot, not upstream Git timestamps.

Body and important metadata changes produce updates. Stars, evaluator timestamps,
source commit alone and rebuild time do not. Adding provenance to a legacy entry
alone does not claim a body change. Removals produce no notification; a known
skill returning to the directory produces an update, not a first-time addition.

## Custom GPT setup and acceptance

Create a private GPT named **ASM Skill Finder**, with description **Find agent
skills and read their source instructions from the published ASM registry**.
Paste `/openapi.json` into Actions, select **API Key → Bearer**, privately enter
the configured token, and paste `GPT_ACTIONS_INSTRUCTIONS.md` as Instructions.
The website's API page supplies the live schema URL and copyable instructions.

Test all four Actions in the editor, then test these requests in conversation:

1. Find three React testing skills and cite their sources.
2. Filter a specific repository and license, selecting name and description.
3. Filter tags together with grade and a token budget.
4. Read both distinct skills sharing a name using their exact IDs.
5. Read complete instructions, continuing a long body until nextOffset is null.
6. Explain an empty search and a legacy provenance error without inventing content.
7. Recover from a changed snapshot by restarting pagination.
8. Explain stale results and an unavailable upstream source.

Keep the GPT private for v1. Public sharing/submission is a separate release.
