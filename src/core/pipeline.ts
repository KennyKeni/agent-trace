import { appendFileSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { traceWriterExtension } from "../extensions/trace-writer";
import { dispatchTraceEvent } from "./dispatch";
import {
  extractFilePathsFromRaw,
  type IgnoreConfig,
  isIgnored,
  isInitialized,
  loadConfig,
  scrubRawInput,
} from "./ignore";
import { writeRawEvent } from "./raw-capture";
import {
  activeExtensions,
  getProvider,
  registeredProviderNames,
} from "./registry";
import {
  handlePostShell,
  handlePreHook,
  type SnapshotContext,
} from "./snapshot-middleware";
import { getWorkspaceRoot } from "./trace-store";
import type { ExtensionContext, HookInput } from "./types";
import { ensureParent } from "./utils";

function buildExtensionContext(
  root: string,
  toolInfo?: { name: string; version?: string },
): ExtensionContext {
  return {
    root,
    toolInfo,
    appendJsonl(path: string, value: unknown) {
      ensureParent(path);
      appendFileSync(path, `${JSON.stringify(value)}\n`, "utf-8");
    },
    appendText(path: string, text: string) {
      ensureParent(path);
      appendFileSync(path, text, "utf-8");
    },
    tryReadFile(path: string) {
      try {
        const resolved = isAbsolute(path) ? path : resolve(root, path);
        return readFileSync(resolved, "utf-8");
      } catch {
        return undefined;
      }
    },
  };
}

function filterDeletedPaths(
  paths: string[],
  root: string,
  ignoreConfig: IgnoreConfig,
): string[] {
  const result: string[] = [];
  for (const p of paths) {
    if (!isIgnored(p, root, ignoreConfig)) {
      result.push(p);
    } else if (ignoreConfig.mode === "redact") {
      result.push("<redacted>");
    }
  }
  return result;
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

export interface HookResult {
  preHandled: boolean;
  adapterEventCount: number;
  snapshotEventCount: number;
}

export async function processHookInput(
  providerName: string,
  input: HookInput,
  opts?: { workspaceRoot?: string },
): Promise<HookResult> {
  const adapter = getProvider(providerName);
  if (!adapter) {
    const registered = registeredProviderNames().join(", ");
    throw new Error(
      `Unknown provider "${providerName}". Registered providers: ${registered}`,
    );
  }

  const prevRoot = process.env.AGENT_TRACE_WORKSPACE_ROOT;
  const prevProvider = process.env.AGENT_TRACE_PROVIDER;
  try {
    if (opts?.workspaceRoot) {
      process.env.AGENT_TRACE_WORKSPACE_ROOT = opts.workspaceRoot;
    }
    process.env.AGENT_TRACE_PROVIDER = providerName;

    const root = getWorkspaceRoot();
    if (!isInitialized(root)) {
      return { preHandled: false, adapterEventCount: 0, snapshotEventCount: 0 };
    }
    const config = loadConfig(root);
    const sessionId = adapter.sessionIdFor(input);
    const userExtensions = activeExtensions(config.extensions);
    const extensions = [traceWriterExtension, ...userExtensions];
    const { ignore: ignoreConfig } = config;

    const ctx = buildExtensionContext(root, adapter.toolInfo?.());
    const capabilities = new Set(
      extensions.flatMap((e) => e.capabilities ?? []),
    );

    if (config.rawCapture) {
      try {
        const rawFiltered = shouldFilterRawInput(
          providerName,
          input,
          root,
          ignoreConfig,
        );
        if (rawFiltered) {
          if (ignoreConfig.mode !== "skip") {
            writeRawEvent(providerName, sessionId, scrubRawInput(input), ctx);
          }
        } else {
          writeRawEvent(providerName, sessionId, input, ctx);
        }
      } catch (e) {
        console.error("[agent-trace] Raw capture failed:", e);
      }
    }

    const result = adapter.adapt(input);
    const adapterEvents = result
      ? Array.isArray(result)
        ? result
        : [result]
      : [];

    const snapshotCtx: SnapshotContext = {
      provider: providerName,
      input,
      repoRoot: root,
      adapterEvents,
      capabilities,
      sessionIdFor: (i) => adapter.sessionIdFor(i),
      shellSnapshot: adapter.shellSnapshot,
    };

    const preHandled = await handlePreHook(snapshotCtx);
    if (preHandled) {
      return {
        preHandled: true,
        adapterEventCount: adapterEvents.length,
        snapshotEventCount: 0,
      };
    }

    const snapshotResult = await handlePostShell(snapshotCtx);

    const snapshotExecId =
      snapshotResult.events[0]?.meta?.["dev.agent-trace.execution_id"];
    if (snapshotExecId) {
      const adapterShell = adapterEvents.find((e) => e.kind === "shell");
      if (adapterShell) {
        adapterShell.meta["dev.agent-trace.execution_id"] = snapshotExecId;
      }
    }

    if (snapshotResult.deletedPaths.length > 0) {
      const filteredPaths = filterDeletedPaths(
        snapshotResult.deletedPaths,
        root,
        ignoreConfig,
      );
      if (filteredPaths.length > 0) {
        const shellEvent =
          adapterEvents.find((e) => e.kind === "shell") ??
          snapshotResult.events.find((e) => e.kind === "shell");
        if (shellEvent) {
          shellEvent.meta["dev.agent-trace.deleted_paths"] = filteredPaths;
        }
      }
    }

    for (const raw of adapterEvents) {
      dispatchTraceEvent(raw, extensions, ctx, ignoreConfig);
    }
    for (const raw of snapshotResult.events) {
      dispatchTraceEvent(raw, extensions, ctx, ignoreConfig);
    }

    return {
      preHandled: false,
      adapterEventCount: adapterEvents.length,
      snapshotEventCount: snapshotResult.events.length,
    };
  } finally {
    if (prevRoot !== undefined)
      process.env.AGENT_TRACE_WORKSPACE_ROOT = prevRoot;
    else delete process.env.AGENT_TRACE_WORKSPACE_ROOT;
    if (prevProvider !== undefined)
      process.env.AGENT_TRACE_PROVIDER = prevProvider;
    else delete process.env.AGENT_TRACE_PROVIDER;
  }
}
