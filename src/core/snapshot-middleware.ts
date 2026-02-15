import { randomUUID } from "node:crypto";
import { detectSnapshotProvider, type VcsSnapshotProvider } from "../vcs";
import type { Hunk } from "../vcs/types";
import {
  deletePreSnapshot,
  fallbackSessionKey,
  fifoPop,
  fifoPush,
  gcStaleSnapshots,
  loadPreSnapshot,
  preSnapshotPath,
  savePreSnapshot,
} from "./snapshot-state";
import type {
  HookInput,
  PipelineEvent,
  RangePosition,
  ShellMatcher,
  ShellSnapshotCapability,
} from "./types";

export interface SnapshotContext {
  provider: string;
  input: HookInput;
  repoRoot: string;
  adapterEvents: PipelineEvent[];
  capabilities: Set<string>;
  sessionIdFor: (input: HookInput) => string | undefined;
  shellSnapshot?: ShellSnapshotCapability;
}

function matchesEvent(m: ShellMatcher, input: HookInput): boolean {
  if (input.hook_event_name !== m.hookEvent) return false;
  if (m.toolNames && !m.toolNames.includes(input.tool_name ?? "")) return false;
  return true;
}

function isPreShellEvent(
  caps: ShellSnapshotCapability | undefined,
  input: HookInput,
): boolean {
  return caps?.pre.some((m) => matchesEvent(m, input)) ?? false;
}

function isPostShellEvent(
  caps: ShellSnapshotCapability | undefined,
  input: HookInput,
): boolean {
  return caps?.post.some((m) => matchesEvent(m, input)) ?? false;
}

function isFailureEvent(
  caps: ShellSnapshotCapability | undefined,
  input: HookInput,
): boolean {
  return caps?.post.some((m) => m.failure && matchesEvent(m, input)) ?? false;
}

function getSessionId(ctx: SnapshotContext): string {
  return (
    ctx.sessionIdFor(ctx.input) ??
    fallbackSessionKey(ctx.provider, ctx.repoRoot)
  );
}

function extractCommand(input: HookInput): string | undefined {
  return typeof input.tool_input?.command === "string"
    ? input.tool_input.command
    : undefined;
}

function needsPatch(capabilities: Set<string>): boolean {
  return capabilities.has("needs_patches");
}

function hunkToRangePosition(hunk: Hunk): RangePosition {
  return {
    start_line: hunk.start_line,
    end_line: hunk.end_line,
  };
}

const providerCache = new Map<string, VcsSnapshotProvider | undefined>();

export function _resetProviderCache(): void {
  providerCache.clear();
}

async function getSnapshotProvider(
  repoRoot: string,
): Promise<VcsSnapshotProvider | undefined> {
  if (providerCache.has(repoRoot)) {
    return providerCache.get(repoRoot);
  }
  const provider = await detectSnapshotProvider(repoRoot);
  providerCache.set(repoRoot, provider);
  return provider;
}

export async function handlePreHook(ctx: SnapshotContext): Promise<boolean> {
  if (!isPreShellEvent(ctx.shellSnapshot, ctx.input)) return false;

  try {
    const vcsProvider = await getSnapshotProvider(ctx.repoRoot);
    if (!vcsProvider) return false;

    const preTree = await vcsProvider.captureSnapshot(ctx.repoRoot);
    const sessionId = getSessionId(ctx);
    const callId = ctx.shellSnapshot?.callId?.(ctx.input);

    if (callId) {
      savePreSnapshot({
        repoRoot: ctx.repoRoot,
        provider: ctx.provider,
        sessionId,
        toolCallId: callId,
        preTree,
        vcs: vcsProvider.kind,
      });
    } else {
      await fifoPush(ctx.repoRoot, ctx.provider, sessionId, {
        preTree,
        executionId: randomUUID(),
        createdAt: Date.now(),
        pid: process.pid,
        provider: ctx.provider,
      });
    }

    return true;
  } catch (e) {
    console.warn("[agent-trace] Snapshot pre-hook failed, continuing:", e);
    return false;
  }
}

interface PostShellResult {
  events: PipelineEvent[];
  deletedPaths: string[];
}

function emptyResult(): PostShellResult {
  return { events: [], deletedPaths: [] };
}

