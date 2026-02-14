import type { Hunk } from "./types";

const HUNK_HEADER = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

/**
 * Parse hunks from a single-file unified diff patch text.
 * Expects output from `git diff-tree -p` already segmented per file.
 * Returns Hunk[] with change_type classification.
 */
export function parseHunksFromPatch(patch: string): Hunk[] {
  const hunks: Hunk[] = [];

  for (const line of patch.split("\n")) {
    const m = HUNK_HEADER.exec(line);
    if (!m) continue;

    const oldCount = m[2] !== undefined ? Number.parseInt(m[2], 10) : 1;
    const newStart = Number.parseInt(m[3] ?? "1", 10);
    const newCount = m[4] !== undefined ? Number.parseInt(m[4], 10) : 1;

    if (newCount === 0 && oldCount === 0) continue;

    if (newCount === 0) {
      // Deletion-only hunk: no lines in new file.
      // Anchor to max(1, newStart) to avoid start_line: 0.
      const anchor = Math.max(1, newStart);
      hunks.push({
        start_line: anchor,
        end_line: anchor,
        change_type: "deleted",
      });
    } else if (oldCount === 0) {
      // Addition-only hunk: lines exist only in new file.
      hunks.push({
        start_line: newStart,
        end_line: newStart + newCount - 1,
        change_type: "added",
      });
    } else {
      // Lines changed in both old and new file.
      hunks.push({
        start_line: newStart,
        end_line: newStart + newCount - 1,
        change_type: "modified",
      });
    }
  }

  return hunks;
}

/**
 * Segment a multi-file `git diff-tree -p` output into per-file patches.
 * Returns a map from file path to its patch text.
 *
 * Uses `+++ b/<path>` for authoritative path resolution (unambiguous).
 * Falls back to `diff --git a/... b/...` header for sections without
 * a `+++` line (binary diffs, pure deletes).
 *
 * Known limitation: This parser is line-based and assumes unquoted paths.
 * Callers should use `-c core.quotePath=false` when invoking git to prevent
 * quoting. Filenames with literal newlines can still break segmentation
 * since git has no way to represent them in text-mode diff headers.
 */
export function segmentPatchByFile(rawPatch: string): Map<string, string> {
  const result = new Map<string, string>();
  const diffStart = /^diff --git a\/.+ b\/(.+)$/;
  const bFileHeader = /^\+\+\+ b\/(.+)$/;

  let fallbackPath: string | undefined;
  let resolvedPath: string | undefined;
  let currentLines: string[] = [];

  function flush() {
    const path = resolvedPath ?? fallbackPath;
    if (path !== undefined) {
      result.set(path, currentLines.join("\n"));
    }
  }

  for (const line of rawPatch.split("\n")) {
    const diffMatch = diffStart.exec(line);
    if (diffMatch) {
      flush();
      fallbackPath = diffMatch[1];
      resolvedPath = undefined;
      currentLines = [line];
    } else {
      if (resolvedPath === undefined) {
        const bMatch = bFileHeader.exec(line);
        if (bMatch && bMatch[1] !== "/dev/null") {
          resolvedPath = bMatch[1];
        }
      }
      currentLines.push(line);
    }
  }
  flush();

  return result;
}
