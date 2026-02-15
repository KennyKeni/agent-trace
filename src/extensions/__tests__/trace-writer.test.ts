import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempGitRepo, readTraces } from "../../core/__tests__/helpers";
import type {
  ExtensionContext,
  FileEditEvent,
  MessageEvent,
  SessionEndEvent,
  SessionStartEvent,
  ShellEvent,
} from "../../core/types";
import { ensureParent } from "../../core/utils";
import { traceWriterExtension } from "../trace-writer";

function makeCtx(root: string): ExtensionContext & { _readCalls: string[] } {
  const readCalls: string[] = [];
  return {
    root,
    _readCalls: readCalls,
    appendJsonl(path, value) {
      ensureParent(path);
      appendFileSync(path, `${JSON.stringify(value)}\n`, "utf-8");
    },
    appendText(path, text) {
      ensureParent(path);
      appendFileSync(path, text, "utf-8");
    },
    tryReadFile(path) {
      readCalls.push(path);
      try {
        return readFileSync(path, "utf-8");
      } catch {
        return undefined;
      }
    },
  } as ExtensionContext & { _readCalls: string[] };
}

describe("traceWriterExtension", () => {
  let gitDir: string;
  let ctx: ExtensionContext & { _readCalls: string[] };

  beforeEach(() => {
    gitDir = createTempGitRepo();
    ctx = makeCtx(gitDir);
  });

  afterEach(() => {
    rmSync(gitDir, { recursive: true, force: true });
  });

  describe("file_edit", () => {
    test("with snapshotRanges uses those ranges (not computed)", () => {
      const event: FileEditEvent = {
        kind: "file_edit",
        provider: "claude",
        sessionId: "s1",
        model: "claude-sonnet-4-5-20250929",
        eventName: "PostToolUse",
        filePath: join(gitDir, "src", "app.ts"),
        edits: [{ old_string: "a", new_string: "b" }],
        snapshotRanges: [
          { start_line: 10, end_line: 20, content_hash: "murmur3:abcd1234" },
        ],
        meta: {},
      };

      traceWriterExtension.onTraceEvent?.(event, ctx);

      const traces = readTraces(gitDir);
      expect(traces).toHaveLength(1);
      expect(traces[0].files[0].conversations[0].ranges).toEqual([
        { start_line: 10, end_line: 20, content_hash: "murmur3:abcd1234" },
      ]);
    });

    test("snapshotRanges: [] (truthy empty array) skips computation", () => {
      const event: FileEditEvent = {
        kind: "file_edit",
        provider: "claude",
        sessionId: "s1",
        model: "claude-sonnet-4-5-20250929",
        eventName: "PostToolUse",
        filePath: join(gitDir, "src", "empty-snap.ts"),
        edits: [{ old_string: "a", new_string: "b" }],
        snapshotRanges: [],
        meta: {},
      };

      traceWriterExtension.onTraceEvent?.(event, ctx);

      const traces = readTraces(gitDir);
      expect(traces).toHaveLength(1);
      expect(traces[0].files[0].conversations[0].ranges).toEqual([]);
      expect(ctx._readCalls).toEqual([]);
    });

    test("with edits containing range computes range positions", () => {
      const event: FileEditEvent = {
        kind: "file_edit",
        provider: "claude",
        sessionId: "s1",
        model: "claude-sonnet-4-5-20250929",
        eventName: "PostToolUse",
        filePath: join(gitDir, "src", "index.ts"),
        edits: [
          {
            old_string: "const x = 1;",
            new_string: "const x = 2;",
            range: {
              start_line_number: 5,
              end_line_number: 5,
              start_column: 1,
              end_column: 13,
            },
          },
        ],
        meta: {},
      };

      traceWriterExtension.onTraceEvent?.(event, ctx);

      const traces = readTraces(gitDir);
      expect(traces).toHaveLength(1);
      const ranges = traces[0].files[0].conversations[0].ranges;
      expect(ranges).toHaveLength(1);
      expect(ranges[0].start_line).toBe(5);
      expect(ranges[0].end_line).toBe(5);
    });

    test("tryReadFile not called when all edits have range", () => {
      const event: FileEditEvent = {
        kind: "file_edit",
        provider: "claude",
        sessionId: "s1",
        model: "claude-sonnet-4-5-20250929",
        eventName: "PostToolUse",
        filePath: join(gitDir, "src", "ranged.ts"),
        edits: [
          {
            old_string: "a",
            new_string: "b",
            range: {
              start_line_number: 1,
              end_line_number: 1,
              start_column: 1,
              end_column: 2,
            },
          },
        ],
        meta: {},
      };

      traceWriterExtension.onTraceEvent?.(event, ctx);

      expect(ctx._readCalls).toEqual([]);
    });

    test("with new_string but no range reads file to resolve position", () => {
      const filePath = join(gitDir, "src", "resolve.ts");
      const fileContent = "line1\nline2\nconst x = 2;\nline4\n";
      ensureParent(filePath);
      writeFileSync(filePath, fileContent);

      const event: FileEditEvent = {
        kind: "file_edit",
        provider: "claude",
        sessionId: "s1",
        model: "claude-sonnet-4-5-20250929",
        eventName: "PostToolUse",
        filePath,
        edits: [{ old_string: "const x = 1;", new_string: "const x = 2;" }],
        meta: {},
      };

      traceWriterExtension.onTraceEvent?.(event, ctx);

      const traces = readTraces(gitDir);
      expect(traces).toHaveLength(1);
      const ranges = traces[0].files[0].conversations[0].ranges;
      expect(ranges).toHaveLength(1);
      expect(ranges[0].start_line).toBe(3);
      expect(ranges[0].end_line).toBe(3);
    });

    test("with empty edits array produces no range positions", () => {
      const event: FileEditEvent = {
        kind: "file_edit",
        provider: "claude",
        sessionId: "s1",
        model: "claude-sonnet-4-5-20250929",
        eventName: "PostToolUse",
        filePath: join(gitDir, "src", "empty.ts"),
        edits: [],
        meta: {},
      };

      traceWriterExtension.onTraceEvent?.(event, ctx);

      const traces = readTraces(gitDir);
      expect(traces).toHaveLength(1);
      expect(traces[0].files[0].conversations[0].ranges).toEqual([]);
    });

    test("filePath outside ctx.root produces no trace", () => {
      const event: FileEditEvent = {
        kind: "file_edit",
        provider: "claude",
        sessionId: "s1",
        model: "claude-sonnet-4-5-20250929",
        eventName: "PostToolUse",
        filePath: "/tmp/completely-outside/file.ts",
        edits: [{ old_string: "a", new_string: "b" }],
        meta: {},
      };

      traceWriterExtension.onTraceEvent?.(event, ctx);

      const traces = readTraces(gitDir);
      expect(traces).toHaveLength(0);
    });
  });

  describe("shell", () => {
    test("creates trace with .shell-history path", () => {
      const event: ShellEvent = {
        kind: "shell",
        provider: "claude",
        sessionId: "s1",
        model: "claude-sonnet-4-5-20250929",
        meta: {},
      };

      traceWriterExtension.onTraceEvent?.(event, ctx);

      const traces = readTraces(gitDir);
      expect(traces).toHaveLength(1);
      expect(traces[0].files[0].path).toBe(".shell-history");
    });
  });

  describe("session_start", () => {
    test("creates trace with .sessions path and event metadata", () => {
      const event: SessionStartEvent = {
        kind: "session_start",
        provider: "claude",
        sessionId: "s1",
        model: "claude-sonnet-4-5-20250929",
        meta: { custom: "value" },
      };

      traceWriterExtension.onTraceEvent?.(event, ctx);

      const traces = readTraces(gitDir);
      expect(traces).toHaveLength(1);
      expect(traces[0].files[0].path).toBe(".sessions");
      expect(traces[0].metadata.event).toBe("session_start");
      expect(traces[0].metadata.custom).toBe("value");
    });

    test("meta.event overrides the default 'session_start' label", () => {
      const event: SessionStartEvent = {
        kind: "session_start",
        provider: "claude",
        sessionId: "s1",
        model: "claude-sonnet-4-5-20250929",
        meta: { event: "custom_event" },
      };

      traceWriterExtension.onTraceEvent?.(event, ctx);

      const traces = readTraces(gitDir);
      // { event: "session_start", ...event.meta } — meta.event overwrites
      expect(traces[0].metadata.event).toBe("custom_event");
    });
  });

  describe("session_end", () => {
    test("creates trace with .sessions path and event metadata", () => {
      const event: SessionEndEvent = {
        kind: "session_end",
        provider: "claude",
        sessionId: "s1",
        model: "claude-sonnet-4-5-20250929",
        meta: { reason: "timeout" },
      };

      traceWriterExtension.onTraceEvent?.(event, ctx);

      const traces = readTraces(gitDir);
      expect(traces).toHaveLength(1);
      expect(traces[0].files[0].path).toBe(".sessions");
      expect(traces[0].metadata.event).toBe("session_end");
      expect(traces[0].metadata.reason).toBe("timeout");
    });
  });

  describe("message", () => {
    test("no-op - no trace written", () => {
      const event: MessageEvent = {
        kind: "message",
        provider: "claude",
        sessionId: "s1",
        eventName: "UserPromptSubmit",
        role: "user",
        content: "Hello",
        meta: {},
      };

      traceWriterExtension.onTraceEvent?.(event, ctx);

      const traces = readTraces(gitDir);
      expect(traces).toHaveLength(0);
    });
  });

  describe("transcript_path handling", () => {
    test("transcript_path in meta is stripped from metadata and used as conversation url", () => {
      const event: ShellEvent = {
        kind: "shell",
        provider: "claude",
        sessionId: "s1",
        model: "claude-sonnet-4-5-20250929",
        meta: {
          transcript_path: "/path/to/transcript.jsonl",
          other_key: "kept",
        },
      };

      traceWriterExtension.onTraceEvent?.(event, ctx);

      const traces = readTraces(gitDir);
      expect(traces).toHaveLength(1);
      expect(traces[0].metadata.transcript_path).toBeUndefined();
      expect(traces[0].metadata.other_key).toBe("kept");
      const conv = traces[0].files[0].conversations[0];
      expect(conv.url).toBe("file:///path/to/transcript.jsonl");
    });

    test("absent transcript_path produces no conversation url", () => {
      const event: ShellEvent = {
        kind: "shell",
        provider: "claude",
        sessionId: "s1",
        model: "claude-sonnet-4-5-20250929",
        meta: { some_key: "value" },
      };

      traceWriterExtension.onTraceEvent?.(event, ctx);

      const traces = readTraces(gitDir);
      expect(traces).toHaveLength(1);
      expect(traces[0].metadata.some_key).toBe("value");
      const conv = traces[0].files[0].conversations[0];
      expect(conv.url).toBeUndefined();
    });

    test("transcript_path: null treated as absent, key stripped from metadata", () => {
      const event: ShellEvent = {
        kind: "shell",
        provider: "claude",
        sessionId: "s1",
        model: "claude-sonnet-4-5-20250929",
        meta: { transcript_path: null as unknown },
      };

      traceWriterExtension.onTraceEvent?.(event, ctx);

      const traces = readTraces(gitDir);
      expect(traces).toHaveLength(1);
      const conv = traces[0].files[0].conversations[0];
      expect(conv.url).toBeUndefined();
      expect(traces[0].metadata.transcript_path).toBeUndefined();
    });

    test("transcript_path: numeric value treated as absent, key stripped from metadata", () => {
      const event: ShellEvent = {
        kind: "shell",
        provider: "claude",
        sessionId: "s1",
        model: "claude-sonnet-4-5-20250929",
        meta: { transcript_path: 42 as unknown },
      };

      traceWriterExtension.onTraceEvent?.(event, ctx);

      const traces = readTraces(gitDir);
      expect(traces).toHaveLength(1);
      const conv = traces[0].files[0].conversations[0];
      expect(conv.url).toBeUndefined();
      expect(traces[0].metadata.transcript_path).toBeUndefined();
    });
  });
});