function makeFailureShellEvent(
  ctx: SnapshotContext,
  sessionId: string,
  executionId?: string,
): PipelineEvent {
  const cmd = extractCommand(ctx.input);
  return {
    kind: "shell",
    provider: ctx.provider,
    sessionId,
    model: ctx.input.model,
    meta: {
      "dev.agent-trace.failure": true,
      "dev.agent-trace.source": "vcs_snapshot",
      [`dev.${ctx.provider}.session_id`]: ctx.input.session_id,
      ...(executionId ? { "dev.agent-trace.execution_id": executionId } : {}),
      ...(cmd ? { command: cmd } : {}),
    },
  };
}

export async function handlePostShell(
  ctx: SnapshotContext,
): Promise<PostShellResult> {
  if (!isPostShellEvent(ctx.shellSnapshot, ctx.input)) return emptyResult();

  try {
    gcStaleSnapshots(ctx.repoRoot);

    const vcsProvider = await getSnapshotProvider(ctx.repoRoot);
    if (!vcsProvider) return emptyResult();

    const sessionId = getSessionId(ctx);
    const callId = ctx.shellSnapshot?.callId?.(ctx.input);
    const includePatch = needsPatch(ctx.capabilities);

    let preTree: string | undefined;
    let pairedViaCallId = false;
    let executionId: string | undefined;

    if (callId) {
      const state = loadPreSnapshot(
        ctx.repoRoot,
        ctx.provider,
        sessionId,
        callId,
      );
      if (state) {
        preTree = state.preTree;
        pairedViaCallId = true;
        executionId = callId;
      }
    }

    if (!preTree) {
      if (callId) {
        console.warn(
          "[agent-trace] call_id lookup failed, falling back to FIFO",
        );
      }
      const fifoEntry = await fifoPop(ctx.repoRoot, ctx.provider, sessionId);
      if (fifoEntry) {
        preTree = fifoEntry.preTree;
        executionId = fifoEntry.executionId;
      }
    }

    if (!preTree) {
      console.warn("[agent-trace] No pre-snapshot found for post-shell event");
      const failure = isFailureEvent(ctx.shellSnapshot, ctx.input);
      const hasShellEvent = ctx.adapterEvents.some((e) => e.kind === "shell");
      if (failure && !hasShellEvent) {
        return {
          events: [makeFailureShellEvent(ctx, sessionId)],
          deletedPaths: [],
        };
      }
      return emptyResult();
    }

    const postTree = await vcsProvider.captureSnapshot(ctx.repoRoot);

    const diff = await vcsProvider.diffSnapshots(
      preTree,
      postTree,
      ctx.repoRoot,
      {
        includePatch,
      },
    );

    const cleanupPairing = () => {
      if (pairedViaCallId && callId) {
        deletePreSnapshot(
          preSnapshotPath(ctx.repoRoot, ctx.provider, sessionId, callId),
        );
      }
    };

    const failure = isFailureEvent(ctx.shellSnapshot, ctx.input);
    const hasShellEvent = ctx.adapterEvents.some((e) => e.kind === "shell");

    if (diff.files.length === 0) {
      cleanupPairing();
      if (failure && !hasShellEvent) {
        return {
          events: [makeFailureShellEvent(ctx, sessionId, executionId)],
          deletedPaths: [],
        };
      }
      return emptyResult();
    }

    const events: PipelineEvent[] = [];
    const deletedPaths: string[] = [];

    for (const file of diff.files) {
      if (file.status === "deleted") {
        deletedPaths.push(file.path);
        continue;
      }

      if (file.binary) continue;

      if (file.status === "renamed" && file.hunks.length === 0) continue;

      const snapshotRanges = file.hunks.map(hunkToRangePosition);
      if (snapshotRanges.length === 0) continue;

      events.push({
        kind: "file_edit",
        provider: ctx.provider,
        sessionId,
        filePath: file.path,
        edits: [],
        snapshotRanges,
        hunkPatch: file.hunkPatch,
        precomputedPatch: file.patch,
        model: ctx.input.model,
        eventName: ctx.input.hook_event_name,
        meta: {
          "dev.agent-trace.source": "vcs_snapshot",
          "dev.agent-trace.attribution_confidence": "correlated",
          "dev.agent-trace.execution_id": executionId,
          [`dev.${ctx.provider}.session_id`]: ctx.input.session_id,
          ...(file.oldPath ? { "dev.agent-trace.old_path": file.oldPath } : {}),
        },
      });
    }

    if (failure && !hasShellEvent) {
      events.push(makeFailureShellEvent(ctx, sessionId, executionId));
    }

    cleanupPairing();
    return { events, deletedPaths };
  } catch (e) {
    console.warn("[agent-trace] Snapshot post-hook failed, continuing:", e);
    return emptyResult();
  }
}
