import { describe, expect, it } from "bun:test";
import { parseHunksFromPatch, segmentPatchByFile } from "../parse-diff";

describe("parseHunksFromPatch", () => {
  it("extracts added hunk", () => {
    const patch = `@@ -10,0 +11,3 @@
+line1
+line2
+line3`;
    const hunks = parseHunksFromPatch(patch);
    expect(hunks).toEqual([
      { start_line: 11, end_line: 13, change_type: "added" },
    ]);
  });

  it("extracts modified hunk", () => {
    const patch = "@@ -10,5 +10,7 @@ context";
    const hunks = parseHunksFromPatch(patch);
    expect(hunks).toEqual([
      { start_line: 10, end_line: 16, change_type: "modified" },
    ]);
  });

  it("extracts deleted hunk (d=0)", () => {
    const patch = "@@ -5,3 +5,0 @@";
    const hunks = parseHunksFromPatch(patch);
    expect(hunks).toEqual([
      { start_line: 5, end_line: 5, change_type: "deleted" },
    ]);
  });

  it("anchors deletion hunk to max(1, c) when c=0", () => {
    // Entire file emptied: @@ -1,5 +0,0 @@
    const patch = "@@ -1,5 +0,0 @@";
    const hunks = parseHunksFromPatch(patch);
    expect(hunks).toEqual([
      { start_line: 1, end_line: 1, change_type: "deleted" },
    ]);
  });

  it("handles multiple hunks", () => {
    const patch = `@@ -1,3 +1,4 @@
 line
+added
 line
@@ -20,2 +21,5 @@
 line
+a
+b
+c`;
    const hunks = parseHunksFromPatch(patch);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toEqual({
      start_line: 1,
      end_line: 4,
      change_type: "modified",
    });
    expect(hunks[1]).toEqual({
      start_line: 21,
      end_line: 25,
      change_type: "modified",
    });
  });

  it("handles single-line hunk without count", () => {
    const patch = "@@ -1 +1 @@\n-old\n+new";
    const hunks = parseHunksFromPatch(patch);
    expect(hunks).toEqual([
      { start_line: 1, end_line: 1, change_type: "modified" },
    ]);
  });

  it("returns empty for non-diff input", () => {
    expect(parseHunksFromPatch("nothing here")).toEqual([]);
    expect(parseHunksFromPatch("")).toEqual([]);
  });

  it("skips hunk where both old and new count are 0", () => {
    const patch = "@@ -0,0 +0,0 @@";
    expect(parseHunksFromPatch(patch)).toEqual([]);
  });

  it("handles addition-only hunk at start of file", () => {
    const patch = "@@ -0,0 +1,5 @@";
    const hunks = parseHunksFromPatch(patch);
    expect(hunks).toEqual([
      { start_line: 1, end_line: 5, change_type: "added" },
    ]);
  });
});

describe("segmentPatchByFile", () => {
  it("segments multi-file patch output", () => {
    const raw = `diff --git a/foo.ts b/foo.ts
index abc..def 100644
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,4 @@
 line
+added
diff --git a/bar.ts b/bar.ts
index 111..222 100644
--- a/bar.ts
+++ b/bar.ts
@@ -5,0 +6,2 @@
+new1
+new2`;
    const map = segmentPatchByFile(raw);
    expect(map.size).toBe(2);
    expect(map.has("foo.ts")).toBe(true);
    expect(map.has("bar.ts")).toBe(true);
    expect(map.get("foo.ts")).toContain("@@ -1,3 +1,4 @@");
    expect(map.get("bar.ts")).toContain("@@ -5,0 +6,2 @@");
  });

  it("returns empty map for empty input", () => {
    expect(segmentPatchByFile("")).toEqual(new Map());
  });

  it("handles single file", () => {
    const raw = `diff --git a/only.ts b/only.ts
@@ -1 +1 @@
-old
+new`;
    const map = segmentPatchByFile(raw);
    expect(map.size).toBe(1);
    expect(map.has("only.ts")).toBe(true);
  });

  it("uses +++ b/ path for files with spaces", () => {
    const raw = `diff --git a/path with spaces/file.ts b/path with spaces/file.ts
--- a/path with spaces/file.ts
+++ b/path with spaces/file.ts
@@ -1 +1 @@
-old
+new`;
    const map = segmentPatchByFile(raw);
    expect(map.size).toBe(1);
    expect(map.has("path with spaces/file.ts")).toBe(true);
  });

  it("uses +++ b/ path for renames where a/ and b/ differ", () => {
    const raw = `diff --git a/old name.ts b/new name.ts
--- a/old name.ts
+++ b/new name.ts
@@ -1 +1,2 @@
 existing
+added`;
    const map = segmentPatchByFile(raw);
    expect(map.size).toBe(1);
    expect(map.has("new name.ts")).toBe(true);
  });

  it("falls back to diff --git header for binary sections (no +++ line)", () => {
    const raw = `diff --git a/image.png b/image.png
Binary files a/image.png and b/image.png differ`;
    const map = segmentPatchByFile(raw);
    expect(map.size).toBe(1);
    expect(map.has("image.png")).toBe(true);
    expect(map.get("image.png")).toContain("Binary files");
  });

  it("handles deleted files (+++ /dev/null) using diff --git fallback", () => {
    const raw = `diff --git a/removed.ts b/removed.ts
--- a/removed.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-line1
-line2
-line3`;
    const map = segmentPatchByFile(raw);
    expect(map.size).toBe(1);
    expect(map.has("removed.ts")).toBe(true);
  });
});
