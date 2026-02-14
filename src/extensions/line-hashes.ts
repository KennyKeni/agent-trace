import { join } from "node:path";
import { getWorkspaceRoot, tryReadFile } from "../core/trace-store";
import type { FileEdit } from "../core/types";
import { normalizeNewlines, resolvePosition } from "../core/utils";
import { appendJsonl, nowIso, sanitizeSessionId } from "./helpers";

const TRACE_ROOT_DIR = ".agent-trace";

function lineHash(line: string): string {
  const h = Bun.hash.murmur32v3(line, 0) >>> 0;
  return `murmur3:${h.toString(16).padStart(8, "0")}`;
}

export function appendLineHashes(
  provider: string,
  sessionId: string | undefined,
  filePath: string,
  eventName: string,
  edits: FileEdit[],
  fileContent?: string,
  root = getWorkspaceRoot(),
): void {
  const sid = sanitizeSessionId(sessionId);
  const path = join(
    root,
    TRACE_ROOT_DIR,
    "line-hashes",
    provider,
    `${sid}.jsonl`,
  );

  for (const edit of edits) {
    if (!edit.new_string) continue;

    const lines = normalizeNewlines(edit.new_string).split("\n");
    const hashes = lines.map(lineHash);
    const pos = resolvePosition(edit, fileContent);

    appendJsonl(path, {
      timestamp: nowIso(),
      file: filePath,
      event: eventName,
      start_line: pos.start_line,
      end_line: pos.end_line,
      hashes,
    });
  }
}

function extractAddedLinesByHunk(patch: string): string[][] {
  const hunks: string[][] = [];
  let current: string[] | undefined;
  let seenHunkHeader = false;
  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) {
      if (current) hunks.push(current);
      current = [];
      seenHunkHeader = true;
    } else if (
      !seenHunkHeader &&
      (line.startsWith("+++") || line.startsWith("---"))
    ) {
    } else if (current && line.startsWith("+")) {
      current.push(line.slice(1));
    }
  }
  if (current) hunks.push(current);
  return hunks;
}

export function appendLineHashesFromPatch(
  provider: string,
  sessionId: string | undefined,
  filePath: string,
  eventName: string,
  patch: string,
  ranges: Array<{ start_line: number; end_line: number }>,
  root = getWorkspaceRoot(),
): void {
  const sid = sanitizeSessionId(sessionId);
  const path = join(
    root,
    TRACE_ROOT_DIR,
    "line-hashes",
    provider,
    `${sid}.jsonl`,
  );
  const hunkLines = extractAddedLinesByHunk(patch);

  if (hunkLines.length !== ranges.length) {
    console.warn(
      `[agent-trace] line-hashes: hunk count (${hunkLines.length}) != range count (${ranges.length})`,
    );
  }

  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i];
    if (!range) continue;
    const lines = hunkLines[i] ?? [];
    if (lines.length === 0) continue;
    const hashes = lines.map(lineHash);
    appendJsonl(path, {
      timestamp: nowIso(),
      file: filePath,
      event: eventName,
      start_line: range.start_line,
      end_line: range.end_line,
      hashes,
    });
  }
}

export const lineHashesExtension = {
  name: "line-hashes",
  onTraceEvent(event: import("../core/types").TraceEvent) {
    if (event.kind !== "file_edit") return;

    const patchForHashes = event.hunkPatch ?? event.precomputedPatch;
    if (
      patchForHashes &&
      event.snapshotRanges &&
      event.snapshotRanges.length > 0
    ) {
      appendLineHashesFromPatch(
        event.provider,
        event.sessionId,
        event.filePath,
        event.eventName,
        patchForHashes,
        event.snapshotRanges,
      );
      return;
    }

    if (event.edits.length === 0) return;
    const fileContent = event.readContent
      ? tryReadFile(event.filePath)
      : undefined;
    appendLineHashes(
      event.provider,
      event.sessionId,
      event.filePath,
      event.eventName,
      event.edits,
      fileContent,
    );
  },
};
