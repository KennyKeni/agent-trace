import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import type { ExtensionContext } from "../../core/types";
import { ensureParent } from "../../core/utils";
import { appendLineHashes, appendLineHashesFromPatch } from "../line-hashes";

function makeCtx(root: string): ExtensionContext {
  return {
    root,
    appendJsonl(path, value) {
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

const TMP_ROOT = join(import.meta.dir, "__tmp_line_hashes__");

beforeEach(() => {
  if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true });
  mkdirSync(TMP_ROOT, { recursive: true });
});

afterEach(() => {
  if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true });
});

function readRecords(provider: string, sessionId: string): unknown[] {
  const path = join(
    TMP_ROOT,
    ".agent-trace",
    "line-hashes",
    provider,
    `${sessionId}.jsonl`,
  );
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}

describe("appendLineHashes", () => {
  test("hashes array length matches line count of new_string", () => {
    const newString = "line1\nline2\nline3";
    appendLineHashes(
      "test",
      "sess1",
      "src/foo.ts",
      "PostToolUse",
      [{ old_string: "", new_string: newString }],
      undefined,
      makeCtx(TMP_ROOT),
    );

    const records = readRecords("test", "sess1") as Array<{
      hashes: string[];
    }>;
    expect(records).toHaveLength(1);
    expect(records[0]?.hashes).toHaveLength(3);
  });

  test("each hash matches murmur3:<8-hex> format", () => {
    appendLineHashes(
      "test",
      "sess1",
      "src/foo.ts",
      "PostToolUse",
      [{ old_string: "", new_string: "hello\nworld" }],
      undefined,
      makeCtx(TMP_ROOT),
    );

    const records = readRecords("test", "sess1") as Array<{
      hashes: string[];
    }>;
    for (const hash of records[0]?.hashes ?? []) {
      expect(hash).toMatch(/^murmur3:[0-9a-f]{8}$/);
    }
  });

  test("same line content produces same hash", () => {
    appendLineHashes(
      "test",
      "sess1",
      "a.ts",
      "PostToolUse",
      [{ old_string: "", new_string: "identical" }],
      undefined,
      makeCtx(TMP_ROOT),
    );
    appendLineHashes(
      "test",
      "sess1",
      "b.ts",
      "PostToolUse",
      [{ old_string: "", new_string: "identical" }],
      undefined,
      makeCtx(TMP_ROOT),
    );

    const records = readRecords("test", "sess1") as Array<{
      hashes: string[];
    }>;
    expect(records[0]?.hashes?.[0]).toBe(records[1]?.hashes?.[0]);
  });

  test("different content produces different hash", () => {
    appendLineHashes(
      "test",
      "sess1",
      "a.ts",
      "PostToolUse",
      [{ old_string: "", new_string: "alpha" }],
      undefined,
      makeCtx(TMP_ROOT),
    );
    appendLineHashes(
      "test",
      "sess1",
      "b.ts",
      "PostToolUse",
      [{ old_string: "", new_string: "beta" }],
      undefined,
      makeCtx(TMP_ROOT),
    );

    const records = readRecords("test", "sess1") as Array<{
      hashes: string[];
    }>;
    expect(records[0]?.hashes?.[0]).not.toBe(records[1]?.hashes?.[0]);
  });

  test("resolves start_line/end_line from edit range", () => {
    appendLineHashes(
      "test",
      "sess1",
      "src/foo.ts",
      "PostToolUse",
      [
        {
          old_string: "old",
          new_string: "line1\nline2",
          range: {
            start_line_number: 10,
            end_line_number: 11,
            start_column: 1,
            end_column: 1,
          },
        },
      ],
      undefined,
      makeCtx(TMP_ROOT),
    );

    const records = readRecords("test", "sess1") as Array<{
      start_line: number;
      end_line: number;
    }>;
    expect(records[0]?.start_line).toBe(10);
    expect(records[0]?.end_line).toBe(11);
  });

  test("resolves position from file content when no range", () => {
    const fileContent = "header\ntarget line\nfooter";
    appendLineHashes(
      "test",
      "sess1",
      "src/foo.ts",
      "PostToolUse",
      [{ old_string: "", new_string: "target line" }],
      fileContent,
      makeCtx(TMP_ROOT),
    );

    const records = readRecords("test", "sess1") as Array<{
      start_line: number;
      end_line: number;
    }>;
    expect(records[0]?.start_line).toBe(2);
    expect(records[0]?.end_line).toBe(2);
  });

  test("skips edits with empty new_string", () => {
    appendLineHashes(
      "test",
      "sess1",
      "src/foo.ts",
      "PostToolUse",
      [
        { old_string: "remove", new_string: "" },
        { old_string: "", new_string: "keep" },
      ],
      undefined,
      makeCtx(TMP_ROOT),
    );

    const records = readRecords("test", "sess1") as Array<{
      file: string;
    }>;
    expect(records).toHaveLength(1);
  });

  test("hashes empty lines to their murmur3 value", () => {
    appendLineHashes(
      "test",
      "sess1",
      "src/foo.ts",
      "PostToolUse",
      [{ old_string: "", new_string: "a\n\nb" }],
      undefined,
      makeCtx(TMP_ROOT),
    );

    const records = readRecords("test", "sess1") as Array<{
      hashes: string[];
    }>;
    expect(records[0]?.hashes).toHaveLength(3);
    expect(records[0]?.hashes?.[1]).toMatch(/^murmur3:[0-9a-f]{8}$/);
  });
});

