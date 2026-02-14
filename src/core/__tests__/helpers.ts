import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
import {
  _resetContextCache,
  _resetProviderCache,
  type HookResult,
  processHookInput,
  registerBuiltinExtensions,
  registerBuiltinProviders,
} from "../testing";
import type { HookInput } from "../types";

// --- Git repo helper ---

export function initAgentTrace(dir: string): void {
  const configDir = join(dir, ".agent-trace");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "config.json"), "{}", "utf-8");
}

export function createTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-trace-e2e-"));
  execGit(["init", "--initial-branch=main"], dir);
  execGit(["config", "user.email", "test@test.com"], dir);
  execGit(["config", "user.name", "Test"], dir);
  initAgentTrace(dir);
  writeFileSync(join(dir, "initial.txt"), "hello\n");
  execGit(["add", "-A"], dir);
  execGit(["commit", "-m", "initial"], dir);
  return dir;
}

export function execGit(args: string[], cwd: string): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error(`git ${args[0]} failed: ${result.stderr}`);
  }
  return (result.stdout ?? "").trim();
}

// --- Snapshot state cleanup ---

function repoHash(repoRoot: string): string {
  return createHash("sha256").update(repoRoot).digest("hex").slice(0, 32);
}

export function cleanupSnapshotState(repoRoot: string): void {
  const dir = join(tmpdir(), "agent-trace", repoHash(repoRoot));
  rmSync(dir, { recursive: true, force: true });
}

// --- In-process runner ---

export function initRegistries(): void {
  registerBuiltinProviders();
  registerBuiltinExtensions();
}

export async function runInProcess(
  provider: string,
  input: Record<string, unknown>,
  root: string,
): Promise<HookResult> {
  _resetContextCache();
  _resetProviderCache();
  return processHookInput(provider, input as unknown as HookInput, {
    workspaceRoot: root,
  });
}

// --- Payload builders ---

let callCounter = 0;
function nextId(prefix: string): string {
  return `${prefix}-${++callCounter}`;
}

export function claudePreBash(
  opts?: Record<string, unknown>,
): Record<string, unknown> {
  const id = nextId("tu");
  return {
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    session_id: "test-session",
    model: "claude-sonnet-4-5-20250929",
    tool_use_id: id,
    ...opts,
  };
}

export function claudePostBash(
  command: string,
  opts?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command },
    session_id: "test-session",
    model: "claude-sonnet-4-5-20250929",
    tool_use_id: nextId("tu"),
    ...opts,
  };
}

export function claudePostBashFailure(
  command: string,
  opts?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    hook_event_name: "PostToolUseFailure",
    tool_name: "Bash",
    tool_input: { command },
    session_id: "test-session",
    model: "claude-sonnet-4-5-20250929",
    tool_use_id: nextId("tu"),
    ...opts,
  };
}

export function claudeEdit(
  file: string,
  oldStr: string,
  newStr: string,
  opts?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    hook_event_name: "PostToolUse",
    tool_name: "Edit",
    tool_input: { file_path: file, old_string: oldStr, new_string: newStr },
    session_id: "test-session",
    model: "claude-sonnet-4-5-20250929",
    tool_use_id: nextId("tu"),
    ...opts,
  };
}

export function cursorBeforeShell(
  opts?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    hook_event_name: "beforeShellExecution",
    session_id: "test-session",
    model: "gpt-4",
    generation_id: nextId("gen"),
    ...opts,
  };
}

export function cursorAfterShell(
  opts?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    hook_event_name: "afterShellExecution",
    session_id: "test-session",
    model: "gpt-4",
    generation_id: nextId("gen"),
    ...opts,
  };
}

export function cursorFileEdit(
  file: string,
  edits: Array<{ old_string: string; new_string: string }>,
  opts?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    hook_event_name: "afterFileEdit",
    file_path: file,
    edits,
    session_id: "test-session",
    model: "gpt-4",
    ...opts,
  };
}

export function opencodePreBash(
  opts?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    hook_event_name: "hook:tool.execute.before",
    tool_name: "bash",
    session_id: "test-session",
    call_id: nextId("call"),
    ...opts,
  };
}

export function opencodePostBash(
  command: string,
  opts?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    hook_event_name: "hook:tool.execute.after",
    tool_name: "bash",
    command,
    session_id: "test-session",
    call_id: nextId("call"),
    ...opts,
  };
}

// --- Assertion helpers ---

export function readTraces(root: string): any[] {
  const path = join(root, ".agent-trace", "traces.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function readArtifact(
  root: string,
  type: "diffs" | "line-hashes" | "raw" | "messages",
  provider: string,
  session: string,
): string | any[] | undefined {
  const ext = type === "diffs" ? "patch" : "jsonl";
  const path = join(root, ".agent-trace", type, provider, `${session}.${ext}`);
  if (!existsSync(path)) return undefined;
  const content = readFileSync(path, "utf-8");
  if (ext === "jsonl") {
    return content
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  }
  return content;
}

export function findSnapshotTrace(
  traces: any[],
  filePath: string,
): any | undefined {
  return traces.find(
    (t) =>
      t.files?.[0]?.path === filePath &&
      t.metadata?.["dev.agent-trace.source"] === "vcs_snapshot",
  );
}

export function findShellTrace(
  traces: any[],
  predicate?: (t: any) => boolean,
): any | undefined {
  return traces.find(
    (t) =>
      t.files?.[0]?.path === ".shell-history" && (!predicate || predicate(t)),
  );
}
