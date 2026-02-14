import { beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shellSnapshot as claudeShellSnapshot } from "../../providers/claude";
import { shellSnapshot as cursorShellSnapshot } from "../../providers/cursor";
import {
  handlePostShell,
  handlePreHook,
  type SnapshotContext,
} from "../snapshot-middleware";

function execGit(args: string[], cwd: string): string {
  const proc = Bun.spawnSync(["git", ...args], { cwd });
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args[0]} failed: ${proc.stderr.toString()}`);
  }
  return proc.stdout.toString().trim();
}

function createTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-trace-mw-test-"));
  execGit(["init", "--initial-branch=main"], dir);
  execGit(["config", "user.email", "test@test.com"], dir);
  execGit(["config", "user.name", "Test"], dir);
  const configDir = join(dir, ".agent-trace");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "config.json"), "{}", "utf-8");
  writeFileSync(join(dir, "initial.txt"), "hello\n");
  execGit(["add", "-A"], dir);
  execGit(["commit", "-m", "initial"], dir);
  return dir;
}

const shellSnapshotByProvider: Record<string, typeof claudeShellSnapshot> = {
  claude: claudeShellSnapshot,
  cursor: cursorShellSnapshot,
};

function makeCtx(
  provider: string,
  hookEvent: string,
  repoRoot: string,
  overrides?: Partial<SnapshotContext>,
): SnapshotContext {
  return {
    provider,
    input: {
      hook_event_name: hookEvent,
      tool_name: "Bash",
      session_id: "test-session",
      model: "test-model",
      ...((overrides as any)?.inputOverrides ?? {}),
    },
    repoRoot,
    adapterEvents: [],
    activeExtensionNames: [],
    sessionIdFor: (i) => i.session_id ?? i.conversation_id ?? i.generation_id,
    shellSnapshot: shellSnapshotByProvider[provider],
    ...overrides,
  };
}

describe("snapshot-middleware", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo();
  });

  describe("handlePreHook", () => {
    it("returns true for PreToolUse/Bash (claude)", async () => {
      const ctx = makeCtx("claude", "PreToolUse", repoDir);
      const handled = await handlePreHook(ctx);
      expect(handled).toBe(true);
    });

    it("returns true for beforeShellExecution (cursor)", async () => {
      const ctx = makeCtx("cursor", "beforeShellExecution", repoDir);
      const handled = await handlePreHook(ctx);
      expect(handled).toBe(true);
    });

    it("returns false for non-pre-shell events", async () => {
      const ctx = makeCtx("claude", "PostToolUse", repoDir);
      const handled = await handlePreHook(ctx);
      expect(handled).toBe(false);
    });

    it("caches provider per repoRoot (different roots get independent detection)", async () => {
      const repo = createTempGitRepo();
      const nonRepo = mkdtempSync(join(tmpdir(), "not-a-repo-cache-"));

      const ctx1 = makeCtx("claude", "PreToolUse", repo);
      const ctx2 = makeCtx("claude", "PreToolUse", nonRepo);

      const handled1 = await handlePreHook(ctx1);
      const handled2 = await handlePreHook(ctx2);

      expect(handled1).toBe(true);
      expect(handled2).toBe(false);
    });

    it("returns false for non-git directories", async () => {
      const nonRepo = mkdtempSync(join(tmpdir(), "not-a-repo-mw-"));
      const ctx = makeCtx("claude", "PreToolUse", nonRepo);
      const handled = await handlePreHook(ctx);
      expect(handled).toBe(false);
    });
  });

  describe("handlePostShell", () => {
    it("returns empty for non-post-shell events", async () => {
      const ctx = makeCtx("claude", "PreToolUse", repoDir);
      const result = await handlePostShell(ctx);
      expect(result.events).toEqual([]);
      expect(result.deletedPaths).toEqual([]);
    });

    it("returns empty when no pre-snapshot exists", async () => {
      const ctx = makeCtx("claude", "PostToolUse", repoDir);
      const result = await handlePostShell(ctx);
      expect(result.events).toEqual([]);
    });

    it("produces file_edit events for detected changes", async () => {
      // Pre-hook: capture snapshot
      const preCtx = makeCtx("claude", "PreToolUse", repoDir, {
        input: {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          session_id: "test-session",
          model: "test-model",
          tool_use_id: "call-1",
        } as any,
      });
      await handlePreHook(preCtx);

      // Simulate file change
      writeFileSync(join(repoDir, "new-file.ts"), "const x = 1;\n");

      // Post-hook: capture + diff
      const postCtx = makeCtx("claude", "PostToolUse", repoDir, {
        input: {
          hook_event_name: "PostToolUse",
          tool_name: "Bash",
          session_id: "test-session",
          model: "test-model",
          tool_use_id: "call-1",
        } as any,
        adapterEvents: [
          {
            kind: "shell",
            provider: "claude",
            sessionId: "test-session",
            model: "test-model",
            meta: { command: "echo test" },
          },
        ],
      });
      const result = await handlePostShell(postCtx);

      expect(result.events.length).toBeGreaterThanOrEqual(1);
      const fileEdit = result.events.find((e) => e.kind === "file_edit");
      expect(fileEdit).toBeDefined();
      if (fileEdit && fileEdit.kind === "file_edit") {
        expect(fileEdit.filePath).toBe("new-file.ts");
        expect(fileEdit.snapshotRanges).toBeDefined();
        expect(fileEdit.snapshotRanges?.length).toBeGreaterThanOrEqual(1);
        expect(fileEdit.edits).toEqual([]);
        expect(fileEdit.meta["dev.agent-trace.source"]).toBe("vcs_snapshot");
      }
    });

    it("returns empty for read-only commands (no changes)", async () => {
      const preCtx = makeCtx("claude", "PreToolUse", repoDir, {
        input: {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          session_id: "test-session",
          model: "test-model",
          tool_use_id: "call-2",
        } as any,
      });
      await handlePreHook(preCtx);

      // No file changes

      const postCtx = makeCtx("claude", "PostToolUse", repoDir, {
        input: {
          hook_event_name: "PostToolUse",
          tool_name: "Bash",
          session_id: "test-session",
          model: "test-model",
          tool_use_id: "call-2",
        } as any,
        adapterEvents: [
          {
            kind: "shell",
            provider: "claude",
            sessionId: "test-session",
            model: "test-model",
            meta: {},
          },
        ],
      });
      const result = await handlePostShell(postCtx);
      expect(result.events).toEqual([]);
    });

    it("returns deleted_paths in result", async () => {
      const preCtx = makeCtx("claude", "PreToolUse", repoDir, {
        input: {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          session_id: "test-session",
          model: "test-model",
          tool_use_id: "call-3",
        } as any,
      });
      await handlePreHook(preCtx);

      // Delete a file
      const { unlinkSync } = await import("node:fs");
      unlinkSync(join(repoDir, "initial.txt"));

      const shellEvent = {
        kind: "shell" as const,
        provider: "claude",
        sessionId: "test-session",
        model: "test-model",
        meta: {} as Record<string, unknown>,
      };

      const postCtx = makeCtx("claude", "PostToolUse", repoDir, {
        input: {
          hook_event_name: "PostToolUse",
          tool_name: "Bash",
          session_id: "test-session",
          model: "test-model",
          tool_use_id: "call-3",
        } as any,
        adapterEvents: [shellEvent],
      });
      const result = await handlePostShell(postCtx);

      // No file_edit events for deleted files
      expect(result.events.filter((e) => e.kind === "file_edit")).toHaveLength(
        0,
      );
      // deleted_paths returned in result for caller to filter
      expect(result.deletedPaths).toEqual(["initial.txt"]);
    });

    it("emits synthetic shell event on failure without adapter shell event", async () => {
      const preCtx = makeCtx("claude", "PreToolUse", repoDir, {
        input: {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          session_id: "test-session",
          model: "test-model",
          tool_use_id: "call-4",
        } as any,
      });
      await handlePreHook(preCtx);

      writeFileSync(join(repoDir, "partial.ts"), "partial write\n");

      const postCtx = makeCtx("claude", "PostToolUseFailure", repoDir, {
        input: {
          hook_event_name: "PostToolUseFailure",
          tool_name: "Bash",
          session_id: "test-session",
          model: "test-model",
          tool_use_id: "call-4",
        } as any,
        adapterEvents: [], // no adapter shell event on failure
      });
      const result = await handlePostShell(postCtx);

      const shellEvent = result.events.find((e) => e.kind === "shell");
      expect(shellEvent).toBeDefined();
      expect(shellEvent?.meta["dev.agent-trace.failure"]).toBe(true);

      const fileEdit = result.events.find((e) => e.kind === "file_edit");
      expect(fileEdit).toBeDefined();
    });

    it("includes precomputedPatch when diffs extension is active", async () => {
      const preCtx = makeCtx("claude", "PreToolUse", repoDir, {
        input: {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          session_id: "test-session",
          model: "test-model",
          tool_use_id: "call-5",
        } as any,
      });
      await handlePreHook(preCtx);

      writeFileSync(join(repoDir, "patched.ts"), "content\n");

      const postCtx = makeCtx("claude", "PostToolUse", repoDir, {
        input: {
          hook_event_name: "PostToolUse",
          tool_name: "Bash",
          session_id: "test-session",
          model: "test-model",
          tool_use_id: "call-5",
        } as any,
        adapterEvents: [
          {
            kind: "shell",
            provider: "claude",
            sessionId: "test-session",
            model: "test-model",
            meta: {},
          },
        ],
        activeExtensionNames: ["diffs"],
      });
      const result = await handlePostShell(postCtx);

      const fileEdit = result.events.find((e) => e.kind === "file_edit");
      expect(fileEdit).toBeDefined();
      if (fileEdit && fileEdit.kind === "file_edit") {
        expect(fileEdit.precomputedPatch).toBeDefined();
        expect(fileEdit.precomputedPatch).toContain("content");
      }
    });
  });
});
