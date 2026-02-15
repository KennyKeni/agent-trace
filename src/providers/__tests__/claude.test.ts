import { describe, expect, test } from "bun:test";
import type { ClaudeHookInput } from "../claude";
import { adapt, sessionIdFor } from "../claude";

function makeInput(overrides: Partial<ClaudeHookInput>): ClaudeHookInput {
  return {
    hook_event_name: "UserPromptSubmit",
    session_id: "test-session",
    model: "claude-sonnet-4-5-20250929",
    ...overrides,
  } as ClaudeHookInput;
}

describe("claude sessionIdFor", () => {
  test("prefers session_id", () => {
    expect(
      sessionIdFor({
        hook_event_name: "PostToolUse",
        session_id: "s1",
        conversation_id: "c1",
        generation_id: "g1",
      }),
    ).toBe("s1");
  });

  test("falls back to conversation_id", () => {
    expect(
      sessionIdFor({
        hook_event_name: "PostToolUse",
        conversation_id: "c1",
        generation_id: "g1",
      }),
    ).toBe("c1");
  });

  test("falls back to generation_id", () => {
    expect(
      sessionIdFor({ hook_event_name: "PostToolUse", generation_id: "g1" }),
    ).toBe("g1");
  });

  test("returns undefined when nothing present", () => {
    expect(sessionIdFor({ hook_event_name: "PostToolUse" })).toBeUndefined();
  });
});

describe("claude adapt – UserPromptSubmit", () => {
  test("extracts text from prompt field", () => {
    const result = adapt(makeInput({ prompt: "hello from prompt" }));
    expect(result).toMatchObject({
      kind: "message",
      provider: "claude",
      sessionId: "test-session",
      role: "user",
      content: "hello from prompt",
      eventName: "UserPromptSubmit",
    });
  });

  test("falls back to message field", () => {
    const result = adapt(makeInput({ message: "hello from message" }));
    expect(result).toMatchObject({
      kind: "message",
      content: "hello from message",
    });
  });

  test("falls back to content field", () => {
    const result = adapt(makeInput({ content: "hello from content" }));
    expect(result).toMatchObject({
      kind: "message",
      content: "hello from content",
    });
  });

  test("prompt takes priority over message and content", () => {
    const result = adapt(
      makeInput({
        prompt: "from prompt",
        message: "from message",
        content: "from content",
      }),
    );
    expect(result).toMatchObject({ content: "from prompt" });
  });

  test("returns undefined when no text fields present", () => {
    const result = adapt(makeInput({}));
    expect(result).toBeUndefined();
  });

  test("uses normalized model", () => {
    const result = adapt(makeInput({ prompt: "hi" }));
    expect(result).toMatchObject({
      model: "anthropic/claude-sonnet-4-5-20250929",
    });
  });

  test("uses computed sessionId", () => {
    const result = adapt(
      makeInput({
        prompt: "hi",
        session_id: undefined,
        conversation_id: "conv-1",
      }),
    );
    expect(result).toMatchObject({ sessionId: "conv-1" });
  });
});

describe("claude adapt – PreToolUse", () => {
  test("returns undefined for PreToolUse", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
      }),
    );
    expect(result).toBeUndefined();
  });
});

describe("claude adapt – PostToolUse (Bash)", () => {
  test("returns shell event", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "ls -la" },
        tool_use_id: "tu-1",
      }),
    );
    expect(result).toMatchObject({
      kind: "shell",
      provider: "claude",
      sessionId: "test-session",
      model: "anthropic/claude-sonnet-4-5-20250929",
      meta: {
        session_id: "test-session",
        tool_name: "Bash",
        tool_use_id: "tu-1",
        command: "ls -la",
      },
    });
    expect(result).not.toHaveProperty("eventName");
  });

  test("passes transcript_path in meta when provided", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "echo hi" },
        transcript_path: "/tmp/transcript.json",
      }),
    );
    expect((result as any).meta.transcript_path).toBe("/tmp/transcript.json");
  });
});

describe("claude adapt – PostToolUse (Write)", () => {
  test("returns file_edit with content fallback", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "PostToolUse",
        tool_name: "Write",
        tool_input: { file_path: "/tmp/test.ts", content: "new file content" },
      }),
    );
    expect(result).toMatchObject({
      kind: "file_edit",
      provider: "claude",
      sessionId: "test-session",
      filePath: "/tmp/test.ts",
      edits: [{ old_string: "", new_string: "new file content" }],
      eventName: "PostToolUse",
      meta: { session_id: "test-session", tool_name: "Write" },
    });
  });

  test("uses normalized model", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "PostToolUse",
        tool_name: "Write",
        tool_input: { file_path: "/tmp/t.ts", content: "x" },
      }),
    );
    expect(result).toMatchObject({
      model: "anthropic/claude-sonnet-4-5-20250929",
    });
  });

  test("passes transcript_path in meta when provided", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "PostToolUse",
        tool_name: "Write",
        tool_input: { file_path: "/tmp/t.ts", content: "x" },
        transcript_path: "/tmp/transcript.json",
      }),
    );
    expect((result as any).meta.transcript_path).toBe("/tmp/transcript.json");
  });
});

