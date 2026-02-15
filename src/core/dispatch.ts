import { type IgnoreConfig, isIgnored } from "./ignore";
import type { Extension, ExtensionContext, PipelineEvent } from "./types";

function applyIgnoreFilter(
  event: PipelineEvent,
  root: string,
  ignoreConfig: IgnoreConfig,
): PipelineEvent | null {
  if (event.kind !== "file_edit") return event;
  if (!isIgnored(event.filePath, root, ignoreConfig)) return event;

  if (ignoreConfig.mode === "skip") return null;

  return {
    ...event,
    edits: [],
    snapshotRanges: undefined,
    precomputedPatch: undefined,
    hunkPatch: undefined,
    meta: { ...event.meta, redacted: true },
  };
}

export function dispatchTraceEvent(
  event: PipelineEvent,
  extensions: Extension[],
  ctx: ExtensionContext,
  ignoreConfig?: IgnoreConfig,
): void {
  const filtered = ignoreConfig
    ? applyIgnoreFilter(event, ctx.root, ignoreConfig)
    : event;
  if (!filtered) return;

  for (const ext of extensions) {
    if (ext.onTraceEvent) {
      try {
        ext.onTraceEvent(filtered, ctx);
      } catch (e) {
        console.error(`Extension error (${ext.name}/onTraceEvent):`, e);
      }
    }
  }
}
