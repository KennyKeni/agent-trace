import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SPEC_VERSION } from "../schemas";

const CLI = resolve(import.meta.dir, "../../cli.ts");

function hookRaw(
  args: string[],
  stdin: string,
  root: string,
): { exitCode: number; stderr: string } {
  const result = spawnSync("bun", [CLI, "hook", ...args], {
    input: stdin,
    env: { ...process.env, AGENT_TRACE_WORKSPACE_ROOT: root },
    timeout: 15_000,
  });
  return {
    exitCode: result.status ?? 1,
    stderr: result.stderr?.toString() ?? "",
  };
}

function hook(
  provider: string,
  input: Record<string, unknown>,
  root: string,
): { exitCode: number; stderr: string } {
  return hookRaw(["--provider", provider], JSON.stringify(input), root);
}

function readJsonl(path: string): unknown[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function initAgentTrace(dir: string): void {
  const configDir = join(dir, ".agent-trace");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "config.json"), "{}", "utf-8");
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "agent-trace-integration-"));
  initAgentTrace(tmpDir);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("runHook integration", () => {
  describe("claude provider", () => {
    test("PostToolUse/Edit produces trace + diff + raw event", () => {
      // Enable raw capture
      writeFileSync(
        join(tmpDir, ".agent-trace", "config.json"),
        JSON.stringify({ rawCapture: true }),
      );

      const filePath = join(tmpDir, "src", "index.ts");
      const { exitCode } = hook(
        "claude",
        {
          hook_event_name: "PostToolUse",
          tool_name: "Edit",
          tool_input: {
            file_path: filePath,
            old_string: "const x = 1;",
            new_string: "const x = 2;",
          },
          session_id: "sess-1",
          model: "claude-sonnet-4-5-20250929",
        },
        tmpDir,
      );
      expect(exitCode).toBe(0);

      const traces = readJsonl(join(tmpDir, ".agent-trace", "traces.jsonl"));
      expect(traces).toHaveLength(1);
      const t = traces[0] as any;
      expect(t.version).toBe(SPEC_VERSION);
      expect(t.tool).toEqual({ name: "claude-code" });
      expect(t.files).toHaveLength(1);
      expect(t.files[0].path).toBe("src/index.ts");
      expect(t.files[0].conversations[0].contributor.model_id).toBe(
        "anthropic/claude-sonnet-4-5-20250929",
      );
      expect(t.files[0].conversations[0].ranges).toHaveLength(1);
      expect(t.files[0].conversations[0].ranges[0].content_hash).toMatch(
        /^murmur3:[0-9a-f]{8}$/,
      );

      const diffPath = join(
        tmpDir,
        ".agent-trace",
        "diffs",
        "claude",
        "sess-1.patch",
      );
      expect(existsSync(diffPath)).toBe(true);
      const diff = readFileSync(diffPath, "utf-8");
      expect(diff).toContain("-const x = 1;");
      expect(diff).toContain("+const x = 2;");

      const rawPath = join(
        tmpDir,
        ".agent-trace",
        "raw",
        "claude",
        "sess-1.jsonl",
      );
      const raw = readJsonl(rawPath);
      expect(raw).toHaveLength(1);
      expect((raw[0] as any).provider).toBe("claude");
    });

    test("PostToolUse/Bash produces shell trace", () => {
      const { exitCode } = hook(
        "claude",
        {
          hook_event_name: "PostToolUse",
          tool_name: "Bash",
          tool_input: { command: "ls -la" },
          session_id: "sess-2",
          model: "claude-sonnet-4-5-20250929",
        },
        tmpDir,
      );
      expect(exitCode).toBe(0);

      const traces = readJsonl(join(tmpDir, ".agent-trace", "traces.jsonl"));
      expect(traces).toHaveLength(1);
      const t = traces[0] as any;
      expect(t.files[0].path).toBe(".shell-history");
      expect(t.metadata.command).toBe("ls -la");
      expect(t.metadata.tool_name).toBe("Bash");
    });

    test("UserPromptSubmit produces message + raw, no trace", () => {
      // Enable raw capture
      writeFileSync(
        join(tmpDir, ".agent-trace", "config.json"),
        JSON.stringify({ rawCapture: true }),
      );

      const { exitCode } = hook(
        "claude",
        {
          hook_event_name: "UserPromptSubmit",
          prompt: "hello world",
          session_id: "sess-3",
          model: "claude-sonnet-4-5-20250929",
        },
        tmpDir,
      );
      expect(exitCode).toBe(0);

      expect(existsSync(join(tmpDir, ".agent-trace", "traces.jsonl"))).toBe(
        false,
      );

      const msgPath = join(
        tmpDir,
        ".agent-trace",
        "messages",
        "claude",
        "sess-3.jsonl",
      );
      const msgs = readJsonl(msgPath);
      expect(msgs).toHaveLength(1);
      const m = msgs[0] as any;
      expect(m.role).toBe("user");
      expect(m.content).toBe("hello world");
      expect(m.model_id).toBe("anthropic/claude-sonnet-4-5-20250929");

      expect(
        existsSync(
          join(tmpDir, ".agent-trace", "raw", "claude", "sess-3.jsonl"),
        ),
      ).toBe(true);
    });

    test("SessionStart produces session trace", () => {
      const { exitCode } = hook(
        "claude",
        {
          hook_event_name: "SessionStart",
          session_id: "sess-4",
          model: "claude-sonnet-4-5-20250929",
          source: "cli",
        },
        tmpDir,
      );
      expect(exitCode).toBe(0);

      const traces = readJsonl(join(tmpDir, ".agent-trace", "traces.jsonl"));
      expect(traces).toHaveLength(1);
      const t = traces[0] as any;
      expect(t.files[0].path).toBe(".sessions");
      expect(t.metadata.event).toBe("session_start");
      expect(t.metadata.source).toBe("cli");
    });
  });

  describe("cursor provider", () => {
    test("afterFileEdit produces trace + diff", () => {
      const filePath = join(tmpDir, "src", "app.ts");
      const { exitCode } = hook(
        "cursor",
        {
          hook_event_name: "afterFileEdit",
          file_path: filePath,
          edits: [{ old_string: "let a = 1", new_string: "let a = 2" }],
          session_id: "cur-1",
          model: "gpt-4",
        },
        tmpDir,
      );
      expect(exitCode).toBe(0);

      const traces = readJsonl(join(tmpDir, ".agent-trace", "traces.jsonl"));
      expect(traces).toHaveLength(1);
      const t = traces[0] as any;
      expect(t.tool.name).toBe("cursor");
      expect(t.files[0].path).toBe("src/app.ts");
      expect(t.files[0].conversations[0].contributor.model_id).toBe(
        "openai/gpt-4",
      );

      expect(
        existsSync(
          join(tmpDir, ".agent-trace", "diffs", "cursor", "cur-1.patch"),
        ),
      ).toBe(true);
    });

    test("afterShellExecution produces shell trace", () => {
      const { exitCode } = hook(
        "cursor",
        {
          hook_event_name: "afterShellExecution",
          command: "npm test",
          session_id: "cur-2",
          model: "gpt-4",
          duration: 1500,
        },
        tmpDir,
      );
      expect(exitCode).toBe(0);

      const traces = readJsonl(join(tmpDir, ".agent-trace", "traces.jsonl"));
      expect(traces).toHaveLength(1);
      const t = traces[0] as any;
      expect(t.files[0].path).toBe(".shell-history");
      expect(t.metadata.command).toBe("npm test");
      expect(t.metadata.duration_ms).toBe(1500);
    });
  });

  describe("opencode provider", () => {
    test("hook:tool.execute.after shell produces trace with command", () => {
      const { exitCode } = hook(
        "opencode",
        {
          hook_event_name: "hook:tool.execute.after",
          tool_name: "bash",
          command: "git status",
          session_id: "oc-1",
          model: "claude-sonnet-4-5-20250929",
        },
        tmpDir,
      );
      expect(exitCode).toBe(0);

      const traces = readJsonl(join(tmpDir, ".agent-trace", "traces.jsonl"));
      expect(traces).toHaveLength(1);
      const t = traces[0] as any;
      expect(t.files[0].path).toBe(".shell-history");
      expect(t.metadata.command).toBe("git status");
      expect(t.metadata.tool_name).toBe("bash");
    });

    test("hook:tool.execute.after file_edit produces trace per file", () => {
      const { exitCode } = hook(
        "opencode",
        {
          hook_event_name: "hook:tool.execute.after",
          tool_name: "edit",
          session_id: "oc-2",
          model: "claude-sonnet-4-5-20250929",
          files: [
            {
              file: join(tmpDir, "src", "a.ts"),
              before: "old a",
              after: "new a",
            },
            {
              file: join(tmpDir, "src", "b.ts"),
              before: "old b",
              after: "new b",
            },
          ],
        },
        tmpDir,
      );
      expect(exitCode).toBe(0);

      const traces = readJsonl(join(tmpDir, ".agent-trace", "traces.jsonl"));
      expect(traces).toHaveLength(2);
      const paths = traces.map((t: any) => t.files[0].path);
      expect(paths).toContain("src/a.ts");
      expect(paths).toContain("src/b.ts");

      const diffPath = join(
        tmpDir,
        ".agent-trace",
        "diffs",
        "opencode",
        "oc-2.patch",
      );
      expect(existsSync(diffPath)).toBe(true);
      const diff = readFileSync(diffPath, "utf-8");
      expect(diff).toContain("-old a");
      expect(diff).toContain("+new a");
      expect(diff).toContain("-old b");
      expect(diff).toContain("+new b");
    });
  });

  describe("snapshot middleware via hook pipeline", () => {
    test("PreToolUse/Bash exits 0 and produces no trace", () => {
      const { exitCode } = hook(
        "claude",
        {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          session_id: "snap-1",
          model: "claude-sonnet-4-5-20250929",
        },
        tmpDir,
      );
      expect(exitCode).toBe(0);

      expect(existsSync(join(tmpDir, ".agent-trace", "traces.jsonl"))).toBe(
        false,
      );
    });

    test("cursor beforeShellExecution exits 0 and produces no trace", () => {
      const { exitCode } = hook(
        "cursor",
        {
          hook_event_name: "beforeShellExecution",
          session_id: "snap-2",
          model: "gpt-4",
          generation_id: "gen-2",
        },
        tmpDir,
      );
      expect(exitCode).toBe(0);

      expect(existsSync(join(tmpDir, ".agent-trace", "traces.jsonl"))).toBe(
        false,
      );
    });

    test("opencode hook:tool.execute.before exits 0 and produces no trace", () => {
      const { exitCode } = hook(
        "opencode",
        {
          hook_event_name: "hook:tool.execute.before",
          tool_name: "bash",
          session_id: "snap-3",
          call_id: "call-oc-1",
        },
        tmpDir,
      );
      expect(exitCode).toBe(0);

      expect(existsSync(join(tmpDir, ".agent-trace", "traces.jsonl"))).toBe(
        false,
      );
    });

    test("opencode command.executed is suppressed", () => {
      const { exitCode } = hook(
        "opencode",
        {
          hook_event_name: "command.executed",
          event: { name: "git status" },
          session_id: "oc-supp",
        },
        tmpDir,
      );
      expect(exitCode).toBe(0);

      expect(existsSync(join(tmpDir, ".agent-trace", "traces.jsonl"))).toBe(
        false,
      );
    });
  });

  describe("end-to-end snapshot attribution", () => {
    let gitDir: string;

    function execGit(args: string[], cwd: string): string {
      const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
      if (result.status !== 0) {
        throw new Error(`git ${args[0]} failed: ${result.stderr}`);
      }
      return (result.stdout ?? "").trim();
    }

    beforeEach(() => {
      gitDir = mkdtempSync(join(tmpdir(), "agent-trace-e2e-snap-"));
      execGit(["init", "--initial-branch=main"], gitDir);
      execGit(["config", "user.email", "test@test.com"], gitDir);
      execGit(["config", "user.name", "Test"], gitDir);
      initAgentTrace(gitDir);
      writeFileSync(join(gitDir, "initial.txt"), "hello\n");
      execGit(["add", "-A"], gitDir);
      execGit(["commit", "-m", "initial"], gitDir);
    });

    afterEach(() => {
      rmSync(gitDir, { recursive: true, force: true });
    });

    test("PreToolUse/Bash + file change + PostToolUse/Bash produces snapshot file_edit", () => {
      // Pre-hook
      const pre = hook(
        "claude",
        {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          session_id: "snap-e2e-1",
          model: "claude-sonnet-4-5-20250929",
          tool_use_id: "tu-snap-1",
        },
        gitDir,
      );
      expect(pre.exitCode).toBe(0);

      // Simulate file change between pre and post
      writeFileSync(join(gitDir, "created.ts"), "const x = 42;\n");

      // Post-hook
      const post = hook(
        "claude",
        {
          hook_event_name: "PostToolUse",
          tool_name: "Bash",
          tool_input: { command: "echo create" },
          session_id: "snap-e2e-1",
          model: "claude-sonnet-4-5-20250929",
          tool_use_id: "tu-snap-1",
        },
        gitDir,
      );
      expect(post.exitCode).toBe(0);

      const traces = readJsonl(join(gitDir, ".agent-trace", "traces.jsonl"));
      // Should have at least a shell trace + file_edit trace
      expect(traces.length).toBeGreaterThanOrEqual(2);

      const fileEditTrace = traces.find(
        (t: any) =>
          t.files?.[0]?.path === "created.ts" &&
          t.metadata?.["dev.agent-trace.source"] === "vcs_snapshot",
      );
      expect(fileEditTrace).toBeDefined();
      const ranges = (fileEditTrace as any).files[0].conversations[0].ranges;
      expect(ranges.length).toBeGreaterThanOrEqual(1);
      expect(ranges[0].start_line).toBeGreaterThanOrEqual(1);
    });

    test("opencode hook:tool.execute.before + file change + hook:tool.execute.after produces snapshot file_edit", () => {
      const pre = hook(
        "opencode",
        {
          hook_event_name: "hook:tool.execute.before",
          tool_name: "bash",
          session_id: "snap-oc-1",
          call_id: "call-oc-snap-1",
        },
        gitDir,
      );
      expect(pre.exitCode).toBe(0);

      writeFileSync(join(gitDir, "oc-created.ts"), "const oc = 42;\n");

      const post = hook(
        "opencode",
        {
          hook_event_name: "hook:tool.execute.after",
          tool_name: "bash",
          session_id: "snap-oc-1",
          call_id: "call-oc-snap-1",
        },
        gitDir,
      );
      expect(post.exitCode).toBe(0);

      const traces = readJsonl(join(gitDir, ".agent-trace", "traces.jsonl"));
      const fileEditTrace = traces.find(
        (t: any) =>
          t.files?.[0]?.path === "oc-created.ts" &&
          t.metadata?.["dev.agent-trace.source"] === "vcs_snapshot",
      );
      expect(fileEditTrace).toBeDefined();
    });

    test("cursor FIFO pairing handles two sequential shell calls in same generation", () => {
      // First shell call
      hook(
        "cursor",
        {
          hook_event_name: "beforeShellExecution",
          session_id: "snap-cur-fifo",
          model: "gpt-4",
          generation_id: "gen-shared",
        },
        gitDir,
      );

      writeFileSync(join(gitDir, "cur-fifo-1.ts"), "const a = 1;\n");

      hook(
        "cursor",
        {
          hook_event_name: "afterShellExecution",
          session_id: "snap-cur-fifo",
          model: "gpt-4",
          generation_id: "gen-shared",
        },
        gitDir,
      );

      // Second shell call, same generation_id
      hook(
        "cursor",
        {
          hook_event_name: "beforeShellExecution",
          session_id: "snap-cur-fifo",
          model: "gpt-4",
          generation_id: "gen-shared",
        },
        gitDir,
      );

      writeFileSync(join(gitDir, "cur-fifo-2.ts"), "const b = 2;\n");

      hook(
        "cursor",
        {
          hook_event_name: "afterShellExecution",
          session_id: "snap-cur-fifo",
          model: "gpt-4",
          generation_id: "gen-shared",
        },
        gitDir,
      );

      const traces = readJsonl(join(gitDir, ".agent-trace", "traces.jsonl"));
      const snapshotEdits = traces.filter(
        (t: any) => t.metadata?.["dev.agent-trace.source"] === "vcs_snapshot",
      );
      const paths = snapshotEdits.map((t: any) => t.files?.[0]?.path);
      expect(paths).toContain("cur-fifo-1.ts");
      expect(paths).toContain("cur-fifo-2.ts");
    });

    test("snapshot file_edit events are redacted when file matches ignore pattern", () => {
      // Write a config with ignore pattern for .env files
      const configDir = join(gitDir, ".agent-trace");
      const { mkdirSync } = require("node:fs");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, "config.json"),
        JSON.stringify({ ignore: ["**/*.secret"], ignoreMode: "redact" }),
      );

      // Pre-hook
      hook(
        "claude",
        {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          session_id: "snap-redact",
          model: "claude-sonnet-4-5-20250929",
          tool_use_id: "tu-redact",
        },
        gitDir,
      );

      // Create ignored file
      writeFileSync(join(gitDir, "secret.secret"), "password=abc\n");
      // Create normal file
      writeFileSync(join(gitDir, "normal.ts"), "const y = 1;\n");

      // Post-hook
      hook(
        "claude",
        {
          hook_event_name: "PostToolUse",
          tool_name: "Bash",
          tool_input: { command: "echo edit" },
          session_id: "snap-redact",
          model: "claude-sonnet-4-5-20250929",
          tool_use_id: "tu-redact",
        },
        gitDir,
      );

      const traces = readJsonl(join(gitDir, ".agent-trace", "traces.jsonl"));
      const snapshotTraces = traces.filter(
        (t: any) => t.metadata?.["dev.agent-trace.source"] === "vcs_snapshot",
      );

      // Normal file should have ranges
      const normalTrace = snapshotTraces.find(
        (t: any) => t.files?.[0]?.path === "normal.ts",
      );
      expect(normalTrace).toBeDefined();
      expect(
        (normalTrace as any).files[0].conversations[0].ranges.length,
      ).toBeGreaterThanOrEqual(1);

      // Secret file should be redacted (ranges empty, redacted flag set)
      const secretTrace = snapshotTraces.find(
        (t: any) => t.files?.[0]?.path === "secret.secret",
      );
      if (secretTrace) {
        expect((secretTrace as any).metadata.redacted).toBe(true);
        expect(
          (secretTrace as any).files[0].conversations[0].ranges,
        ).toHaveLength(0);
      }
    });

    test("cursor beforeShellExecution + file change + afterShellExecution produces snapshot file_edit", () => {
      const pre = hook(
        "cursor",
        {
          hook_event_name: "beforeShellExecution",
          session_id: "snap-cursor-1",
          model: "gpt-4",
          generation_id: "gen-snap-1",
        },
        gitDir,
      );
      expect(pre.exitCode).toBe(0);

      writeFileSync(join(gitDir, "cursor-created.ts"), "const c = 99;\n");

      const post = hook(
        "cursor",
        {
          hook_event_name: "afterShellExecution",
          session_id: "snap-cursor-1",
          model: "gpt-4",
          generation_id: "gen-snap-1",
        },
        gitDir,
      );
      expect(post.exitCode).toBe(0);

      const traces = readJsonl(join(gitDir, ".agent-trace", "traces.jsonl"));
      const fileEditTrace = traces.find(
        (t: any) =>
          t.files?.[0]?.path === "cursor-created.ts" &&
          t.metadata?.["dev.agent-trace.source"] === "vcs_snapshot",
      );
      expect(fileEditTrace).toBeDefined();
    });

    test("PreToolUse + file change + PostToolUseFailure produces snapshot edits and failure shell", () => {
      const pre = hook(
        "claude",
        {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          session_id: "snap-fail-with-pre",
          model: "claude-sonnet-4-5-20250929",
          tool_use_id: "tu-fail-pre",
        },
        gitDir,
      );
      expect(pre.exitCode).toBe(0);

      writeFileSync(join(gitDir, "partial-fail.ts"), "partial write\n");

      const post = hook(
        "claude",
        {
          hook_event_name: "PostToolUseFailure",
          tool_name: "Bash",
          tool_input: { command: "failing-cmd" },
          session_id: "snap-fail-with-pre",
          model: "claude-sonnet-4-5-20250929",
          tool_use_id: "tu-fail-pre",
        },
        gitDir,
      );
      expect(post.exitCode).toBe(0);

      const traces = readJsonl(join(gitDir, ".agent-trace", "traces.jsonl"));
      const fileEdit = traces.find(
        (t: any) =>
          t.files?.[0]?.path === "partial-fail.ts" &&
          t.metadata?.["dev.agent-trace.source"] === "vcs_snapshot",
      );
      expect(fileEdit).toBeDefined();

      const failureShell = traces.find(
        (t: any) =>
          t.metadata?.["dev.agent-trace.failure"] === true &&
          t.files?.[0]?.path === ".shell-history",
      );
      expect(failureShell).toBeDefined();
    });

    test("PostToolUseFailure with missing pre-snapshot emits synthetic failure shell", () => {
      // No PreToolUse — simulate lost pre-snapshot
      const post = hook(
        "claude",
        {
          hook_event_name: "PostToolUseFailure",
          tool_name: "Bash",
          tool_input: { command: "failing-cmd" },
          session_id: "snap-fail",
          model: "claude-sonnet-4-5-20250929",
          tool_use_id: "tu-fail-missing",
        },
        gitDir,
      );
      expect(post.exitCode).toBe(0);

      const traces = readJsonl(join(gitDir, ".agent-trace", "traces.jsonl"));
      const failureShell = traces.find(
        (t: any) =>
          t.metadata?.["dev.agent-trace.failure"] === true &&
          t.files?.[0]?.path === ".shell-history",
      );
      expect(failureShell).toBeDefined();
    });
  });

  describe("error handling", () => {
    test("missing --provider exits 1", () => {
      const { exitCode, stderr } = hookRaw(
        [],
        JSON.stringify({ hook_event_name: "test" }),
        tmpDir,
      );
      expect(exitCode).toBe(1);
      expect(stderr).toContain("--provider");
    });

    test("unknown provider exits 1", () => {
      const { exitCode, stderr } = hookRaw(
        ["--provider", "nonexistent"],
        JSON.stringify({ hook_event_name: "test" }),
        tmpDir,
      );
      expect(exitCode).toBe(1);
      expect(stderr).toContain("nonexistent");
    });

    test("invalid JSON exits 1", () => {
      const { exitCode } = hookRaw(
        ["--provider", "claude"],
        "{not valid json",
        tmpDir,
      );
      expect(exitCode).toBe(1);
    });
  });
});
