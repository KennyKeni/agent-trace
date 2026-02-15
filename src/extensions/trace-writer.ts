import {
  appendTrace,
  computeRangePositions,
  createTrace,
} from "../core/trace-store";
import type { Extension, ExtensionContext, PipelineEvent } from "../core/types";

function transcriptPath(meta: Record<string, unknown>): string | undefined {
  const v = meta.transcript_path;
  return typeof v === "string" ? v : undefined;
}

function stripTranscript(
  meta: Record<string, unknown>,
): Record<string, unknown> {
  if (!("transcript_path" in meta)) return meta;
  const { transcript_path: _, ...rest } = meta;
  return rest;
}

export const traceWriterExtension: Extension = {
  name: "_trace-writer",
  onTraceEvent(event: PipelineEvent, ctx: ExtensionContext) {
    const appendIfTrace = (trace: ReturnType<typeof createTrace>): void => {
      if (trace) appendTrace(trace, ctx.root);
    };

    switch (event.kind) {
      case "file_edit": {
        const rangePositions = event.snapshotRanges
          ? event.snapshotRanges
          : event.edits.length
            ? computeRangePositions(
                event.edits,
                event.edits.some((e) => e.new_string && !e.range)
                  ? ctx.tryReadFile(event.filePath)
                  : undefined,
              )
            : undefined;

        appendIfTrace(
          createTrace("ai", event.filePath, {
            root: ctx.root,
            model: event.model,
            rangePositions,
            transcript: transcriptPath(event.meta),
            tool: ctx.toolInfo,
            metadata: stripTranscript(event.meta),
          }),
        );
        break;
      }
      case "shell": {
        appendIfTrace(
          createTrace("ai", ".shell-history", {
            root: ctx.root,
            model: event.model,
            transcript: transcriptPath(event.meta),
            tool: ctx.toolInfo,
            metadata: stripTranscript(event.meta),
          }),
        );
        break;
      }
      case "session_start": {
        appendIfTrace(
          createTrace("ai", ".sessions", {
            root: ctx.root,
            model: event.model,
            tool: ctx.toolInfo,
            metadata: { event: "session_start", ...event.meta },
          }),
        );
        break;
      }
      case "session_end": {
        appendIfTrace(
          createTrace("ai", ".sessions", {
            root: ctx.root,
            model: event.model,
            tool: ctx.toolInfo,
            metadata: { event: "session_end", ...event.meta },
          }),
        );
        break;
      }
      case "message":
        break;
    }
  },
};
