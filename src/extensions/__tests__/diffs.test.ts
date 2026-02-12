import { describe, expect, it } from "bun:test";
import { createPatchFromStrings } from "../diffs";

describe("createPatchFromStrings", () => {
  it("returns undefined for identical strings", () => {
    expect(
      createPatchFromStrings("file.ts", "hello\n", "hello\n"),
    ).toBeUndefined();
  });

  it("returns undefined when both are undefined", () => {
    expect(
      createPatchFromStrings("file.ts", undefined, undefined),
    ).toBeUndefined();
  });

  it("produces a targeted hunk for a single-line change", () => {
    const old = "line1\nline2\nline3\nline4\nline5\n";
    const new_ = "line1\nline2\nchanged\nline4\nline5\n";
    const patch = createPatchFromStrings("file.ts", old, new_);

    expect(patch).toContain("diff --git a/file.ts b/file.ts");
    expect(patch).toContain("--- a/file.ts");
    expect(patch).toContain("+++ b/file.ts");
    expect(patch).toContain("-line3");
    expect(patch).toContain("+changed");
    expect(patch).toContain(" line2");
    expect(patch).toContain(" line4");
  });

  it("handles addition at beginning with context", () => {
    const old = "line1\nline2\nline3\n";
    const new_ = "added\nline1\nline2\nline3\n";
    const patch = createPatchFromStrings("file.ts", old, new_);

    expect(patch).toContain("+added");
    expect(patch).toContain(" line1");
  });

  it("handles addition at end with context", () => {
    const old = "line1\nline2\nline3\n";
    const new_ = "line1\nline2\nline3\nadded\n";
    const patch = createPatchFromStrings("file.ts", old, new_);

    expect(patch).toContain("+added");
    expect(patch).toContain(" line3");
  });

  it("produces multiple hunks for scattered changes", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`);
    const oldText = `${lines.join("\n")}\n`;
    const modified = [...lines];
    modified[2] = "changed3";
    modified[17] = "changed18";
    const newText = `${modified.join("\n")}\n`;
    const patch = createPatchFromStrings("file.ts", oldText, newText);

    const hunkHeaders = patch?.match(/^@@.*@@$/gm) ?? [];
    expect(hunkHeaders.length).toBe(2);
    expect(patch).toContain("-line3");
    expect(patch).toContain("+changed3");
    expect(patch).toContain("-line18");
    expect(patch).toContain("+changed18");
  });

  it("handles new file (old=undefined)", () => {
    const patch = createPatchFromStrings("new.ts", undefined, "content\n");

    expect(patch).toContain("--- /dev/null");
    expect(patch).toContain("+++ b/new.ts");
    expect(patch).toContain("+content");
    expect(patch).not.toContain("-content");
  });

  it("handles deleted file (new=undefined)", () => {
    const patch = createPatchFromStrings("old.ts", "content\n", undefined);

    expect(patch).toContain("--- a/old.ts");
    expect(patch).toContain("+++ /dev/null");
    expect(patch).toContain("-content");
    expect(patch).not.toContain("+content");
  });

  it("handles empty string to content", () => {
    const patch = createPatchFromStrings("file.ts", "", "new content\n");

    expect(patch).toContain("+new content");
  });

  it("normalizes CRLF line endings", () => {
    const old = "line1\r\nline2\r\n";
    const new_ = "line1\r\nchanged\r\n";
    const patch = createPatchFromStrings("file.ts", old, new_);

    expect(patch).toContain("-line2");
    expect(patch).toContain("+changed");
    expect(patch).not.toContain("\r");
  });
});
