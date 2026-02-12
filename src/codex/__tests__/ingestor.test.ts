import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import "../../extensions";
import {
  CodexTraceIngestor,
  clusterHunkLines,
  parsePatchInput,
} from "../ingestor";

const TEST_ROOT = join(import.meta.dir, "../../..", "tmp", "ingestor-test");

function rolloutLine(type: string, payload: Record<string, unknown>): string {
  return JSON.stringify({ timestamp: new Date().toISOString(), type, payload });
}

beforeEach(() => {
  mkdirSync(TEST_ROOT, { recursive: true });
  process.env.AGENT_TRACE_WORKSPACE_ROOT = TEST_ROOT;
});

afterEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  delete process.env.AGENT_TRACE_WORKSPACE_ROOT;
});

describe("CodexTraceIngestor", () => {
  it("processes session_meta event", () => {
    const ingestor = new CodexTraceIngestor();
    ingestor.processLine(
      rolloutLine("session_meta", {
        id: "test-session-123",
        cwd: TEST_ROOT,
        model_provider: "openai",
        cli_version: "0.98.0",
      }),
    );

    expect(ingestor.sessionId).toBe("test-session-123");
    expect(ingestor.sessionStarted).toBe(true);

    const tracesPath = join(TEST_ROOT, ".agent-trace", "traces.jsonl");
    expect(existsSync(tracesPath)).toBe(true);
    const traces = readFileSync(tracesPath, "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(traces).toHaveLength(1);
    expect(traces[0].metadata.event).toBe("session_start");
    expect(traces[0].metadata.codex_session_id).toBe("test-session-123");
  });

  it("extracts model from turn_context", () => {
    const ingestor = new CodexTraceIngestor();
    ingestor.processLine(
      rolloutLine("session_meta", { id: "s1", cwd: TEST_ROOT }),
    );

    ingestor.processLine(
      rolloutLine("turn_context", { model: "gpt-5.3-codex" }),
    );

    expect(ingestor.modelId).toBe("gpt-5.3-codex");
  });

  it("increments turn on turn_context", () => {
    const ingestor = new CodexTraceIngestor();
    ingestor.processLine(
      rolloutLine("session_meta", { id: "s1", cwd: TEST_ROOT }),
    );
    const prevTurn = ingestor.turnIndex;

    ingestor.processLine(
      rolloutLine("turn_context", { model: "gpt-5.3-codex" }),
    );

    expect(ingestor.turnIndex).toBe(prevTurn + 1);
  });

  it("processes exec_command via function_call", () => {
    const ingestor = new CodexTraceIngestor();
    ingestor.processLine(
      rolloutLine("session_meta", { id: "s1", cwd: TEST_ROOT }),
    );
    ingestor.processLine(
      rolloutLine("turn_context", { model: "gpt-5.3-codex" }),
    );
    ingestor.processLine(
      rolloutLine("response_item", {
        type: "function_call",
        name: "exec_command",
        arguments: JSON.stringify({ cmd: "ls -la", workdir: TEST_ROOT }),
        call_id: "call_123",
      }),
    );

    const tracesPath = join(TEST_ROOT, ".agent-trace", "traces.jsonl");
    const traces = readFileSync(tracesPath, "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const shellTrace = traces.find(
      (t: Record<string, unknown>) =>
        (t.metadata as Record<string, unknown>)?.command === "ls -la",
    );
    expect(shellTrace).toBeDefined();
    expect(shellTrace.files[0].path).toBe(".shell-history");
  });

  it("processes apply_patch via custom_tool_call", () => {
    const ingestor = new CodexTraceIngestor();
    ingestor.processLine(
      rolloutLine("session_meta", { id: "s1", cwd: TEST_ROOT }),
    );
    ingestor.processLine(
      rolloutLine("turn_context", { model: "gpt-5.3-codex" }),
    );
    ingestor.processLine(
      rolloutLine("response_item", {
        type: "custom_tool_call",
        name: "apply_patch",
        input:
          "*** Begin Patch\n*** Update File: src/app.ts\n@@\n-old\n+new\n*** End Patch\n",
        call_id: "call_456",
      }),
    );

    const tracesPath = join(TEST_ROOT, ".agent-trace", "traces.jsonl");
    const traces = readFileSync(tracesPath, "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const fileEdit = traces.find(
      (t: Record<string, unknown>) =>
        (t.metadata as Record<string, unknown>)?.source === "apply_patch",
    );
    expect(fileEdit).toBeDefined();
    expect(fileEdit.files[0].path).toBe("src/app.ts");
  });

  it("processes user_message via event_msg", () => {
    const ingestor = new CodexTraceIngestor();
    ingestor.processLine(
      rolloutLine("event_msg", {
        type: "user_message",
        message: "fix the bug",
      }),
    );
    expect(ingestor.pendingUserPrompt).toBe("fix the bug");
  });

  it("processes agent_message via event_msg", () => {
    const ingestor = new CodexTraceIngestor();
    ingestor.processLine(
      rolloutLine("event_msg", {
        type: "agent_message",
        message: "I fixed it",
      }),
    );
    expect(ingestor.lastAgentMessage).toBe("I fixed it");
  });

  it("snapshots and restores state", () => {
    const ingestor = new CodexTraceIngestor();
    ingestor.sessionId = "test-s1";
    ingestor.modelId = "gpt-5.3-codex";
    ingestor.turnIndex = 5;
    ingestor.pendingUserPrompt = "hello";

    const state = ingestor.snapshotState();

    const restored = new CodexTraceIngestor();
    restored.restoreState(state);

    expect(restored.sessionId).toBe("test-s1");
    expect(restored.modelId).toBe("gpt-5.3-codex");
    expect(restored.turnIndex).toBe(5);
    expect(restored.pendingUserPrompt).toBe("hello");
  });

  it("ignores invalid JSON lines", () => {
    const ingestor = new CodexTraceIngestor();
    ingestor.processLine("not json");
    ingestor.processLine("{malformed");
    expect(ingestor.sessionStarted).toBe(false);
  });

  it("ignores lines without type field", () => {
    const ingestor = new CodexTraceIngestor();
    ingestor.processLine(JSON.stringify({ foo: "bar" }));
    expect(ingestor.sessionStarted).toBe(false);
  });

  it("writes raw events", () => {
    const ingestor = new CodexTraceIngestor();
    ingestor.processLine(
      rolloutLine("session_meta", { id: "raw-test", cwd: TEST_ROOT }),
    );

    const rawPath = join(
      TEST_ROOT,
      ".agent-trace",
      "raw",
      "codex",
      "raw-test.jsonl",
    );
    expect(existsSync(rawPath)).toBe(true);
  });

  it("ignores non-apply_patch custom_tool_call", () => {
    const ingestor = new CodexTraceIngestor();
    ingestor.processLine(
      rolloutLine("session_meta", { id: "s1", cwd: TEST_ROOT }),
    );
    ingestor.processLine(
      rolloutLine("response_item", {
        type: "custom_tool_call",
        name: "other_tool",
        input: "something",
        call_id: "call_789",
      }),
    );

    const tracesPath = join(TEST_ROOT, ".agent-trace", "traces.jsonl");
    const traces = readFileSync(tracesPath, "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const fileEdits = traces.filter(
      (t: Record<string, unknown>) =>
        (t.metadata as Record<string, unknown>)?.source === "apply_patch",
    );
    expect(fileEdits).toHaveLength(0);
  });

  it("ignores non-exec_command function_call", () => {
    const ingestor = new CodexTraceIngestor();
    ingestor.processLine(
      rolloutLine("session_meta", { id: "s1", cwd: TEST_ROOT }),
    );
    ingestor.processLine(
      rolloutLine("response_item", {
        type: "function_call",
        name: "other_func",
        arguments: "{}",
        call_id: "call_999",
      }),
    );

    const tracesPath = join(TEST_ROOT, ".agent-trace", "traces.jsonl");
    const traces = readFileSync(tracesPath, "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const shellTraces = traces.filter(
      (t: Record<string, unknown>) =>
        (t.files as { path: string }[])?.[0]?.path === ".shell-history",
    );
    expect(shellTraces).toHaveLength(0);
  });

  it("parses multiple files from apply_patch", () => {
    const ingestor = new CodexTraceIngestor();
    ingestor.processLine(
      rolloutLine("session_meta", { id: "s1", cwd: TEST_ROOT }),
    );
    ingestor.processLine(
      rolloutLine("response_item", {
        type: "custom_tool_call",
        name: "apply_patch",
        input: [
          "*** Begin Patch",
          "*** Update File: src/a.ts",
          "@@",
          "-old",
          "+new",
          "*** Add File: src/b.ts",
          "@@",
          "+content",
          "*** End Patch",
        ].join("\n"),
        call_id: "call_multi",
      }),
    );

    const tracesPath = join(TEST_ROOT, ".agent-trace", "traces.jsonl");
    const traces = readFileSync(tracesPath, "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const editPaths = traces
      .filter(
        (t: Record<string, unknown>) =>
          (t.metadata as Record<string, unknown>)?.source === "apply_patch",
      )
      .map(
        (t: Record<string, unknown>) =>
          (t.files as { path: string }[])?.[0]?.path,
      );
    expect(editPaths).toContain("src/a.ts");
    expect(editPaths).toContain("src/b.ts");
  });

  it("writes messages for user_message events", () => {
    const ingestor = new CodexTraceIngestor();
    ingestor.processLine(
      rolloutLine("session_meta", { id: "msg-test", cwd: TEST_ROOT }),
    );
    ingestor.processLine(
      rolloutLine("event_msg", {
        type: "user_message",
        message: "fix the bug",
      }),
    );

    const msgPath = join(
      TEST_ROOT,
      ".agent-trace",
      "messages",
      "codex",
      "msg-test.jsonl",
    );
    expect(existsSync(msgPath)).toBe(true);
    const records = readFileSync(msgPath, "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(records).toHaveLength(1);
    expect(records[0].role).toBe("user");
    expect(records[0].content).toBe("fix the bug");
  });

  it("writes messages for agent_message events", () => {
    const ingestor = new CodexTraceIngestor();
    ingestor.processLine(
      rolloutLine("session_meta", { id: "msg-test-2", cwd: TEST_ROOT }),
    );
    ingestor.processLine(
      rolloutLine("event_msg", {
        type: "agent_message",
        message: "I fixed it",
      }),
    );

    const msgPath = join(
      TEST_ROOT,
      ".agent-trace",
      "messages",
      "codex",
      "msg-test-2.jsonl",
    );
    expect(existsSync(msgPath)).toBe(true);
    const records = readFileSync(msgPath, "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(records).toHaveLength(1);
    expect(records[0].role).toBe("assistant");
    expect(records[0].content).toBe("I fixed it");
  });

  it("apply_patch writes to diffs artifact", () => {
    const ingestor = new CodexTraceIngestor();
    ingestor.processLine(
      rolloutLine("session_meta", { id: "diff-test", cwd: TEST_ROOT }),
    );
    ingestor.processLine(
      rolloutLine("turn_context", { model: "gpt-5.3-codex" }),
    );
    ingestor.processLine(
      rolloutLine("response_item", {
        type: "custom_tool_call",
        name: "apply_patch",
        input: [
          "*** Begin Patch",
          "*** Update File: src/app.ts",
          "@@",
          "-old code",
          "+new code",
          "*** End Patch",
        ].join("\n"),
        call_id: "call_diff",
      }),
    );

    const diffPath = join(
      TEST_ROOT,
      ".agent-trace",
      "diffs",
      "codex",
      "diff-test.patch",
    );
    expect(existsSync(diffPath)).toBe(true);
    const content = readFileSync(diffPath, "utf-8");
    expect(content).toContain("-old code");
    expect(content).toContain("+new code");
  });

  it("apply_patch writes to line-hashes artifact", () => {
    const ingestor = new CodexTraceIngestor();
    ingestor.processLine(
      rolloutLine("session_meta", { id: "lh-test", cwd: TEST_ROOT }),
    );
    ingestor.processLine(
      rolloutLine("turn_context", { model: "gpt-5.3-codex" }),
    );
    ingestor.processLine(
      rolloutLine("response_item", {
        type: "custom_tool_call",
        name: "apply_patch",
        input: [
          "*** Begin Patch",
          "*** Update File: src/app.ts",
          "@@",
          "-old",
          "+new content here",
          "*** End Patch",
        ].join("\n"),
        call_id: "call_lh",
      }),
    );

    const lhPath = join(
      TEST_ROOT,
      ".agent-trace",
      "line-hashes",
      "codex",
      "lh-test.jsonl",
    );
    expect(existsSync(lhPath)).toBe(true);
    const records = readFileSync(lhPath, "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(records.length).toBeGreaterThan(0);
    expect(records[0].hashes).toBeDefined();
    expect(records[0].file).toContain("src/app.ts");
  });

  it("traces.jsonl does NOT contain metadata.unified_diff", () => {
    const ingestor = new CodexTraceIngestor();
    ingestor.processLine(
      rolloutLine("session_meta", { id: "no-ud", cwd: TEST_ROOT }),
    );
    ingestor.processLine(
      rolloutLine("turn_context", { model: "gpt-5.3-codex" }),
    );
    ingestor.processLine(
      rolloutLine("response_item", {
        type: "custom_tool_call",
        name: "apply_patch",
        input: [
          "*** Begin Patch",
          "*** Update File: src/app.ts",
          "@@",
          "-old",
          "+new",
          "*** End Patch",
        ].join("\n"),
        call_id: "call_noud",
      }),
    );

    const tracesPath = join(TEST_ROOT, ".agent-trace", "traces.jsonl");
    const traces = readFileSync(tracesPath, "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    for (const trace of traces) {
      expect(trace.metadata?.unified_diff).toBeUndefined();
    }
  });

  it("event with meta.unified_diff but empty edits does NOT produce a diff artifact", () => {
    const ingestor = new CodexTraceIngestor();
    ingestor.processLine(
      rolloutLine("session_meta", { id: "no-precomp", cwd: TEST_ROOT }),
    );
    ingestor.processLine(
      rolloutLine("turn_context", { model: "gpt-5.3-codex" }),
    );

    // Simulate a Delete File with no hunks (produces empty edits)
    ingestor.processLine(
      rolloutLine("response_item", {
        type: "custom_tool_call",
        name: "apply_patch",
        input: [
          "*** Begin Patch",
          "*** Delete File: src/dead.ts",
          "*** End Patch",
        ].join("\n"),
        call_id: "call_del",
      }),
    );

    const diffPath = join(
      TEST_ROOT,
      ".agent-trace",
      "diffs",
      "codex",
      "no-precomp.patch",
    );
    expect(existsSync(diffPath)).toBe(false);
  });
});

describe("parsePatchInput", () => {
  it("parses a single file with one hunk", () => {
    const input = [
      "*** Begin Patch",
      "*** Update File: src/app.ts",
      "@@",
      "-old line",
      "+new line",
      "*** End Patch",
    ].join("\n");

    const result = parsePatchInput(input);
    expect(result.size).toBe(1);
    const edits = result.get("src/app.ts");
    expect(edits).toHaveLength(1);
    expect(edits?.[0]?.old_string).toBe("old line");
    expect(edits?.[0]?.new_string).toBe("new line");
  });

  it("parses multiple files", () => {
    const input = [
      "*** Begin Patch",
      "*** Update File: src/a.ts",
      "@@",
      "-old",
      "+new",
      "*** Add File: src/b.ts",
      "@@",
      "+content",
      "*** End Patch",
    ].join("\n");

    const result = parsePatchInput(input);
    expect(result.size).toBe(2);
    expect(result.get("src/a.ts")?.[0]?.old_string).toBe("old");
    expect(result.get("src/a.ts")?.[0]?.new_string).toBe("new");
    expect(result.get("src/b.ts")?.[0]?.old_string).toBe("");
    expect(result.get("src/b.ts")?.[0]?.new_string).toBe("content");
  });

  it("returns empty map for no files", () => {
    const result = parsePatchInput("some random text");
    expect(result.size).toBe(0);
  });

  it("parses multiple hunks in one file", () => {
    const input = [
      "*** Update File: src/app.ts",
      "@@",
      "-a",
      "+b",
      "@@",
      "-c",
      "+d",
    ].join("\n");

    const result = parsePatchInput(input);
    const edits = result.get("src/app.ts");
    expect(edits).toHaveLength(2);
    expect(edits?.[0]?.old_string).toBe("a");
    expect(edits?.[0]?.new_string).toBe("b");
    expect(edits?.[1]?.old_string).toBe("c");
    expect(edits?.[1]?.new_string).toBe("d");
  });

  it("handles context lines (space-prefixed)", () => {
    const input = [
      "*** Update File: src/app.ts",
      "@@",
      " context before",
      "-old line",
      "+new line",
      " context after",
    ].join("\n");

    const result = parsePatchInput(input);
    const edits = result.get("src/app.ts");
    expect(edits).toHaveLength(1);
    expect(edits?.[0]?.old_string).toBe(
      "context before\nold line\ncontext after",
    );
    expect(edits?.[0]?.new_string).toBe(
      "context before\nnew line\ncontext after",
    );
  });

  it("handles duplicate file paths (appends edits)", () => {
    const input = [
      "*** Begin Patch",
      "*** Update File: src/app.ts",
      "@@",
      "-first old",
      "+first new",
      "*** Update File: src/app.ts",
      "@@",
      "-second old",
      "+second new",
      "*** End Patch",
    ].join("\n");

    const result = parsePatchInput(input);
    expect(result.size).toBe(1);
    const edits = result.get("src/app.ts");
    expect(edits).toHaveLength(2);
    expect(edits?.[0]?.old_string).toBe("first old");
    expect(edits?.[0]?.new_string).toBe("first new");
    expect(edits?.[1]?.old_string).toBe("second old");
    expect(edits?.[1]?.new_string).toBe("second new");
  });

  it("handles Add File without @@ header", () => {
    const input = [
      "*** Begin Patch",
      "*** Add File: src/new.ts",
      "+export const x = 1;",
      "+export const y = 2;",
      "*** End Patch",
    ].join("\n");

    const result = parsePatchInput(input);
    expect(result.size).toBe(1);
    const edits = result.get("src/new.ts");
    expect(edits).toHaveLength(1);
    expect(edits?.[0]?.old_string).toBe("");
    expect(edits?.[0]?.new_string).toBe(
      "export const x = 1;\nexport const y = 2;",
    );
  });

  it("Delete File with no hunks produces empty edits", () => {
    const input = [
      "*** Begin Patch",
      "*** Delete File: src/dead.ts",
      "*** End Patch",
    ].join("\n");

    const result = parsePatchInput(input);
    expect(result.size).toBe(1);
    const edits = result.get("src/dead.ts");
    expect(edits).toHaveLength(0);
  });

  it("splits distant changes into separate edits", () => {
    // Two changes separated by 8 context lines (> MERGE_GAP=6) -> 2 edits
    const input = [
      "*** Update File: src/app.ts",
      "@@",
      " ctx1",
      " ctx2",
      "-old A",
      "+new A",
      " gap1",
      " gap2",
      " gap3",
      " gap4",
      " gap5",
      " gap6",
      " gap7",
      " gap8",
      "-old B",
      "+new B",
      " ctx3",
    ].join("\n");

    const result = parsePatchInput(input);
    const edits = result.get("src/app.ts");
    expect(edits).toHaveLength(2);
    // First edit: 2 ctx before, change A, 3 ctx after
    expect(edits?.[0]?.old_string).toBe("ctx1\nctx2\nold A\ngap1\ngap2\ngap3");
    expect(edits?.[0]?.new_string).toBe("ctx1\nctx2\nnew A\ngap1\ngap2\ngap3");
    // Second edit: 3 ctx before, change B, 1 ctx after
    expect(edits?.[1]?.old_string).toBe("gap6\ngap7\ngap8\nold B\nctx3");
    expect(edits?.[1]?.new_string).toBe("gap6\ngap7\ngap8\nnew B\nctx3");
  });

  it("merges close changes into one edit", () => {
    // Two changes separated by 4 context lines (<= MERGE_GAP=6) -> 1 edit
    const input = [
      "*** Update File: src/app.ts",
      "@@",
      "-old A",
      "+new A",
      " gap1",
      " gap2",
      " gap3",
      " gap4",
      "-old B",
      "+new B",
    ].join("\n");

    const result = parsePatchInput(input);
    const edits = result.get("src/app.ts");
    expect(edits).toHaveLength(1);
    expect(edits?.[0]?.old_string).toBe("old A\ngap1\ngap2\ngap3\ngap4\nold B");
    expect(edits?.[0]?.new_string).toBe("new A\ngap1\ngap2\ngap3\ngap4\nnew B");
  });

  it("pure context block produces no edits", () => {
    const input = [
      "*** Update File: src/app.ts",
      "@@",
      " line1",
      " line2",
      " line3",
    ].join("\n");

    const result = parsePatchInput(input);
    const edits = result.get("src/app.ts");
    expect(edits).toHaveLength(0);
  });
});

describe("clusterHunkLines", () => {
  it("single change with surrounding context", () => {
    const lines = [
      { type: "context" as const, text: "a" },
      { type: "context" as const, text: "b" },
      { type: "context" as const, text: "c" },
      { type: "context" as const, text: "d" },
      { type: "del" as const, text: "old" },
      { type: "add" as const, text: "new" },
      { type: "context" as const, text: "e" },
      { type: "context" as const, text: "f" },
      { type: "context" as const, text: "g" },
      { type: "context" as const, text: "h" },
    ];

    const edits = clusterHunkLines(lines);
    expect(edits).toHaveLength(1);
    // 3 context before (b,c,d), change, 3 context after (e,f,g)
    expect(edits[0]?.old_string).toBe("b\nc\nd\nold\ne\nf\ng");
    expect(edits[0]?.new_string).toBe("b\nc\nd\nnew\ne\nf\ng");
  });

  it("two distant changes produce two edits", () => {
    const lines = [
      { type: "del" as const, text: "old1" },
      { type: "add" as const, text: "new1" },
      ...Array.from({ length: 8 }, (_, i) => ({
        type: "context" as const,
        text: `gap${i}`,
      })),
      { type: "del" as const, text: "old2" },
      { type: "add" as const, text: "new2" },
    ];

    const edits = clusterHunkLines(lines);
    expect(edits).toHaveLength(2);
    expect(edits[0]?.old_string).toBe("old1\ngap0\ngap1\ngap2");
    expect(edits[0]?.new_string).toBe("new1\ngap0\ngap1\ngap2");
    expect(edits[1]?.old_string).toBe("gap5\ngap6\ngap7\nold2");
    expect(edits[1]?.new_string).toBe("gap5\ngap6\ngap7\nnew2");
  });

  it("two close changes merge into one edit", () => {
    const lines = [
      { type: "del" as const, text: "old1" },
      { type: "add" as const, text: "new1" },
      { type: "context" as const, text: "g1" },
      { type: "context" as const, text: "g2" },
      { type: "del" as const, text: "old2" },
      { type: "add" as const, text: "new2" },
    ];

    const edits = clusterHunkLines(lines);
    expect(edits).toHaveLength(1);
    expect(edits[0]?.old_string).toBe("old1\ng1\ng2\nold2");
    expect(edits[0]?.new_string).toBe("new1\ng1\ng2\nnew2");
  });

  it("change at start with fewer than 3 context before", () => {
    const lines = [
      { type: "context" as const, text: "a" },
      { type: "del" as const, text: "old" },
      { type: "add" as const, text: "new" },
      { type: "context" as const, text: "b" },
      { type: "context" as const, text: "c" },
      { type: "context" as const, text: "d" },
      { type: "context" as const, text: "e" },
    ];

    const edits = clusterHunkLines(lines);
    expect(edits).toHaveLength(1);
    expect(edits[0]?.old_string).toBe("a\nold\nb\nc\nd");
    expect(edits[0]?.new_string).toBe("a\nnew\nb\nc\nd");
  });

  it("change at end with fewer than 3 context after", () => {
    const lines = [
      { type: "context" as const, text: "a" },
      { type: "context" as const, text: "b" },
      { type: "context" as const, text: "c" },
      { type: "context" as const, text: "d" },
      { type: "del" as const, text: "old" },
      { type: "add" as const, text: "new" },
      { type: "context" as const, text: "e" },
    ];

    const edits = clusterHunkLines(lines);
    expect(edits).toHaveLength(1);
    expect(edits[0]?.old_string).toBe("b\nc\nd\nold\ne");
    expect(edits[0]?.new_string).toBe("b\nc\nd\nnew\ne");
  });

  it("pure context returns empty array", () => {
    const lines = [
      { type: "context" as const, text: "a" },
      { type: "context" as const, text: "b" },
    ];

    expect(clusterHunkLines(lines)).toHaveLength(0);
  });

  it("all changes no context returns one edit", () => {
    const lines = [
      { type: "del" as const, text: "a" },
      { type: "del" as const, text: "b" },
      { type: "add" as const, text: "c" },
      { type: "add" as const, text: "d" },
    ];

    const edits = clusterHunkLines(lines);
    expect(edits).toHaveLength(1);
    expect(edits[0]?.old_string).toBe("a\nb");
    expect(edits[0]?.new_string).toBe("c\nd");
  });

  it("gap exactly at MERGE_GAP boundary merges", () => {
    const lines = [
      { type: "del" as const, text: "old1" },
      ...Array.from({ length: 6 }, (_, i) => ({
        type: "context" as const,
        text: `g${i}`,
      })),
      { type: "del" as const, text: "old2" },
    ];

    const edits = clusterHunkLines(lines);
    expect(edits).toHaveLength(1);
    expect(edits[0]?.old_string).toBe("old1\ng0\ng1\ng2\ng3\ng4\ng5\nold2");
  });

  it("gap one above MERGE_GAP splits", () => {
    const lines = [
      { type: "del" as const, text: "old1" },
      ...Array.from({ length: 7 }, (_, i) => ({
        type: "context" as const,
        text: `g${i}`,
      })),
      { type: "del" as const, text: "old2" },
    ];

    const edits = clusterHunkLines(lines);
    expect(edits).toHaveLength(2);
  });
});
