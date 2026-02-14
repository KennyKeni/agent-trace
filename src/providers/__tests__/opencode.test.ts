import { describe, expect, test } from "bun:test";
import type { OpenCodeHookInput } from "../opencode";
import { adapt, sessionIdFor } from "../opencode";

function makeInput(overrides: Partial<OpenCodeHookInput>): OpenCodeHookInput {
  return {
    hook_event_name: "session.created",
    session_id: "test-session",
    ...overrides,
  } as OpenCodeHookInput;
}

describe("opencode sessionIdFor", () => {
  test("prefers top-level session_id", () => {
    expect(
      sessionIdFor({
        hook_event_name: "session.created",
        session_id: "top",
      }),
    ).toBe("top");
  });

  test("falls back to event.sessionID", () => {
    const result = sessionIdFor(
      makeInput({
        session_id: undefined,
        event: { sessionID: "evt-sid" },
      }),
    );
    expect(result).toBe("evt-sid");
  });

  test("falls back to event.info.sessionID", () => {
    const result = sessionIdFor(
      makeInput({
        session_id: undefined,
        event: { info: { sessionID: "info-sid" } },
      }),
    );
    expect(result).toBe("info-sid");
  });

  test("falls back to event.info.id", () => {
    const result = sessionIdFor(
      makeInput({
        session_id: undefined,
        event: { info: { id: "info-id" } },
      }),
    );
    expect(result).toBe("info-id");
  });

  test("falls back to event.part.sessionID", () => {
    const result = sessionIdFor(
      makeInput({
        session_id: undefined,
        event: { part: { sessionID: "part-sid" } },
      }),
    );
    expect(result).toBe("part-sid");
  });
});

describe("opencode adapt – session lifecycle", () => {
  test("session.created returns session_start", () => {
    const result = adapt(makeInput({ hook_event_name: "session.created" }));
    expect(result).toMatchObject({
      kind: "session_start",
      provider: "opencode",
      sessionId: "test-session",
      meta: { session_id: "test-session", source: "opencode" },
    });
    expect(result).not.toHaveProperty("eventName");
  });

  test("session.deleted returns session_end with reason", () => {
    const result = adapt(makeInput({ hook_event_name: "session.deleted" }));
    expect(result).toMatchObject({
      kind: "session_end",
      provider: "opencode",
      sessionId: "test-session",
      meta: { session_id: "test-session", reason: "session.deleted" },
    });
    expect(result).not.toHaveProperty("eventName");
  });

  test("session.idle returns session_end with reason", () => {
    const result = adapt(makeInput({ hook_event_name: "session.idle" }));
    expect(result).toMatchObject({
      kind: "session_end",
      provider: "opencode",
      sessionId: "test-session",
      meta: { session_id: "test-session", reason: "session.idle" },
    });
    expect(result).not.toHaveProperty("eventName");
  });
});

describe("opencode adapt – message.updated", () => {
  test("extracts user message from info.content", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "message.updated",
        event: {
          info: { role: "user", content: "hello from user" },
        },
      }),
    );
    expect(result).toMatchObject({
      kind: "message",
      provider: "opencode",
      role: "user",
      content: "hello from user",
      eventName: "message.updated",
    });
  });

  test("extracts assistant message", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "message.updated",
        event: {
          info: { role: "assistant", content: "I can help" },
        },
      }),
    );
    expect(result).toMatchObject({ role: "assistant" });
  });

  test("extracts system message", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "message.updated",
        event: {
          info: { role: "system", content: "system prompt" },
        },
      }),
    );
    expect(result).toMatchObject({ role: "system" });
  });

  test("defaults unknown role to user", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "message.updated",
        event: {
          info: { role: "other", content: "some text" },
        },
      }),
    );
    expect(result).toMatchObject({ role: "user" });
  });

  test("prefers info.modelID over top-level model", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "message.updated",
        model: "gpt-4",
        event: {
          info: { content: "hi", modelID: "claude-opus-4-6" },
        },
      }),
    );
    expect(result).toMatchObject({ model: "anthropic/claude-opus-4-6" });
  });

  test("falls back to top-level model when info.modelID is absent", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "message.updated",
        model: "gpt-4",
        event: { info: { content: "hi" } },
      }),
    );
    expect(result).toMatchObject({ model: "openai/gpt-4" });
  });

  test("returns undefined when no event", () => {
    const result = adapt(
      makeInput({ hook_event_name: "message.updated", event: undefined }),
    );
    expect(result).toBeUndefined();
  });

  test("returns undefined when no info", () => {
    const result = adapt(
      makeInput({ hook_event_name: "message.updated", event: {} }),
    );
    expect(result).toBeUndefined();
  });

  test("returns undefined when no content", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "message.updated",
        event: { info: { role: "user" } },
      }),
    );
    expect(result).toBeUndefined();
  });

  test("extracts text from info.text fallback", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "message.updated",
        event: { info: { text: "from text field" } },
      }),
    );
    expect(result).toMatchObject({ content: "from text field" });
  });

  test("extracts text from info.parts fallback", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "message.updated",
        event: { info: { parts: [{ text: "from parts" }] } },
      }),
    );
    expect(result).toMatchObject({ content: "from parts" });
  });
});

