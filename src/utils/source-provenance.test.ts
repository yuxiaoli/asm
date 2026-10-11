import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  readSourceCommit,
  readSourceSkill,
  sourceSkillPath,
} from "./source-provenance";

let directory: string;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
describe("source provenance", () => {
  it("reads actual HEAD on a non-main branch and keeps legacy directories compatible", async () => {
    directory = await mkdtemp(join(tmpdir(), "asm-git-provenance-"));
    expect(await readSourceCommit(directory)).toBeUndefined();
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", directory, ...args], {
        encoding: "utf8",
      }).trim();
    git("init", "-b", "release-skills");
    await writeFile(join(directory, "SKILL.md"), "root skill\n");
    await mkdir(join(directory, "actual"));
    await writeFile(join(directory, "actual", "SKILL.md"), "linked skill\n");
    await symlink(
      join(directory, "actual"),
      join(directory, "alias"),
      process.platform === "win32" ? "junction" : "dir",
    );
    git("add", "SKILL.md");
    git("add", "actual");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "-m",
      "fixture",
    );
    expect(await readSourceCommit(directory)).toBe(git("rev-parse", "HEAD"));
    expect(await sourceSkillPath(directory, "alias")).toBe("actual/SKILL.md");
    expect(
      (
        await readSourceSkill(directory, "alias", git("rev-parse", "HEAD"))
      ).toString(),
    ).toBe("linked skill\n");
    await writeFile(join(directory, "SKILL.md"), "checkout changed\r\n");
    expect(
      (
        await readSourceSkill(directory, "", git("rev-parse", "HEAD"))
      ).toString(),
    ).toBe("root skill\n");
  });
});
