import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatchTraceEvent } from "../dispatch";
import type { IgnoreConfig } from "../ignore";
import type {
  Extension,
  ExtensionContext,
  FileEditEvent,
  PipelineEvent,
  ShellEvent,
} from "../types";

function makeCtx(root: string): ExtensionContext {
  return {
    root,
    appendJsonl() {},
    appendText() {},
    tryReadFile() {
      return undefined;
    },
  };
}

function makeFileEdit(
  filePath: string,
  overrides?: Partial<FileEditEvent>,
): FileEditEvent {
  return {
    kind: "file_edit",
    provider: "claude",
    sessionId: "s1",
    eventName: "PostToolUse",
    filePath,
    edits: [{ old_string: "a", new_string: "b" }],
    meta: {},
    ...overrides,
  };
}

function makeShellEvent(overrides?: Partial<ShellEvent>): ShellEvent {
  return {
    kind: "shell",
    provider: "claude",
    sessionId: "s1",
    meta: {},
    ...overrides,
  };
}

function makeIgnoreConfig(overrides?: Partial<IgnoreConfig>): IgnoreConfig {
  return {
    useGitignore: false,
    useBuiltinSensitive: true,
    patterns: [],
    mode: "redact",
    ...overrides,
  };
}

function spyExtension(
  name: string,
): Extension & { calls: PipelineEvent[]; ctxs: ExtensionContext[] } {
  const calls: PipelineEvent[] = [];
  const ctxs: ExtensionContext[] = [];
  return {
    name,
    calls,
    ctxs,
    onTraceEvent(event: PipelineEvent, ctx: ExtensionContext) {
      calls.push(event);
      ctxs.push(ctx);
    },
  };
}

