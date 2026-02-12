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
      role: "user",
      content: "hello from prompt",
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
      filePath: "/tmp/test.ts",
      edits: [{ old_string: "old", new_string: "new" }],
      readContent: true,
      model: "openai/gpt-4",
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
  test("returns file_edit without readContent", () => {
    const result = adapt(
      makeInput({
        hook_event_name: "afterTabFileEdit",
        file_path: "/tmp/tab.ts",
      }),
    );
    expect(result).toMatchObject({
      kind: "file_edit",
      filePath: "/tmp/tab.ts",
    });
    const event = result as { readContent?: boolean };
    expect(event.readContent).toBeUndefined();
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
      model: "openai/gpt-4",
      transcript: "/tmp/transcript.json",
      meta: {
        command: "npm test",
        duration_ms: 1500,
      },
    });
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
      meta: {
        is_background_agent: true,
        composer_mode: "agent",
      },
    });
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
      meta: {
        reason: "completed",
        duration_ms: 60000,
      },
    });
  });
});

describe("cursor adapt – unknown event", () => {
  test("returns undefined", () => {
    const result = adapt(makeInput({ hook_event_name: "unknownEvent" }));
    expect(result).toBeUndefined();
  });
});
