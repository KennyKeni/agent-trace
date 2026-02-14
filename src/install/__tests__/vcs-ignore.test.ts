import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installIgnoreEntry } from "../vcs-ignore";

function execGit(args: string[], cwd: string): void {
  const proc = Bun.spawnSync(["git", ...args], { cwd });
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args[0]} failed: ${proc.stderr.toString()}`);
  }
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "agent-trace-vcs-ignore-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("installIgnoreEntry", () => {
  test("creates .gitignore in git repo", () => {
    execGit(["init", "--initial-branch=main"], tmpDir);
    const result = installIgnoreEntry(tmpDir, false);
    expect(result.status).toBe("created");
    const content = readFileSync(join(tmpDir, ".gitignore"), "utf-8");
    expect(content).toContain(".agent-trace/");
  });

  test("appends to existing .gitignore", () => {
    execGit(["init", "--initial-branch=main"], tmpDir);
    writeFileSync(join(tmpDir, ".gitignore"), "node_modules/\n");
    const result = installIgnoreEntry(tmpDir, false);
    expect(result.status).toBe("updated");
    const content = readFileSync(join(tmpDir, ".gitignore"), "utf-8");
    expect(content).toContain("node_modules/");
    expect(content).toContain(".agent-trace/");
  });

  test("idempotent — does not duplicate entry", () => {
    execGit(["init", "--initial-branch=main"], tmpDir);
    installIgnoreEntry(tmpDir, false);
    const result = installIgnoreEntry(tmpDir, false);
    expect(result.status).toBe("unchanged");
    const content = readFileSync(join(tmpDir, ".gitignore"), "utf-8");
    const matches = content
      .split("\n")
      .filter((l) => l.trim() === ".agent-trace/");
    expect(matches).toHaveLength(1);
  });

  test("creates .gitignore in non-VCS directory", () => {
    const result = installIgnoreEntry(tmpDir, false);
    expect(result.status).toBe("created");
    expect(existsSync(join(tmpDir, ".gitignore"))).toBe(true);
  });

  test("dry run does not create file", () => {
    execGit(["init", "--initial-branch=main"], tmpDir);
    const result = installIgnoreEntry(tmpDir, true);
    expect(result.status).toBe("created");
    expect(existsSync(join(tmpDir, ".gitignore"))).toBe(false);
  });

  test("writes .gitignore at repo root when targetRoot is a subdirectory", () => {
    execGit(["init", "--initial-branch=main"], tmpDir);
    const subdir = join(tmpDir, "packages", "core");
    mkdirSync(subdir, { recursive: true });
    const result = installIgnoreEntry(subdir, false);
    expect(result.status).toBe("created");
    expect(existsSync(join(tmpDir, ".gitignore"))).toBe(true);
    expect(existsSync(join(subdir, ".gitignore"))).toBe(false);
    const content = readFileSync(join(tmpDir, ".gitignore"), "utf-8");
    expect(content).toContain(".agent-trace/");
  });
});
