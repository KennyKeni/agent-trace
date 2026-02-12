#!/usr/bin/env bun

import {
  extractFilePathsFromRaw,
  type IgnoreConfig,
  isIgnored,
  loadConfig,
  scrubRawInput,
} from "./ignore";
import {
  appendTrace,
  computeRangePositions,
  createTrace,
  getWorkspaceRoot,
  tryReadFile,
} from "./trace-store";
import type {
  Extension,
  HookInput,
  ProviderAdapter,
  TraceEvent,
} from "./types";

export type { HookInput } from "./types";

const providerRegistry = new Map<string, ProviderAdapter>();

export function registerProvider(name: string, adapter: ProviderAdapter): void {
  providerRegistry.set(name, adapter);
}

const extensionRegistry = new Map<string, Extension>();

export function registerExtension(ext: Extension): void {
  extensionRegistry.set(ext.name, ext);
}

function parseProvider(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--provider") {
      return argv[i + 1] ?? undefined;
    }
    if (arg?.startsWith("--provider=")) {
      return arg.slice("--provider=".length) || undefined;
    }
  }
  return undefined;
}

export function activeExtensions(extensionNames: string[] | null): Extension[] {
  if (extensionNames === null) return [...extensionRegistry.values()];

  const active: Extension[] = [];
  for (const name of extensionNames) {
    const ext = extensionRegistry.get(name);
    if (ext) {
      active.push(ext);
    } else {
      console.error(`agent-trace: unknown extension "${name}", skipping`);
    }
  }
  return active;
}

function writeTrace(event: TraceEvent): void {
  const appendIfTrace = (trace: ReturnType<typeof createTrace>): void => {
    if (trace) appendTrace(trace);
  };

  switch (event.kind) {
    case "file_edit": {
      const edits = event.edits;
      const fileContent = event.readContent
        ? tryReadFile(event.filePath)
        : undefined;
      const rangePositions = edits.length
        ? computeRangePositions(edits, fileContent)
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

function shouldFilterRawInput(
  provider: string,
  input: HookInput,
  root: string,
  ignoreConfig: IgnoreConfig,
): boolean {
  const paths = extractFilePathsFromRaw(provider, input);
  if (paths === null) return false;
  if (paths.length === 0) return true;
  return paths.some((p) => isIgnored(p, root, ignoreConfig));
}

export async function runHook() {
  if (providerRegistry.size === 0) {
    console.error(
      'No providers registered. Import provider registrations before calling runHook() (e.g. import "./providers").',
    );
    process.exit(1);
  }

  const chunks: Buffer[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(Buffer.from(chunk));
  }

  const json = Buffer.concat(chunks).toString("utf-8").trim();
  if (!json) process.exit(0);

  try {
    const providerName = parseProvider(process.argv.slice(2));
    if (!providerName) {
      const registered = [...providerRegistry.keys()].join(", ");
      console.error(
        `Missing --provider flag. Registered providers: ${registered}`,
      );
      process.exit(1);
    }

    const adapter = providerRegistry.get(providerName);
    if (!adapter) {
      const registered = [...providerRegistry.keys()].join(", ");
      console.error(
        `Unknown provider "${providerName}". Registered providers: ${registered}`,
      );
      process.exit(1);
    }

    const input = JSON.parse(json) as HookInput;

    process.env.AGENT_TRACE_PROVIDER = providerName;

    const root = getWorkspaceRoot();
    const config = loadConfig(root);
    const sessionId = adapter.sessionIdFor(input);
    const extensions = activeExtensions(config.extensions);
    const { ignore: ignoreConfig } = config;

    const rawFiltered = shouldFilterRawInput(
      providerName,
      input,
      root,
      ignoreConfig,
    );

    for (const ext of extensions) {
      if (ext.onRawInput) {
        try {
          if (rawFiltered) {
            if (ignoreConfig.mode === "skip") continue;
            ext.onRawInput(providerName, sessionId, scrubRawInput(input));
          } else {
            ext.onRawInput(providerName, sessionId, input);
          }
        } catch (e) {
          console.error(`Extension error (${ext.name}/onRawInput):`, e);
        }
      }
    }

    const toolInfo = adapter.toolInfo?.();

    const result = adapter.adapt(input);
    if (result) {
      const events = Array.isArray(result) ? result : [result];
      for (const raw of events) {
        dispatchTraceEvent(raw, extensions, toolInfo, ignoreConfig);
      }
    }
  } catch (e) {
    console.error("Hook error:", e);
    process.exit(1);
  }
}

if (import.meta.main) void runHook();
