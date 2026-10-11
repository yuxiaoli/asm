import { FIELDS, SORTS } from "./query";

export function openApiDocument(apiUrl: string) {
  const parameter = (
    name: string,
    type = "string",
    extra: Record<string, unknown> = {},
  ) => ({
    name,
    in: "query",
    required: name === "id",
    schema: { type, ...extra },
    description:
      name === "id"
        ? "Canonical skill ID returned by searchSkills; preserve exactly."
        : `${name} selector. Multiple filter values use comma-separated strings.`,
  });
  const skillProperties = Object.fromEntries(
    FIELDS.map((name) => [
      name,
      ["categories", "tags", "allowedTools", "dependencies"].includes(name)
        ? { type: "array", items: { type: "string" } }
        : ["verified", "featured"].includes(name)
          ? { type: "boolean" }
          : ["tokenCount", "stars"].includes(name)
            ? { type: "number" }
            : name === "evalSummary"
              ? {
                  type: "object",
                  properties: {
                    grade: { type: "string" },
                    overallScore: { type: "number" },
                  },
                }
              : { type: "string" },
    ]),
  );
  const envelope = (data: Record<string, unknown>) => ({
    type: "object",
    required: ["snapshotId", "generatedAt", "stale", "data"],
    properties: {
      snapshotId: { type: "string" },
      generatedAt: { type: "string", format: "date-time" },
      stale: { type: "boolean" },
      data,
    },
  });
  const operation = (
    operationId: string,
    description: string,
    parameters: unknown[],
    schema: unknown,
  ) => ({
    get: {
      operationId,
      summary: description,
      description,
      "x-openai-isConsequential": false,
      security: [{ bearerAuth: [] }],
      parameters,
      responses: {
        "200": {
          description: "Published snapshot result",
          content: { "application/json": { schema } },
        },
        ...Object.fromEntries(
          [400, 401, 404, 409, 413, 429, 502, 503].map((status) => [
            String(status),
            {
              description: "Structured API error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          ]),
        ),
      },
    },
  });
  return {
    openapi: "3.1.0",
    info: {
      title: "ASM Skill Registry",
      version: "1.0.0",
      description:
        "Search the latest published skill registry, then retrieve metadata and commit-pinned skill instructions.",
    },
    servers: [{ url: apiUrl.replace(/\/$/, "") }],
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
      schemas: {
        Skill: {
          type: "object",
          required: ["id"],
          properties: skillProperties,
        },
        Error: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              properties: {
                code: { type: "string" },
                message: { type: "string" },
              },
            },
          },
        },
      },
    },
    paths: {
      "/v1/registry": operation(
        "getRegistry",
        "Get snapshot provenance and valid filter values.",
        [],
        envelope({
          type: "object",
          properties: {
            version: { type: "string" },
            totalSkills: { type: "integer" },
            totalRepos: { type: "integer" },
            sourceRevision: { type: "string" },
            filters: {
              type: "object",
              additionalProperties: {
                type: "array",
                items: { type: "string" },
              },
            },
          },
        }),
      ),
      "/v1/skills": operation(
        "searchSkills",
        "Search lightweight skill metadata. Read instructions separately with getSkillContent.",
        [
          ...[
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
            "fields",
            "cursor",
          ].map((name) => parameter(name)),
          parameter("sort", "string", { enum: SORTS }),
          parameter("limit", "integer", {
            minimum: 1,
            maximum: 50,
            default: 20,
          }),
          ...["minTokens", "maxTokens"].map((name) =>
            parameter(name, "integer", { minimum: 0 }),
          ),
        ],
        {
          ...envelope({
            type: "array",
            items: { $ref: "#/components/schemas/Skill" },
          }),
          properties: {
            ...envelope({}).properties,
            data: {
              type: "array",
              items: { $ref: "#/components/schemas/Skill" },
            },
            total: { type: "integer" },
            nextCursor: { type: ["string", "null"] },
          },
        },
      ),
      "/v1/skill": operation(
        "getSkill",
        "Get complete skill metadata and immutable source provenance.",
        [parameter("id"), parameter("fields")],
        envelope({ $ref: "#/components/schemas/Skill" }),
      ),
      "/v1/skill/content": operation(
        "getSkillContent",
        "Read commit-pinned SKILL.md. Continue at nextOffset until null to obtain the complete instructions.",
        [
          parameter("id"),
          parameter("offset", "integer", { minimum: 0, default: 0 }),
          parameter("limit", "integer", {
            minimum: 1,
            maximum: 32000,
            default: 32000,
          }),
          parameter("contentHash"),
        ],
        envelope({
          type: "object",
          required: [
            "content",
            "contentHash",
            "sourceCommit",
            "nextOffset",
            "totalLength",
          ],
          properties: {
            id: { type: "string" },
            content: { type: "string" },
            contentHash: { type: "string" },
            sourceCommit: { type: "string" },
            sourceUrl: { type: "string", format: "uri" },
            offset: { type: "integer" },
            nextOffset: { type: ["integer", "null"] },
            totalLength: { type: "integer" },
          },
        }),
      ),
    },
  };
}