describe("appendLineHashesFromPatch", () => {
  test("hashes added lines from patch text", () => {
    const patch = [
      "diff --git a/new.ts b/new.ts",
      "--- /dev/null",
      "+++ b/new.ts",
      "@@ -0,0 +1,3 @@",
      "+line one",
      "+line two",
      "+line three",
    ].join("\n");

    appendLineHashesFromPatch(
      "test",
      "patch-sess",
      "new.ts",
      "PostToolUse",
      patch,
      [{ start_line: 1, end_line: 3 }],
      makeCtx(TMP_ROOT),
    );

    const records = readRecords("test", "patch-sess") as Array<{
      hashes: string[];
      start_line: number;
      end_line: number;
      file: string;
    }>;
    expect(records).toHaveLength(1);
    expect(records[0]?.hashes).toHaveLength(3);
    expect(records[0]?.start_line).toBe(1);
    expect(records[0]?.end_line).toBe(3);
    expect(records[0]?.file).toBe("new.ts");
    for (const hash of records[0]?.hashes ?? []) {
      expect(hash).toMatch(/^murmur3:[0-9a-f]{8}$/);
    }
  });

  test("ignores --- and +++ header lines before first hunk", () => {
    const patch = [
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -0,0 +1,1 @@",
      "+actual content",
    ].join("\n");

    appendLineHashesFromPatch(
      "test",
      "patch-sess2",
      "file.ts",
      "PostToolUse",
      patch,
      [{ start_line: 1, end_line: 1 }],
      makeCtx(TMP_ROOT),
    );

    const records = readRecords("test", "patch-sess2") as Array<{
      hashes: string[];
    }>;
    expect(records).toHaveLength(1);
    expect(records[0]?.hashes).toHaveLength(1);
  });

  test("emits one record per range with per-hunk hashes", () => {
    const patch = [
      "diff --git a/file.ts b/file.ts",
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -1,2 +1,3 @@",
      " existing",
      "+alpha",
      " more",
      "@@ -10,2 +11,4 @@",
      " context",
      "+beta",
      "+gamma",
      " end",
    ].join("\n");

    appendLineHashesFromPatch(
      "test",
      "patch-sess3",
      "file.ts",
      "PostToolUse",
      patch,
      [
        { start_line: 1, end_line: 3 },
        { start_line: 11, end_line: 14 },
      ],
      makeCtx(TMP_ROOT),
    );

    const records = readRecords("test", "patch-sess3") as Array<{
      start_line: number;
      end_line: number;
      hashes: string[];
    }>;
    expect(records).toHaveLength(2);
    expect(records[0]?.start_line).toBe(1);
    expect(records[0]?.hashes).toHaveLength(1);
    expect(records[1]?.start_line).toBe(11);
    expect(records[1]?.hashes).toHaveLength(2);
  });

  test("hashes added lines starting with ++ inside hunks", () => {
    const patch = [
      "@@ -0,0 +1,2 @@",
      "+normal line",
      "++++triple plus content",
    ].join("\n");

    appendLineHashesFromPatch(
      "test",
      "patch-sess4",
      "file.ts",
      "PostToolUse",
      patch,
      [{ start_line: 1, end_line: 2 }],
      makeCtx(TMP_ROOT),
    );

    const records = readRecords("test", "patch-sess4") as Array<{
      hashes: string[];
    }>;
    expect(records).toHaveLength(1);
    expect(records[0]?.hashes).toHaveLength(2);
  });
});
