import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "agent-trace-integration-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("runHook integration", () => {
  describe("claude provider", () => {
    test("PostToolUse/Edit produces trace + diff + raw event", () => {
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

  describe("error handling", () => {
    test("empty stdin exits 0", () => {
      const { exitCode } = hookRaw(["--provider", "claude"], "", tmpDir);
      expect(exitCode).toBe(0);
    });

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