describe("opencode adapt – command.executed (suppressed)", () => {
  test("returns undefined — suppressed in favor of hook:tool.execute.after", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "command.executed",
        event: { name: "git status", messageID: "msg-1" },
      }),
    );
    expect(result).toBeUndefined();
  });

  test("returns undefined even with alternative key names", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "command.executed",
        event: { command: "npm test" },
      }),
    );
    expect(result).toBeUndefined();
  });

  test("returns undefined when no event", () => {
    const result = adapt(
      makeInput({ hook_event_name: "command.executed", event: undefined }),
    );
    expect(result).toBeUndefined();
  });
});

describe("opencode adapt – file.edited (generic, unchanged)", () => {
  test("returns file_edit with diffs:false", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "file.edited",
        event: { file: "src/index.ts" },
      }),
    );
    expect(result).toMatchObject({
      kind: "file_edit",
      sessionId: "test-session",
      diffs: false,
      edits: [],
      filePath: "src/index.ts",
      eventName: "file.edited",
      meta: { session_id: "test-session", source: "opencode" },
    });
  });
});

describe("opencode adapt – hook:chat.message", () => {
  test("returns message event with content", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "hook:chat.message",
        content: "Hello, can you help?",
        model: "anthropic/claude-sonnet-4-5-20250929",
        message_id: "msg-123",
        agent: "main",
      }),
    );
    expect(result).toMatchObject({
      kind: "message",
      provider: "opencode",
      role: "user",
      content: "Hello, can you help?",
      eventName: "hook:chat.message",
      model: "anthropic/claude-sonnet-4-5-20250929",
      meta: {
        source: "opencode.hook",
        message_id: "msg-123",
        agent: "main",
      },
    });
  });

  test("returns undefined when content is missing", () => {
    const result = adapt(makeInput({ hook_event_name: "hook:chat.message" }));
    expect(result).toBeUndefined();
  });

  test("returns undefined when content is not a string", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "hook:chat.message",
        content: { text: "nested" },
      }),
    );
    expect(result).toBeUndefined();
  });
});

