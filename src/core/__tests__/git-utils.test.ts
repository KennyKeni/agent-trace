import { describe, expect, it } from "bun:test";
import { diffChangedPaths, parseRangesFromUnifiedDiff } from "../git-utils";

describe("parseRangesFromUnifiedDiff", () => {
  it("extracts ranges from a single hunk", () => {
    const diff = `--- a/file.ts
+++ b/file.ts
@@ -10,5 +10,7 @@ some context
 unchanged
+new line 1
+new line 2
 unchanged`;
    const ranges = parseRangesFromUnifiedDiff(diff);
    expect(ranges).toEqual([{ start_line: 10, end_line: 16 }]);
  });

  it("extracts ranges from multiple hunks", () => {
    const diff = `--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@ first
 line
+added
 line
@@ -20,2 +21,5 @@ second
 line
+a
+b
+c`;
    const ranges = parseRangesFromUnifiedDiff(diff);
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toEqual({ start_line: 1, end_line: 4 });
    expect(ranges[1]).toEqual({ start_line: 21, end_line: 25 });
  });

  it("handles single-line hunk without count", () => {
    const diff = `@@ -1 +1 @@
-old
+new`;
    const ranges = parseRangesFromUnifiedDiff(diff);
    expect(ranges).toEqual([{ start_line: 1, end_line: 1 }]);
  });

  it("returns empty for non-diff input", () => {
    expect(parseRangesFromUnifiedDiff("nothing here")).toEqual([]);
    expect(parseRangesFromUnifiedDiff("")).toEqual([]);
  });

  it("handles zero-line hunk count", () => {
    const diff = "@@ -5,3 +5,0 @@";
    const ranges = parseRangesFromUnifiedDiff(diff);
    expect(ranges).toEqual([{ start_line: 5, end_line: 5 }]);
  });
});

describe("diffChangedPaths", () => {
  it("detects new files", () => {
    const before = new Map<string, string>();
    const after = new Map([["file.ts", "abc123"]]);
    expect(diffChangedPaths(before, after)).toEqual(["file.ts"]);
  });

  it("detects changed files", () => {
    const before = new Map([["file.ts", "abc123"]]);
    const after = new Map([["file.ts", "def456"]]);
    expect(diffChangedPaths(before, after)).toEqual(["file.ts"]);
  });

  it("detects deleted files", () => {
    const before = new Map([["file.ts", "abc123"]]);
    const after = new Map<string, string>();
    expect(diffChangedPaths(before, after)).toEqual(["file.ts"]);
  });

  it("returns empty when nothing changed", () => {
    const state = new Map([["file.ts", "abc123"]]);
    expect(diffChangedPaths(state, new Map(state))).toEqual([]);
  });

  it("handles mixed changes", () => {
    const before = new Map([
      ["a.ts", "111"],
      ["b.ts", "222"],
      ["c.ts", "333"],
    ]);
    const after = new Map([
      ["a.ts", "111"],
      ["b.ts", "999"],
      ["d.ts", "444"],
    ]);
    const result = diffChangedPaths(before, after);
    expect(result).toContain("b.ts");
    expect(result).toContain("d.ts");
    expect(result).toContain("c.ts");
    expect(result).not.toContain("a.ts");
  });
});