describe("claude adapt – PostToolUse (Edit)", () => {
  test("returns file_edit with old and new string", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "PostToolUse",
        tool_name: "Edit",
        tool_input: {
          file_path: "/tmp/test.ts",
          old_string: "old",
          new_string: "new",
        },
      }),
    );
    expect(result).toMatchObject({
      kind: "file_edit",
      eventName: "PostToolUse",
      edits: [{ old_string: "old", new_string: "new" }],
      meta: { session_id: "test-session", tool_name: "Edit" },
    });
  });

  test("uses originalFile fallback for old_string", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "PostToolUse",
        tool_name: "Edit",
        tool_input: { file_path: "/tmp/test.ts", new_string: "new" },
        tool_response: { originalFile: "original content" },
      }),
    );
    expect(result).toMatchObject({
      edits: [{ old_string: "original content", new_string: "new" }],
    });
  });

  test("defaults file_path to .unknown", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "PostToolUse",
        tool_name: "Edit",
        tool_input: { new_string: "x" },
      }),
    );
    expect(result).toMatchObject({
      filePath: ".unknown",
    });
  });

  test("returns empty edits when no new content", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "PostToolUse",
        tool_name: "Edit",
        tool_input: { file_path: "/tmp/t.ts" },
      }),
    );
    expect(result).toMatchObject({ edits: [] });
  });
});

describe("claude adapt – PostToolUse (unrecognized tool)", () => {
  test("returns undefined for unknown tools", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "PostToolUse",
        tool_name: "Read",
      }),
    );
    expect(result).toBeUndefined();
  });
});

describe("claude adapt – SessionStart", () => {
  test("returns session_start event", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "SessionStart",
        source: "cli",
      }),
    );
    expect(result).toMatchObject({
      kind: "session_start",
      provider: "claude",
      sessionId: "test-session",
      meta: { session_id: "test-session", source: "cli" },
    });
    expect(result).not.toHaveProperty("eventName");
  });

  test("uses normalized model", () => {
    const result = adapt(makeInput({ hook_event_name: "SessionStart" }));
    expect(result).toMatchObject({
      model: "anthropic/claude-sonnet-4-5-20250929",
    });
  });
});

describe("claude adapt – SessionEnd", () => {
  test("returns session_end event", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "SessionEnd",
        reason: "user_exit",
      }),
    );
    expect(result).toMatchObject({
      kind: "session_end",
      provider: "claude",
      sessionId: "test-session",
      meta: { session_id: "test-session", reason: "user_exit" },
    });
    expect(result).not.toHaveProperty("eventName");
  });

  test("uses normalized model", () => {
    const result = adapt(makeInput({ hook_event_name: "SessionEnd" }));
    expect(result).toMatchObject({
      model: "anthropic/claude-sonnet-4-5-20250929",
    });
  });
});

describe("claude adapt – unknown event", () => {
  test("returns undefined", () => {
    const result = adapt(makeInput({ hook_event_name: "SomeUnknownEvent" }));
    expect(result).toBeUndefined();
  });
});

describe("normalizeModelId via adapt", () => {
  test("normalizes bare o1 model", () => {
    const result = adapt(makeInput({ prompt: "hi", model: "o1" }));
    expect(result).toMatchObject({ model: "openai/o1" });
  });

  test("normalizes bare o3 model", () => {
    const result = adapt(makeInput({ prompt: "hi", model: "o3" }));
    expect(result).toMatchObject({ model: "openai/o3" });
  });

  test("normalizes o1-mini model", () => {
    const result = adapt(makeInput({ prompt: "hi", model: "o1-mini" }));
    expect(result).toMatchObject({ model: "openai/o1-mini" });
  });

  test("normalizes o4-mini model", () => {
    const result = adapt(makeInput({ prompt: "hi", model: "o4-mini" }));
    expect(result).toMatchObject({ model: "openai/o4-mini" });
  });
});

describe("claude adapt – session continuity", () => {
  const eventInputs = [
    makeInput({
      hook_event_name: "SessionStart",
      session_id: "cont-1",
      source: "cli",
    }),
    makeInput({
      hook_event_name: "PostToolUse",
      session_id: "cont-1",
      tool_name: "Edit",
      tool_input: { file_path: "/tmp/f.ts", new_string: "x" },
    }),
    makeInput({
      hook_event_name: "PostToolUse",
      session_id: "cont-1",
      tool_name: "Bash",
      tool_input: { command: "echo hi" },
    }),
    makeInput({
      hook_event_name: "UserPromptSubmit",
      session_id: "cont-1",
      prompt: "hi",
    }),
    makeInput({
      hook_event_name: "SessionEnd",
      session_id: "cont-1",
      reason: "done",
    }),
  ];

  test("same sessionId across all event types", () => {
    for (const input of eventInputs) {
      const result = adapt(input);
      if (!result) continue;
      const events = Array.isArray(result) ? result : [result];
      for (const ev of events) {
        expect(ev.sessionId).toBe("cont-1");
      }
    }
  });

  test("fallback to conversation_id is consistent", () => {
    const inputs = eventInputs.map((i) => ({
      ...i,
      session_id: undefined,
      conversation_id: "conv-1",
    }));
    for (const input of inputs) {
      const result = adapt(input as any);
      if (!result) continue;
      const events = Array.isArray(result) ? result : [result];
      for (const ev of events) {
        expect(ev.sessionId).toBe("conv-1");
      }
    }
  });
});