describe("dispatchTraceEvent", () => {
  let tmpDir: string;
  let ctx: ExtensionContext;
  let errSpy: ReturnType<typeof spyOn> | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-trace-dispatch-"));
    mkdirSync(join(tmpDir, ".agent-trace"), { recursive: true });
    ctx = makeCtx(tmpDir);
  });

  afterEach(() => {
    errSpy?.mockRestore();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("file_edit with non-ignored path passes through unchanged", () => {
    const ext = spyExtension("test");
    const event = makeFileEdit(join(tmpDir, "src", "index.ts"));
    const ignoreConfig = makeIgnoreConfig();

    dispatchTraceEvent(event, [ext], ctx, ignoreConfig);

    expect(ext.calls).toHaveLength(1);
    expect(ext.calls[0]).toBe(event);
  });

  test("ctx is forwarded to extension", () => {
    const ext = spyExtension("test");
    const event = makeShellEvent();

    dispatchTraceEvent(event, [ext], ctx);

    expect(ext.ctxs).toHaveLength(1);
    expect(ext.ctxs[0]).toBe(ctx);
  });

  test("file_edit with ignored path in skip mode: extension not called", () => {
    const ext = spyExtension("test");
    const event = makeFileEdit(join(tmpDir, ".env"));
    const ignoreConfig = makeIgnoreConfig({ mode: "skip" });

    dispatchTraceEvent(event, [ext], ctx, ignoreConfig);

    expect(ext.calls).toHaveLength(0);
  });

  test("file_edit with ignored path in redact mode: fields cleared, original unchanged", () => {
    const ext = spyExtension("test");
    const originalEdits = [
      { old_string: "SECRET=abc", new_string: "SECRET=xyz" },
    ];
    const originalRanges = [{ start_line: 1, end_line: 1 }];
    const event = makeFileEdit(join(tmpDir, ".env"), {
      edits: originalEdits,
      snapshotRanges: originalRanges,
      precomputedPatch: "--- a/.env\n+++ b/.env",
      hunkPatch: "@@ -1 +1 @@",
    });
    const ignoreConfig = makeIgnoreConfig({ mode: "redact" });

    dispatchTraceEvent(event, [ext], ctx, ignoreConfig);

    expect(ext.calls).toHaveLength(1);
    const filtered = ext.calls[0] as FileEditEvent;
    // Filtered is a new object, not the original
    expect(filtered).not.toBe(event);
    expect(filtered.edits).toEqual([]);
    expect(filtered.snapshotRanges).toBeUndefined();
    expect(filtered.precomputedPatch).toBeUndefined();
    expect(filtered.hunkPatch).toBeUndefined();
    expect(filtered.meta.redacted).toBe(true);
    expect(filtered.filePath).toBe(event.filePath);

    // Original event is not mutated
    expect(event.edits).toBe(originalEdits);
    expect(event.edits).toHaveLength(1);
    expect(event.snapshotRanges).toBe(originalRanges);
    expect(event.precomputedPatch).toBe("--- a/.env\n+++ b/.env");
    expect(event.meta.redacted).toBeUndefined();
  });

  test("redaction preserves pre-existing meta keys", () => {
    const ext = spyExtension("test");
    const event = makeFileEdit(join(tmpDir, ".env"), {
      meta: { custom_key: "custom_value" },
    });
    const ignoreConfig = makeIgnoreConfig({ mode: "redact" });

    dispatchTraceEvent(event, [ext], ctx, ignoreConfig);

    const filtered = ext.calls[0] as FileEditEvent;
    expect(filtered.meta.redacted).toBe(true);
    expect(filtered.meta.custom_key).toBe("custom_value");
  });

  test("multiple extensions all receive the fully redacted event", () => {
    const ext1 = spyExtension("ext1");
    const ext2 = spyExtension("ext2");
    const event = makeFileEdit(join(tmpDir, ".env"));
    const ignoreConfig = makeIgnoreConfig({ mode: "redact" });

    dispatchTraceEvent(event, [ext1, ext2], ctx, ignoreConfig);

    expect(ext1.calls).toHaveLength(1);
    expect(ext2.calls).toHaveLength(1);
    for (const ext of [ext1, ext2]) {
      const filtered = ext.calls[0] as FileEditEvent;
      expect(filtered.edits).toEqual([]);
      expect(filtered.snapshotRanges).toBeUndefined();
      expect(filtered.meta.redacted).toBe(true);
    }
  });

  test("non-file_edit event passes through even with ignore config", () => {
    const ext = spyExtension("test");
    const event = makeShellEvent();
    const ignoreConfig = makeIgnoreConfig({ mode: "skip" });

    dispatchTraceEvent(event, [ext], ctx, ignoreConfig);

    expect(ext.calls).toHaveLength(1);
    expect(ext.calls[0]).toBe(event);
  });

  test("extension throwing error: next extension still runs, error logged", () => {
    errSpy = spyOn(console, "error").mockImplementation(() => {});
    const throwingExt: Extension = {
      name: "thrower",
      onTraceEvent() {
        throw new Error("boom");
      },
    };
    const okExt = spyExtension("ok");
    const event = makeShellEvent();

    dispatchTraceEvent(event, [throwingExt, okExt], ctx);

    expect(okExt.calls).toHaveLength(1);
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(String(errSpy.mock.calls[0]?.[0])).toContain("thrower");
    expect(errSpy.mock.calls[0]?.[1]).toBeInstanceOf(Error);
  });

  test("no ignoreConfig: no filtering applied", () => {
    const ext = spyExtension("test");
    const event = makeFileEdit(join(tmpDir, ".env"));

    dispatchTraceEvent(event, [ext], ctx);

    expect(ext.calls).toHaveLength(1);
    expect(ext.calls[0]).toBe(event);
  });

  test("extension without onTraceEvent is skipped silently", () => {
    const noopExt: Extension = { name: "noop" };
    const okExt = spyExtension("ok");
    const event = makeShellEvent();

    dispatchTraceEvent(event, [noopExt, okExt], ctx);

    expect(okExt.calls).toHaveLength(1);
  });

  test("empty extensions array is a no-op", () => {
    errSpy = spyOn(console, "error").mockImplementation(() => {});
    const event = makeShellEvent();
    dispatchTraceEvent(event, [], ctx);
    expect(errSpy).not.toHaveBeenCalled();
  });
});
