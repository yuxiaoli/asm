import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
const execute = promisify(execFile);

/** Resolve repository-local symlinks to a blob GitHub can serve at this commit. */
export async function sourceSkillPath(
  directory: string,
  relPath: string,
): Promise<string> {
  const root = await realpath(directory);
  const path = relative(root, await realpath(join(root, relPath, "SKILL.md")));
  if (isAbsolute(path) || path.split(/[\\/]/).includes(".."))
    throw new Error("Skill source escapes its repository");
  return path.replace(/\\/g, "/");
}

/** Legacy/test discovery directories may have no Git metadata. Never invent a ref. */
export async function readSourceCommit(
  directory: string,
): Promise<string | undefined> {
  try {
    const { stdout } = await execute(
      "git",
      ["-C", directory, "rev-parse", "HEAD"],
      { timeout: 10_000 },
    );
    const commit = stdout.trim();
    return /^[0-9a-f]{40}$/i.test(commit) ? commit : undefined;
  } catch {
    return undefined;
  }
}

/** Git's committed bytes avoid host checkout CRLF/smudge transformations. */
export async function readSourceSkill(
  directory: string,
  relPath: string,
  commit: string,
  sourcePath?: string,
): Promise<Buffer> {
  const path = sourcePath ?? (await sourceSkillPath(directory, relPath));
  const { stdout } = await execute(
    "git",
    ["-C", directory, "show", `${commit}:${path}`],
    { encoding: "buffer", timeout: 10_000, maxBuffer: 16 * 1024 * 1024 },
  );
  return stdout;
}
