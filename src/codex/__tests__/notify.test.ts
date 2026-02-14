import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { handleNotify } from "../notify";

const TEST_ROOT = join(import.meta.dir, "../../..", "tmp", "notify-test");
const CODEX_HOME = join(TEST_ROOT, ".codex-home");
const PROJECT_DIR = join(TEST_ROOT, "project");

function rolloutLine(type: string, payload: Record<string, unknown>): string {
  return JSON.stringify({ timestamp: new Date().toISOString(), type, payload });
}

beforeEach(() => {
  mkdirSync(PROJECT_DIR, { recursive: true });
  mkdirSync(CODEX_HOME, { recursive: true });
  const configDir = join(PROJECT_DIR, ".agent-trace");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "config.json"), "{}", "utf-8");
  process.env.CODEX_HOME = CODEX_HOME;
  process.env.AGENT_TRACE_WORKSPACE_ROOT = PROJECT_DIR;
});

afterEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  delete process.env.CODEX_HOME;
  delete process.env.AGENT_TRACE_WORKSPACE_ROOT;
});

function writeRollout(threadId: string, lines: string[]): string {
  const dir = join(CODEX_HOME, "sessions", "2025", "01", "01");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `rollout-12345-${threadId}.jsonl`);
  writeFileSync(path, `${lines.join("\n")}\n`, "utf-8");
  return path;
}

describe("handleNotify", () => {
  it("returns 1 for invalid JSON", async () => {
    const code = await handleNotify("not json");
    expect(code).toBe(1);
  });

  it("returns 1 for missing thread-id", async () => {
    const code = await handleNotify(
      JSON.stringify({ type: "agent-turn-complete" }),
    );
    expect(code).toBe(1);
  });

  it("returns 1 when rollout file not found", async () => {
    const code = await handleNotify(
      JSON.stringify({
        type: "agent-turn-complete",
        "thread-id": "nonexistent",
      }),
    );
    expect(code).toBe(1);
  });

  it("processes rollout file and creates traces", async () => {
    const threadId = "test-thread-abc";
    writeRollout(threadId, [
      rolloutLine("session_meta", {
        id: threadId,
        cwd: PROJECT_DIR,
        model_provider: "openai",
        cli_version: "0.98.0",
      }),
    ]);

    const code = await handleNotify(
      JSON.stringify({
        type: "agent-turn-complete",
        "thread-id": threadId,
        cwd: PROJECT_DIR,
      }),
    );

    expect(code).toBe(0);

    const tracesPath = join(PROJECT_DIR, ".agent-trace", "traces.jsonl");
    expect(existsSync(tracesPath)).toBe(true);
  });

  it("saves and resumes state across calls", async () => {
    const threadId = "resume-thread";
    writeRollout(threadId, [
      rolloutLine("session_meta", {
        id: threadId,
        cwd: PROJECT_DIR,
        model_provider: "openai",
        cli_version: "0.98.0",
      }),
    ]);

    await handleNotify(
      JSON.stringify({
        type: "agent-turn-complete",
        "thread-id": threadId,
        cwd: PROJECT_DIR,
      }),
    );

    const statePath = join(
      CODEX_HOME,
      "agent-trace",
      "state",
      `${threadId}.json`,
    );
    expect(existsSync(statePath)).toBe(true);

    const code = await handleNotify(
      JSON.stringify({
        type: "agent-turn-complete",
        "thread-id": threadId,
        cwd: PROJECT_DIR,
      }),
    );
    expect(code).toBe(0);
  });
});
