import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionContext,
  MessageEvent,
  PipelineEvent,
} from "../../core/types";
import { ensureParent } from "../../core/utils";
import { appendMessage, messagesExtension } from "../messages";

let appendCalls = 0;

function makeCtx(root: string): ExtensionContext {
  return {
    root,
    appendJsonl(path, value) {
      appendCalls++;
      ensureParent(path);
      appendFileSync(path, `${JSON.stringify(value)}\n`, "utf-8");
    },
    appendText(path, text) {
      ensureParent(path);
      appendFileSync(path, text, "utf-8");
    },
    tryReadFile(path) {
      try {
        return readFileSync(path, "utf-8");
      } catch {
        return undefined;
      }
    },
  };
}

function readJsonl(path: string): Record<string, unknown>[] {
  return readFileSync(path, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("appendMessage", () => {
  let tmpDir: string;
  let ctx: ExtensionContext;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-trace-msg-"));
    mkdirSync(join(tmpDir, ".agent-trace"), { recursive: true });
    ctx = makeCtx(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("writes JSONL to correct path with expected fields", () => {
    const result = appendMessage(
      "claude",
      "session-123",
      {
        role: "user",
        content: "Hello",
        event: "UserPromptSubmit",
      },
      ctx,
    );

    const expected = join(
      tmpDir,
      ".agent-trace",
      "messages",
      "claude",
      "session-123.jsonl",
    );
    expect(result).toBe(expected);

    const records = readJsonl(expected);
    expect(records).toHaveLength(1);
    expect(records[0]?.provider).toBe("claude");
    expect(records[0]?.session_id).toBe("session-123");
    expect(records[0]?.role).toBe("user");
    expect(records[0]?.content).toBe("Hello");
    expect(records[0]?.event).toBe("UserPromptSubmit");
    expect(records[0]?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(records[0]?.timestamp).toBeDefined();
  });

  test("sanitizes session ID with special characters", () => {
    const result = appendMessage(
      "claude",
      "ses/sion:with@bad!chars",
      { role: "assistant", content: "Hi", event: "PostToolUse" },
      ctx,
    );

    expect(result).toContain("ses_sion_with_bad_chars.jsonl");
    const records = readJsonl(result);
    expect(records[0]?.session_id).toBe("ses_sion_with_bad_chars");
  });

  test("undefined sessionId falls back to 'unknown'", () => {
    const result = appendMessage(
      "claude",
      undefined,
      { role: "user", content: "test", event: "UserPromptSubmit" },
      ctx,
    );

    expect(result).toContain("unknown.jsonl");
    const records = readJsonl(result);
    expect(records[0]?.session_id).toBe("unknown");
  });

  test("empty string sessionId falls back to 'unknown'", () => {
    const result = appendMessage(
      "claude",
      "",
      { role: "user", content: "test", event: "UserPromptSubmit" },
      ctx,
    );

    expect(result).toContain("unknown.jsonl");
    const records = readJsonl(result);
    expect(records[0]?.session_id).toBe("unknown");
  });

  test("whitespace-only sessionId falls back to 'unknown'", () => {
    const result = appendMessage(
      "claude",
      "   ",
      { role: "user", content: "test", event: "UserPromptSubmit" },
      ctx,
    );

    expect(result).toContain("unknown.jsonl");
    const records = readJsonl(result);
    expect(records[0]?.session_id).toBe("unknown");
  });
});

describe("messagesExtension.onTraceEvent", () => {
  let tmpDir: string;
  let ctx: ExtensionContext;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-trace-msg-ext-"));
    mkdirSync(join(tmpDir, ".agent-trace"), { recursive: true });
    appendCalls = 0;
    ctx = makeCtx(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("ignores non-message events — appendJsonl never called", () => {
    const shellEvent: PipelineEvent = {
      kind: "shell",
      provider: "claude",
      sessionId: "s1",
      meta: {},
    };

    messagesExtension.onTraceEvent?.(shellEvent, ctx);

    expect(appendCalls).toBe(0);
    const msgDir = join(tmpDir, ".agent-trace", "messages");
    expect(existsSync(msgDir)).toBe(false);
  });

  test("message event with non-empty meta includes metadata", () => {
    const event: MessageEvent = {
      kind: "message",
      provider: "claude",
      sessionId: "s1",
      model: "claude-sonnet-4-5-20250929",
      eventName: "UserPromptSubmit",
      role: "user",
      content: "Hello world",
      meta: { custom_key: "custom_value" },
    };

    messagesExtension.onTraceEvent?.(event, ctx);

    const records = readJsonl(
      join(tmpDir, ".agent-trace", "messages", "claude", "s1.jsonl"),
    );
    expect(records).toHaveLength(1);
    expect(records[0]?.metadata).toEqual({ custom_key: "custom_value" });
    expect(records[0]?.model_id).toBe("claude-sonnet-4-5-20250929");
  });

  test("message event with empty meta omits metadata key entirely", () => {
    const event: MessageEvent = {
      kind: "message",
      provider: "claude",
      sessionId: "s1",
      eventName: "UserPromptSubmit",
      role: "user",
      content: "Hello",
      meta: {},
    };

    messagesExtension.onTraceEvent?.(event, ctx);

    const records = readJsonl(
      join(tmpDir, ".agent-trace", "messages", "claude", "s1.jsonl"),
    );
    expect(records).toHaveLength(1);
    expect("metadata" in (records[0] ?? {})).toBe(false);
  });

  test("model_id populated from event.model", () => {
    const event: MessageEvent = {
      kind: "message",
      provider: "cursor",
      sessionId: "s1",
      model: "gpt-4",
      eventName: "beforeSubmitPrompt",
      role: "user",
      content: "Test",
      meta: {},
    };

    messagesExtension.onTraceEvent?.(event, ctx);

    const records = readJsonl(
      join(tmpDir, ".agent-trace", "messages", "cursor", "s1.jsonl"),
    );
    expect(records[0]?.model_id).toBe("gpt-4");
  });

  test("absent model omits model_id key entirely", () => {
    const event: MessageEvent = {
      kind: "message",
      provider: "claude",
      sessionId: "s1",
      eventName: "UserPromptSubmit",
      role: "user",
      content: "Hello",
      meta: {},
    };

    messagesExtension.onTraceEvent?.(event, ctx);

    const records = readJsonl(
      join(tmpDir, ".agent-trace", "messages", "claude", "s1.jsonl"),
    );
    // model_id should not be present as a key (JSON serialization drops undefined)
    expect("model_id" in (records[0] ?? {})).toBe(false);
  });

  test("message event forwards role, content, and event correctly", () => {
    const event: MessageEvent = {
      kind: "message",
      provider: "claude",
      sessionId: "s1",
      eventName: "PostToolUse",
      role: "assistant",
      content: "response text",
      meta: {},
    };

    messagesExtension.onTraceEvent?.(event, ctx);

    const records = readJsonl(
      join(tmpDir, ".agent-trace", "messages", "claude", "s1.jsonl"),
    );
    expect(records[0]?.role).toBe("assistant");
    expect(records[0]?.content).toBe("response text");
    expect(records[0]?.event).toBe("PostToolUse");
  });
});
