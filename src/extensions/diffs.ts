import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { structuredPatch } from "diff";
import { getWorkspaceRoot } from "../core/trace-store";
import { normalizeNewlines } from "../core/utils";
import { ensureParent, nowIso, sanitizeSessionId } from "./helpers";

const TRACE_ROOT_DIR = ".agent-trace";

export function createPatchFromStrings(
  filePath: string,
  oldText: string | undefined,
  newText: string | undefined,
): string | undefined {
  if ((oldText ?? "") === (newText ?? "")) return undefined;

  const oldExists = oldText !== undefined;
  const newExists = newText !== undefined;
  const oldNorm = normalizeNewlines(oldText ?? "");
  const newNorm = normalizeNewlines(newText ?? "");

  const fromFile = oldExists ? `a/${filePath}` : "/dev/null";
  const toFile = newExists ? `b/${filePath}` : "/dev/null";

  const patch = structuredPatch(fromFile, toFile, oldNorm, newNorm, "", "", {
    context: 3,
  });

  if (patch.hunks.length === 0) return undefined;

  const lines: string[] = [
    `diff --git a/${filePath} b/${filePath}`,
    `--- ${fromFile}`,
    `+++ ${toFile}`,
  ];

  for (const hunk of patch.hunks) {
    lines.push(
      `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    );
    for (const line of hunk.lines) {
      lines.push(line);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function appendDiffArtifact(
  provider: string,
  sessionId: string | undefined,
  filePath: string,
  eventName: string,
  diff: string,
  root = getWorkspaceRoot(),
): string {
  const sid = sanitizeSessionId(sessionId);
  const path = join(root, TRACE_ROOT_DIR, "diffs", provider, `${sid}.patch`);
  ensureParent(path);
  const section = [
    `# event=${eventName} file=${filePath} timestamp=${nowIso()}`,
    diff.trimEnd(),
    "",
  ].join("\n");
  appendFileSync(path, section, "utf-8");
  return `file://${path}`;
}

export const diffsExtension = {
  name: "diffs",
  onTraceEvent(event: import("../core/types").TraceEvent) {
    if (event.kind !== "file_edit") return;
    if (event.diffs === false) return;

    if (event.precomputedPatch) {
      appendDiffArtifact(
        event.provider,
        event.sessionId,
        event.filePath,
        event.eventName,
        event.precomputedPatch,
      );
      return;
    }

    for (const edit of event.edits) {
      const diff = createPatchFromStrings(
        event.filePath,
        edit.old_string,
        edit.new_string,
      );
      if (diff) {
        appendDiffArtifact(
          event.provider,
          event.sessionId,
          event.filePath,
          event.eventName,
          diff,
        );
      }
    }
  },
};
