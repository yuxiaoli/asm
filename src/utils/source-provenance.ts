import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);

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
): Promise<Buffer> {
  const path = [...relPath.split(/[\\/]/).filter(Boolean), "SKILL.md"].join(
    "/",
  );
  const { stdout } = await execute(
    "git",
    ["-C", directory, "show", `${commit}:${path}`],
    { encoding: "buffer", timeout: 10_000, maxBuffer: 16 * 1024 * 1024 },
  );
  return stdout;
}
