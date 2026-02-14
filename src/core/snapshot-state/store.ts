import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureStateDir, stateFilePath } from "./keys";

export interface PreSnapshotState {
  vcs: string;
  repoRoot: string;
  preTree: string;
  createdAt: number;
  pid: number;
  provider: string;
  sessionId: string;
  toolCallId: string;
}

export function savePreSnapshot(opts: {
  repoRoot: string;
  provider: string;
  sessionId: string;
  toolCallId: string;
  preTree: string;
  vcs: string;
}): string {
  const dir = ensureStateDir(opts.repoRoot);
  const filePath = stateFilePath(
    opts.repoRoot,
    opts.provider,
    opts.sessionId,
    opts.toolCallId,
  );
  const state: PreSnapshotState = {
    vcs: opts.vcs,
    repoRoot: opts.repoRoot,
    preTree: opts.preTree,
    createdAt: Date.now(),
    pid: process.pid,
    provider: opts.provider,
    sessionId: opts.sessionId,
    toolCallId: opts.toolCallId,
  };

  const tmpPath = join(
    dir,
    `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  writeFileSync(tmpPath, JSON.stringify(state), { mode: 0o600 });
  renameSync(tmpPath, filePath);
  return filePath;
}

export function loadPreSnapshot(
  repoRoot: string,
  provider: string,
  sessionId: string,
  callId: string,
): PreSnapshotState | undefined {
  const filePath = stateFilePath(repoRoot, provider, sessionId, callId);
  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as PreSnapshotState;
  } catch {
    return undefined;
  }
}

export function deletePreSnapshot(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch {
    // best-effort cleanup
  }
}

export function preSnapshotPath(
  repoRoot: string,
  provider: string,
  sessionId: string,
  callId: string,
): string {
  return stateFilePath(repoRoot, provider, sessionId, callId);
}
