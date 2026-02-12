import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { registerExtension } from "../core/trace-hook";
import { getWorkspaceRoot } from "../core/trace-store";
import { normalizeNewlines } from "../core/utils";
import { ensureParent, nowIso, sanitizeSessionId } from "./helpers";

const TRACE_ROOT_DIR = ".agent-trace";

function normalizeLines(input: string): string[] {
  if (!input) return [];
  return normalizeNewlines(input).split("\n");
}

export function createPatchFromStrings(
  filePath: string,
  oldText: string | undefined,
  newText: string | undefined,
): string | undefined {
  if ((oldText ?? "") === (newText ?? "")) return undefined;

  const oldExists = oldText !== undefined;
  const newExists = newText !== undefined;
  const oldNorm = oldText ?? "";
  const newNorm = newText ?? "";
  const oldLines = normalizeLines(oldNorm);
  const newLines = normalizeLines(newNorm);

  const fromFile = oldExists ? `a/${filePath}` : "/dev/null";
  const toFile = newExists ? `b/${filePath}` : "/dev/null";
  const oldStart = oldLines.length === 0 ? 0 : 1;
  const newStart = newLines.length === 0 ? 0 : 1;

  const lines: string[] = [
    `diff --git a/${filePath} b/${filePath}`,
    `--- ${fromFile}`,
    `+++ ${toFile}`,
    `@@ -${oldStart},${oldLines.length} +${newStart},${newLines.length} @@`,
  ];

  for (const line of oldLines) lines.push(`-${line}`);
  for (const line of newLines) lines.push(`+${line}`);

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

registerExtension({
  name: "diffs",
  onTraceEvent(event) {
    if (event.kind !== "file_edit") return;
    if (event.diffs === false) return;
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
});
