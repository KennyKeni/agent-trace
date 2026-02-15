import { describe, expect, test } from "bun:test";
import type { CursorHookInput } from "../cursor";
import { adapt, sessionIdFor } from "../cursor";

function makeInput(overrides: Partial<CursorHookInput>): CursorHookInput {
  return {
    hook_event_name: "beforeSubmitPrompt",
    session_id: "test-session",
    model: "gpt-4",
    ...overrides,
  } as CursorHookInput;
}

describe("cursor sessionIdFor", () => {
  test("prefers session_id", () => {
    expect(
      sessionIdFor({
        hook_event_name: "afterFileEdit",
        session_id: "s1",
        conversation_id: "c1",
        generation_id: "g1",
      }),
    ).toBe("s1");
  });

  test("falls back to conversation_id", () => {
    expect(
      sessionIdFor({
        hook_event_name: "afterFileEdit",
        conversation_id: "c1",
        generation_id: "g1",
      }),
    ).toBe("c1");
  });

  test("falls back to generation_id", () => {
    expect(
      sessionIdFor({ hook_event_name: "afterFileEdit", generation_id: "g1" }),
    ).toBe("g1");
  });

  test("returns undefined when nothing present", () => {
    expect(sessionIdFor({ hook_event_name: "afterFileEdit" })).toBeUndefined();
  });
});

describe("cursor adapt – beforeSubmitPrompt", () => {
  test("extracts text from prompt field", () => {
    const result = adapt(makeInput({ prompt: "hello from prompt" }));
    expect(result).toMatchObject({
      kind: "message",
      provider: "cursor",
      sessionId: "test-session",
      role: "user",
      content: "hello from prompt",
      eventName: "beforeSubmitPrompt",
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

  test("returns undefined when no text fields present", () => {
    const result = adapt(makeInput({}));
    expect(result).toBeUndefined();
  });

  test("normalizes model", () => {
    const result = adapt(makeInput({ prompt: "hi" }));
    expect(result).toMatchObject({ model: "openai/gpt-4" });
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

describe("cursor adapt – afterFileEdit", () => {
  test("returns file_edit with readContent true", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "afterFileEdit",
        file_path: "/tmp/test.ts",
        edits: [{ old_string: "old", new_string: "new" }],
        transcript_path: "/tmp/transcript.json",
      }),
    );
    expect(result).toMatchObject({
      kind: "file_edit",
      provider: "cursor",
      sessionId: "test-session",
      filePath: "/tmp/test.ts",
      edits: [{ old_string: "old", new_string: "new" }],
      model: "openai/gpt-4",
      eventName: "afterFileEdit",
      meta: { transcript_path: "/tmp/transcript.json" },
    });
  });

  test("returns undefined without file_path", () => {
    const result = adapt(
      makeInput({ hook_event_name: "afterFileEdit", file_path: undefined }),
    );
    expect(result).toBeUndefined();
  });

  test("defaults edits to empty array", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "afterFileEdit",
        file_path: "/tmp/t.ts",
      }),
    );
    expect(result).toMatchObject({ edits: [] });
  });
});

describe("cursor adapt – afterTabFileEdit", () => {
  test("returns file_edit", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "afterTabFileEdit",
        file_path: "/tmp/tab.ts",
      }),
    );
    expect(result).toMatchObject({
      kind: "file_edit",
      sessionId: "test-session",
      filePath: "/tmp/tab.ts",
      eventName: "afterTabFileEdit",
    });
  });

  test("returns undefined without file_path", () => {
    const result = adapt(
      makeInput({ hook_event_name: "afterTabFileEdit", file_path: undefined }),
    );
    expect(result).toBeUndefined();
  });
});

describe("cursor adapt – afterShellExecution", () => {
  test("returns shell event with command and duration", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "afterShellExecution",
        command: "npm test",
        duration: 1500,
        transcript_path: "/tmp/transcript.json",
      }),
    );
    expect(result).toMatchObject({
      kind: "shell",
      provider: "cursor",
      sessionId: "test-session",
      model: "openai/gpt-4",
      meta: {
        command: "npm test",
        duration_ms: 1500,
        transcript_path: "/tmp/transcript.json",
      },
    });
    expect(result).not.toHaveProperty("eventName");
  });
});

describe("cursor adapt – sessionStart", () => {
  test("returns session_start with metadata", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "sessionStart",
        is_background_agent: true,
        composer_mode: "agent",
      }),
    );
    expect(result).toMatchObject({
      kind: "session_start",
      provider: "cursor",
      sessionId: "test-session",
      meta: {
        session_id: "test-session",
        is_background_agent: true,
        composer_mode: "agent",
      },
    });
    expect(result).not.toHaveProperty("eventName");
  });
});

describe("cursor adapt – sessionEnd", () => {
  test("returns session_end with reason and duration", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "sessionEnd",
        reason: "completed",
        duration_ms: 60000,
      }),
    );
    expect(result).toMatchObject({
      kind: "session_end",
      provider: "cursor",
      sessionId: "test-session",
      meta: {
        session_id: "test-session",
        reason: "completed",
        duration_ms: 60000,
      },
    });
    expect(result).not.toHaveProperty("eventName");
  });
});

describe("cursor adapt – beforeShellExecution", () => {
  test("returns undefined for beforeShellExecution", () => {
    const result = adapt(
      makeInput({ hook_event_name: "beforeShellExecution" }),
    );
    expect(result).toBeUndefined();
  });
});

describe("cursor adapt – unknown event", () => {
  test("returns undefined", () => {
    const result = adapt(makeInput({ hook_event_name: "unknownEvent" }));
    expect(result).toBeUndefined();
  });
});

describe("cursor adapt – session continuity", () => {
  const eventInputs = [
    makeInput({ hook_event_name: "sessionStart", session_id: "cont-1" }),
    makeInput({
      hook_event_name: "afterFileEdit",
      session_id: "cont-1",
      file_path: "/tmp/f.ts",
    }),
    makeInput({
      hook_event_name: "afterShellExecution",
      session_id: "cont-1",
      command: "ls",
    }),
    makeInput({
      hook_event_name: "beforeSubmitPrompt",
      session_id: "cont-1",
      prompt: "hi",
    }),
    makeInput({
      hook_event_name: "sessionEnd",
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

  test("fallback to generation_id is consistent", () => {
    const inputs = eventInputs.map((i) => ({
      ...i,
      session_id: undefined,
      generation_id: "gen-1",
    }));
    for (const input of inputs) {
      const result = adapt(input as any);
      if (!result) continue;
      const events = Array.isArray(result) ? result : [result];
      for (const ev of events) {
        expect(ev.sessionId).toBe("gen-1");
      }
    }
  });
});
