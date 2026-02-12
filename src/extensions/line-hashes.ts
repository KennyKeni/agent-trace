import { join } from "node:path";
import { registerExtension } from "../core/trace-hook";
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

registerExtension({
  name: "line-hashes",
  onTraceEvent(event) {
    if (event.kind !== "file_edit") return;
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
});
