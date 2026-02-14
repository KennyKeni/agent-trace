import { type IgnoreConfig, isIgnored } from "./ignore";
import {
  appendTrace,
  computeRangePositions,
  createTrace,
  getWorkspaceRoot,
  tryReadFile,
} from "./trace-store";
import type { Extension, TraceEvent } from "./types";

function writeTrace(event: TraceEvent): void {
  const appendIfTrace = (trace: ReturnType<typeof createTrace>): void => {
    if (trace) appendTrace(trace);
  };

  switch (event.kind) {
    case "file_edit": {
      const rangePositions = event.snapshotRanges
        ? event.snapshotRanges
        : event.edits.length
          ? computeRangePositions(
              event.edits,
              event.readContent ? tryReadFile(event.filePath) : undefined,
            )
          : undefined;

      appendIfTrace(
        createTrace("ai", event.filePath, {
          model: event.model,
          rangePositions,
          transcript: event.transcript,
          tool: event.tool,
          metadata: event.meta,
        }),
      );
      break;
    }
    case "shell": {
      appendIfTrace(
        createTrace("ai", ".shell-history", {
          model: event.model,
          transcript: event.transcript,
          tool: event.tool,
          metadata: event.meta,
        }),
      );
      break;
    }
    case "session_start": {
      appendIfTrace(
        createTrace("ai", ".sessions", {
          model: event.model,
          tool: event.tool,
          metadata: { event: "session_start", ...event.meta },
        }),
      );
      break;
    }
    case "session_end": {
      appendIfTrace(
        createTrace("ai", ".sessions", {
          model: event.model,
          tool: event.tool,
          metadata: { event: "session_end", ...event.meta },
        }),
      );
      break;
    }
    case "message":
      break;
  }
}

function applyIgnoreFilter(
  event: TraceEvent,
  root: string,
  ignoreConfig: IgnoreConfig,
): TraceEvent | null {
  if (event.kind !== "file_edit") return event;
  if (!isIgnored(event.filePath, root, ignoreConfig)) return event;

  if (ignoreConfig.mode === "skip") return null;

  return {
    ...event,
    edits: [],
    snapshotRanges: undefined,
    precomputedPatch: undefined,
    diffs: false,
    readContent: false,
    meta: { ...event.meta, redacted: true },
  };
}

export function dispatchTraceEvent(
  event: TraceEvent,
  extensions: Extension[],
  toolInfo?: { name: string; version?: string },
  ignoreConfig?: IgnoreConfig,
): void {
  const root = getWorkspaceRoot();
  const enrichedEvent = toolInfo ? { ...event, tool: toolInfo } : event;

  const filtered = ignoreConfig
    ? applyIgnoreFilter(enrichedEvent, root, ignoreConfig)
    : enrichedEvent;
  if (!filtered) return;

  writeTrace(filtered);
  for (const ext of extensions) {
    if (ext.onTraceEvent) {
      try {
        ext.onTraceEvent(filtered);
      } catch (e) {
        console.error(`Extension error (${ext.name}/onTraceEvent):`, e);
      }
    }
  }
}
