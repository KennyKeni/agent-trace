#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { join } from "node:path";
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

function loadExtensionConfig(root: string): string[] | null {
  const configPath = join(root, ".agent-trace", "config.json");
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf-8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray(parsed.extensions)
    ) {
      return parsed.extensions.filter(
        (e: unknown): e is string => typeof e === "string",
      );
    }
    console.error(
      "agent-trace: config.json missing 'extensions' array, running all extensions",
    );
    return null;
  } catch {
    console.error("agent-trace: malformed config.json, running all extensions");
    return null;
  }
}

function activeExtensions(root: string): Extension[] {
  const allowlist = loadExtensionConfig(root);
  if (allowlist === null) return [...extensionRegistry.values()];

  const active: Extension[] = [];
  for (const name of allowlist) {
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

    const sessionId = adapter.sessionIdFor(input);
    const extensions = activeExtensions(getWorkspaceRoot());

    for (const ext of extensions) {
      if (ext.onRawInput) {
        try {
          ext.onRawInput(providerName, sessionId, input);
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
        const event = toolInfo ? { ...raw, tool: toolInfo } : raw;
        writeTrace(event);
        for (const ext of extensions) {
          if (ext.onTraceEvent) {
            try {
              ext.onTraceEvent(event);
            } catch (e) {
              console.error(`Extension error (${ext.name}/onTraceEvent):`, e);
            }
          }
        }
      }
    }
  } catch (e) {
    console.error("Hook error:", e);
    process.exit(1);
  }
}

if (import.meta.main) void runHook();
