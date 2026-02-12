import { describe, expect, test } from "bun:test";
import { computeRangePositions, toRelativePath } from "../trace-store";

describe("toRelativePath", () => {
  test("converts in-root absolute paths to repo-relative paths", () => {
    const result = toRelativePath("/tmp/project/src/index.ts", "/tmp/project");
    expect(result).toBe("src/index.ts");
  });

  test("does not treat sibling-prefix paths as in-root", () => {
    const result = toRelativePath("/tmp/projectx/src/index.ts", "/tmp/project");
    expect(result).toBeUndefined();
  });

  test("returns relative paths unchanged", () => {
    const result = toRelativePath("src/index.ts", "/tmp/project");
    expect(result).toBe("src/index.ts");
  });

  test("rejects relative paths that escape root via ../", () => {
    expect(toRelativePath("../outside.ts", "/tmp/project")).toBeUndefined();
    expect(toRelativePath("../../etc/passwd", "/tmp/project")).toBeUndefined();
  });

  test("rejects bare '..' as relative path", () => {
    expect(toRelativePath("..", "/tmp/project")).toBeUndefined();
  });

  test("returns undefined for path equal to root", () => {
    expect(toRelativePath("/tmp/project", "/tmp/project")).toBeUndefined();
  });
});

describe("computeRangePositions", () => {
  test("returns content_hash in murmur3:<8-hex> format", () => {
    const positions = computeRangePositions([
      { old_string: "", new_string: "hello world" },
    ]);
    expect(positions).toHaveLength(1);
    expect(positions[0]?.content_hash).toMatch(/^murmur3:[0-9a-f]{8}$/);
  });

  test("same input produces same hash (deterministic)", () => {
    const a = computeRangePositions([
      { old_string: "", new_string: "deterministic" },
    ]);
    const b = computeRangePositions([
      { old_string: "", new_string: "deterministic" },
    ]);
    expect(a[0]?.content_hash).toBe(b[0]?.content_hash);
  });

  test("different input produces different hash", () => {
    const a = computeRangePositions([{ old_string: "", new_string: "alpha" }]);
    const b = computeRangePositions([{ old_string: "", new_string: "beta" }]);
    expect(a[0]?.content_hash).not.toBe(b[0]?.content_hash);
  });

  test("hash is derived from new_string, not file content", () => {
    const withContent = computeRangePositions(
      [{ old_string: "", new_string: "target" }],
      "prefix\ntarget\nsuffix",
    );
    const withoutContent = computeRangePositions([
      { old_string: "", new_string: "target" },
    ]);
    expect(withContent[0]?.content_hash).toBe(withoutContent[0]?.content_hash);
    expect(withContent[0]?.start_line).toBe(2);
    expect(withoutContent[0]?.start_line).toBe(1);
  });

  test("works for edits with explicit range", () => {
    const positions = computeRangePositions([
      {
        old_string: "old",
        new_string: "new code",
        range: {
          start_line_number: 10,
          end_line_number: 15,
          start_column: 1,
          end_column: 1,
        },
      },
    ]);
    expect(positions).toHaveLength(1);
    expect(positions[0]?.start_line).toBe(10);
    expect(positions[0]?.end_line).toBe(15);
    expect(positions[0]?.content_hash).toMatch(/^murmur3:[0-9a-f]{8}$/);
  });
});
