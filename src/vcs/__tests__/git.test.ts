import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitSnapshotProvider } from "../git";

function execGit(args: string[], cwd: string): string {
  const proc = Bun.spawnSync(["git", ...args], { cwd });
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args[0]} failed: ${proc.stderr.toString()}`);
  }
  return proc.stdout.toString().trim();
}

function createTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-trace-test-"));
  execGit(["init", "--initial-branch=main"], dir);
  execGit(["config", "user.email", "test@test.com"], dir);
  execGit(["config", "user.name", "Test"], dir);
  writeFileSync(join(dir, "initial.txt"), "hello\n");
  execGit(["add", "-A"], dir);
  execGit(["commit", "-m", "initial"], dir);
  return dir;
}

describe("gitSnapshotProvider", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo();
  });

  afterEach(() => {
    // cleanup handled by OS temp dir TTL
  });

  describe("detect", () => {
    it("returns true for a git repo", async () => {
      expect(await gitSnapshotProvider.detect(repoDir)).toBe(true);
    });

    it("returns false for a non-repo dir", async () => {
      const nonRepo = mkdtempSync(join(tmpdir(), "not-a-repo-"));
      expect(await gitSnapshotProvider.detect(nonRepo)).toBe(false);
    });
  });

  describe("captureSnapshot", () => {
    it("returns a tree SHA", async () => {
      const sha = await gitSnapshotProvider.captureSnapshot(repoDir);
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
    });

    it("captures uncommitted changes", async () => {
      const pre = await gitSnapshotProvider.captureSnapshot(repoDir);
      writeFileSync(join(repoDir, "new-file.txt"), "content\n");
      const post = await gitSnapshotProvider.captureSnapshot(repoDir);
      expect(pre).not.toBe(post);
    });

    it("returns same SHA for identical working tree", async () => {
      const first = await gitSnapshotProvider.captureSnapshot(repoDir);
      const second = await gitSnapshotProvider.captureSnapshot(repoDir);
      expect(first).toBe(second);
    });
  });

  describe("diffSnapshots", () => {
    it("returns empty for identical trees", async () => {
      const sha = await gitSnapshotProvider.captureSnapshot(repoDir);
      const diff = await gitSnapshotProvider.diffSnapshots(sha, sha, repoDir);
      expect(diff.files).toEqual([]);
    });

    it("detects added file", async () => {
      const pre = await gitSnapshotProvider.captureSnapshot(repoDir);
      writeFileSync(join(repoDir, "added.ts"), "const x = 1;\n");
      const post = await gitSnapshotProvider.captureSnapshot(repoDir);

      const diff = await gitSnapshotProvider.diffSnapshots(pre, post, repoDir);
      expect(diff.files).toHaveLength(1);
      expect(diff.files[0]?.path).toBe("added.ts");
      expect(diff.files[0]?.status).toBe("added");
      expect(diff.files[0]?.hunks.length).toBeGreaterThanOrEqual(1);
      expect(diff.files[0]?.hunks[0]?.change_type).toBe("added");
    });

    it("detects modified file", async () => {
      const pre = await gitSnapshotProvider.captureSnapshot(repoDir);
      writeFileSync(join(repoDir, "initial.txt"), "hello\nworld\n");
      const post = await gitSnapshotProvider.captureSnapshot(repoDir);

      const diff = await gitSnapshotProvider.diffSnapshots(pre, post, repoDir);
      expect(diff.files).toHaveLength(1);
      expect(diff.files[0]?.status).toBe("modified");
      expect(diff.files[0]?.hunks.length).toBeGreaterThanOrEqual(1);
    });

    it("detects deleted file", async () => {
      const pre = await gitSnapshotProvider.captureSnapshot(repoDir);
      unlinkSync(join(repoDir, "initial.txt"));
      const post = await gitSnapshotProvider.captureSnapshot(repoDir);

      const diff = await gitSnapshotProvider.diffSnapshots(pre, post, repoDir);
      expect(diff.files).toHaveLength(1);
      expect(diff.files[0]?.path).toBe("initial.txt");
      expect(diff.files[0]?.status).toBe("deleted");
      expect(diff.files[0]?.hunks).toEqual([]);
    });

    it("detects renamed file with content change", async () => {
      // Create a file with enough content for rename detection
      const content = Array.from({ length: 20 }, (_, i) => `line ${i}`).join(
        "\n",
      );
      writeFileSync(join(repoDir, "original.ts"), content);
      execGit(["add", "-A"], repoDir);
      execGit(["commit", "-m", "add original"], repoDir);

      const pre = await gitSnapshotProvider.captureSnapshot(repoDir);
      unlinkSync(join(repoDir, "original.ts"));
      writeFileSync(join(repoDir, "renamed.ts"), `${content}\nextra line\n`);
      const post = await gitSnapshotProvider.captureSnapshot(repoDir);

      const diff = await gitSnapshotProvider.diffSnapshots(pre, post, repoDir);
      expect(diff.files).toHaveLength(1);
      expect(diff.files[0]?.status).toBe("renamed");
      expect(diff.files[0]?.oldPath).toBe("original.ts");
      expect(diff.files[0]?.path).toBe("renamed.ts");
    });

    it("includes patch text when includePatch is true", async () => {
      const pre = await gitSnapshotProvider.captureSnapshot(repoDir);
      writeFileSync(join(repoDir, "patched.ts"), "new content\n");
      const post = await gitSnapshotProvider.captureSnapshot(repoDir);

      const diff = await gitSnapshotProvider.diffSnapshots(pre, post, repoDir, {
        includePatch: true,
      });
      expect(diff.files).toHaveLength(1);
      expect(diff.files[0]?.patch).toBeDefined();
      expect(diff.files[0]?.patch).toContain("new content");
    });

    it("does not include patch text by default", async () => {
      const pre = await gitSnapshotProvider.captureSnapshot(repoDir);
      writeFileSync(join(repoDir, "nopath.ts"), "test\n");
      const post = await gitSnapshotProvider.captureSnapshot(repoDir);

      const diff = await gitSnapshotProvider.diffSnapshots(pre, post, repoDir);
      expect(diff.files[0]?.patch).toBeUndefined();
    });

    it("excludes .agent-trace/ paths", async () => {
      const pre = await gitSnapshotProvider.captureSnapshot(repoDir);
      mkdirSync(join(repoDir, ".agent-trace"), { recursive: true });
      writeFileSync(join(repoDir, ".agent-trace", "traces.jsonl"), "{}\n");
      writeFileSync(join(repoDir, "real-change.ts"), "code\n");
      const post = await gitSnapshotProvider.captureSnapshot(repoDir);

      const diff = await gitSnapshotProvider.diffSnapshots(pre, post, repoDir);
      const paths = diff.files.map((f) => f.path);
      expect(paths).toContain("real-change.ts");
      expect(paths).not.toContain(".agent-trace/traces.jsonl");
    });

    it("handles multiple file changes", async () => {
      const pre = await gitSnapshotProvider.captureSnapshot(repoDir);
      writeFileSync(join(repoDir, "a.ts"), "a\n");
      writeFileSync(join(repoDir, "b.ts"), "b\n");
      writeFileSync(join(repoDir, "initial.txt"), "modified\n");
      const post = await gitSnapshotProvider.captureSnapshot(repoDir);

      const diff = await gitSnapshotProvider.diffSnapshots(pre, post, repoDir);
      expect(diff.files.length).toBe(3);
    });

    it("handles deletion-only edits within a file", async () => {
      writeFileSync(join(repoDir, "initial.txt"), "line1\nline2\nline3\n");
      execGit(["add", "-A"], repoDir);
      execGit(["commit", "-m", "add lines"], repoDir);

      const pre = await gitSnapshotProvider.captureSnapshot(repoDir);
      writeFileSync(join(repoDir, "initial.txt"), "line1\nline3\n");
      const post = await gitSnapshotProvider.captureSnapshot(repoDir);

      const diff = await gitSnapshotProvider.diffSnapshots(pre, post, repoDir);
      expect(diff.files).toHaveLength(1);
      expect(diff.files[0]?.status).toBe("modified");
      const deletedHunks = diff.files[0]?.hunks.filter(
        (h) => h.change_type === "deleted",
      );
      expect(deletedHunks?.length).toBeGreaterThanOrEqual(1);
    });

    it("hunk ranges are accurate with includePatch (not inflated by context lines)", async () => {
      // A file with many lines, then a single-line edit in the middle.
      // Under --unified=3, the @@ header would show context lines inflating newCount.
      // This test verifies ranges reflect only actual changes.
      const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
      writeFileSync(join(repoDir, "ctx.ts"), `${lines.join("\n")}\n`);
      execGit(["add", "-A"], repoDir);
      execGit(["commit", "-m", "add ctx"], repoDir);

      const pre = await gitSnapshotProvider.captureSnapshot(repoDir);
      lines[9] = "CHANGED line 10";
      writeFileSync(join(repoDir, "ctx.ts"), `${lines.join("\n")}\n`);
      const post = await gitSnapshotProvider.captureSnapshot(repoDir);

      const diff = await gitSnapshotProvider.diffSnapshots(pre, post, repoDir, {
        includePatch: true,
      });
      expect(diff.files).toHaveLength(1);
      expect(diff.files[0]?.patch).toBeDefined();
      expect(diff.files[0]?.patch).toContain("CHANGED line 10");

      // Range should cover only the changed line, not context lines
      const hunk = diff.files[0]?.hunks[0];
      expect(hunk?.change_type).toBe("modified");
      expect(hunk?.start_line).toBe(10);
      expect(hunk?.end_line).toBe(10);
    });

    it("detects binary files with includePatch", async () => {
      const pre = await gitSnapshotProvider.captureSnapshot(repoDir);
      // Write binary content (NUL bytes trigger git binary detection)
      const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00]);
      writeFileSync(join(repoDir, "image.png"), buf);
      const post = await gitSnapshotProvider.captureSnapshot(repoDir);

      const diff = await gitSnapshotProvider.diffSnapshots(pre, post, repoDir, {
        includePatch: true,
      });
      expect(diff.files).toHaveLength(1);
      expect(diff.files[0]?.path).toBe("image.png");
      expect(diff.files[0]?.binary).toBe(true);
      expect(diff.files[0]?.hunks).toEqual([]);
    });

    it("handles new file creation (empty diff before)", async () => {
      const pre = await gitSnapshotProvider.captureSnapshot(repoDir);
      writeFileSync(
        join(repoDir, "brand-new.ts"),
        "line1\nline2\nline3\nline4\nline5\n",
      );
      const post = await gitSnapshotProvider.captureSnapshot(repoDir);

      const diff = await gitSnapshotProvider.diffSnapshots(pre, post, repoDir);
      expect(diff.files).toHaveLength(1);
      expect(diff.files[0]?.status).toBe("added");
      expect(diff.files[0]?.hunks).toHaveLength(1);
      expect(diff.files[0]?.hunks[0]?.change_type).toBe("added");
      expect(diff.files[0]?.hunks[0]?.start_line).toBe(1);
      expect(diff.files[0]?.hunks[0]?.end_line).toBe(5);
    });
  });
});
