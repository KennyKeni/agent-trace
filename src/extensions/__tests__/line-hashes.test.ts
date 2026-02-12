import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { appendLineHashes } from "../line-hashes";

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
      TMP_ROOT,
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
      TMP_ROOT,
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
      TMP_ROOT,
    );
    appendLineHashes(
      "test",
      "sess1",
      "b.ts",
      "PostToolUse",
      [{ old_string: "", new_string: "identical" }],
      undefined,
      TMP_ROOT,
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
      TMP_ROOT,
    );
    appendLineHashes(
      "test",
      "sess1",
      "b.ts",
      "PostToolUse",
      [{ old_string: "", new_string: "beta" }],
      undefined,
      TMP_ROOT,
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
      TMP_ROOT,
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
      TMP_ROOT,
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
      TMP_ROOT,
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
      TMP_ROOT,
    );

    const records = readRecords("test", "sess1") as Array<{
      hashes: string[];
    }>;
    expect(records[0]?.hashes).toHaveLength(3);
    expect(records[0]?.hashes?.[1]).toMatch(/^murmur3:[0-9a-f]{8}$/);
  });
});