describe("opencode adapt – hook:tool.execute.after", () => {
  test("single file returns file_edit with diffs:true", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "hook:tool.execute.after",
        tool_name: "edit",
        call_id: "call-1",
        files: [
          { file: "src/index.ts", before: "old code", after: "new code" },
        ],
      }),
    );
    expect(result).toMatchObject({
      kind: "file_edit",
      provider: "opencode",
      filePath: "src/index.ts",
      diffs: true,
      edits: [{ old_string: "old code", new_string: "new code" }],
      eventName: "hook:tool.execute.after",
      meta: {
        source: "opencode.hook",
        tool_name: "edit",
        call_id: "call-1",
      },
    });
  });

  test("multiple files returns array of file_edit events", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "hook:tool.execute.after",
        tool_name: "apply_patch",
        files: [
          { file: "a.ts", before: "a-old", after: "a-new" },
          { file: "b.ts", before: "b-old", after: "b-new" },
        ],
      }),
    );
    expect(Array.isArray(result)).toBe(true);
    const arr = result as Array<{ kind: string; filePath: string }>;
    expect(arr).toHaveLength(2);
    expect(arr[0]).toMatchObject({ kind: "file_edit", filePath: "a.ts" });
    expect(arr[1]).toMatchObject({ kind: "file_edit", filePath: "b.ts" });
  });

  test("bash tool returns shell event", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "hook:tool.execute.after",
        tool_name: "bash",
        command: "ls -la",
      }),
    );
    expect(result).toMatchObject({
      kind: "shell",
      provider: "opencode",
      sessionId: "test-session",
      meta: {
        event: "hook:tool.execute.after",
        session_id: "test-session",
        tool_name: "bash",
        command: "ls -la",
        source: "opencode.hook",
      },
    });
    expect(result).not.toHaveProperty("eventName");
  });

  test("shell tool returns shell event", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "hook:tool.execute.after",
        tool_name: "shell",
      }),
    );
    expect(result).toMatchObject({
      kind: "shell",
      meta: { tool_name: "shell" },
    });
  });

  test("no files returns undefined", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "hook:tool.execute.after",
        tool_name: "edit",
        files: [],
      }),
    );
    expect(result).toBeUndefined();
  });

  test("undefined files returns undefined for edit tool", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "hook:tool.execute.after",
        tool_name: "edit",
      }),
    );
    expect(result).toBeUndefined();
  });

  test("new file (before undefined) uses empty old_string", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "hook:tool.execute.after",
        tool_name: "write",
        files: [{ file: "new-file.ts", after: "new content" }],
      }),
    );
    expect(result).toMatchObject({
      kind: "file_edit",
      edits: [{ old_string: "", new_string: "new content" }],
    });
  });

  test("deleted file (after undefined) uses empty new_string", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "hook:tool.execute.after",
        tool_name: "edit",
        files: [{ file: "gone.ts", before: "old content" }],
      }),
    );
    expect(result).toMatchObject({
      kind: "file_edit",
      edits: [{ old_string: "old content", new_string: "" }],
    });
  });
});

describe("opencode adapt – hook:tool.execute.before", () => {
  test("returns undefined for tool.execute.before", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "hook:tool.execute.before",
        tool_name: "bash",
        session_id: "oc-1",
      }),
    );
    expect(result).toBeUndefined();
  });
});

describe("opencode adapt – unknown event", () => {
  test("returns undefined", () => {
    const result = adapt(makeInput({ hook_event_name: "some.unknown.event" }));
    expect(result).toBeUndefined();
  });
});

describe("opencode adapt – session continuity", () => {
  const eventInputs = [
    makeInput({ hook_event_name: "session.created", session_id: "cont-1" }),
    makeInput({
      hook_event_name: "file.edited",
      session_id: "cont-1",
      event: { file: "src/index.ts" },
    }),
    makeInput({
      hook_event_name: "hook:tool.execute.after",
      session_id: "cont-1",
      tool_name: "bash",
      command: "ls",
    }),
    makeInput({
      hook_event_name: "hook:chat.message",
      session_id: "cont-1",
      content: "hello",
    }),
    makeInput({ hook_event_name: "session.idle", session_id: "cont-1" }),
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

  test("event.sessionID fallback is consistent", () => {
    const inputs = eventInputs.map((i) => ({
      ...i,
      session_id: undefined,
      event: {
        ...(typeof i.event === "object" && i.event ? i.event : {}),
        sessionID: "evt-1",
      },
    }));
    for (const input of inputs) {
      const result = adapt(input as any);
      if (!result) continue;
      const events = Array.isArray(result) ? result : [result];
      for (const ev of events) {
        expect(ev.sessionId).toBe("evt-1");
      }
    }
  });

  test("multi-file array shares sessionId", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "hook:tool.execute.after",
        session_id: "multi-1",
        tool_name: "edit",
        files: [
          { file: "a.ts", before: "a", after: "b" },
          { file: "b.ts", before: "c", after: "d" },
          { file: "c.ts", before: "e", after: "f" },
        ],
      }),
    );
    expect(Array.isArray(result)).toBe(true);
    for (const ev of result as any[]) {
      expect(ev.sessionId).toBe("multi-1");
    }
  });
});
