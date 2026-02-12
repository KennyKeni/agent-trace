import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CodexTraceIngestor, type IngestorState } from "./ingestor";

interface NotifyPayload {
  type: string;
  "thread-id": string;
  "turn-id"?: string;
  cwd?: string;
  "input-messages"?: unknown[];
  "last-assistant-message"?: string;
}

interface PersistedState {
  byteOffset: number;
  ingestor: IngestorState;
}

function codexHome(): string {
  return process.env.CODEX_HOME ?? join(homedir(), ".codex");
}

function stateDir(): string {
  return join(codexHome(), "agent-trace", "state");
}

function statePath(threadId: string): string {
  return join(stateDir(), `${threadId}.json`);
}

function loadState(threadId: string): PersistedState | undefined {
  const path = statePath(threadId);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as PersistedState;
  } catch {
    return undefined;
  }
}

function saveState(threadId: string, state: PersistedState): void {
  const dir = stateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(statePath(threadId), JSON.stringify(state), "utf-8");
}

function findRolloutFile(threadId: string): string | undefined {
  const sessionsDir = join(codexHome(), "sessions");
  if (!existsSync(sessionsDir)) return undefined;

  const glob = new Bun.Glob(`**/rollout-*-${threadId}.jsonl`);
  for (const match of glob.scanSync({ cwd: sessionsDir })) {
    return join(sessionsDir, match);
  }
  return undefined;
}

async function waitForRollout(
  threadId: string,
  maxRetries = 3,
  delayMs = 200,
): Promise<string | undefined> {
  for (let i = 0; i < maxRetries; i++) {
    const path = findRolloutFile(threadId);
    if (path) return path;
    await Bun.sleep(delayMs);
  }
  return undefined;
}

export async function handleNotify(jsonArg: string): Promise<number> {
  let payload: NotifyPayload;
  try {
    payload = JSON.parse(jsonArg) as NotifyPayload;
  } catch {
    console.error("agent-trace codex notify: invalid JSON argument");
    return 1;
  }

  const threadId = payload["thread-id"];
  if (!threadId) {
    console.error("agent-trace codex notify: missing thread-id");
    return 1;
  }

  if (payload.cwd) {
    process.env.AGENT_TRACE_WORKSPACE_ROOT = payload.cwd;
  }

  const rolloutPath = await waitForRollout(threadId);
  if (!rolloutPath) {
    console.error(
      `agent-trace codex notify: rollout file not found for thread ${threadId}`,
    );
    return 1;
  }

  const prior = loadState(threadId);
  const byteOffset = prior?.byteOffset ?? 0;

  const fileSize = statSync(rolloutPath).size;
  if (fileSize <= byteOffset) return 0;

  const fd = Bun.file(rolloutPath);
  const content = await fd.slice(byteOffset, fileSize).text();
  const lines = content.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return 0;

  const ingestor = new CodexTraceIngestor(rolloutPath);
  if (prior?.ingestor) {
    ingestor.restoreState(prior.ingestor);
  }

  for (const line of lines) {
    ingestor.processLine(line);
  }

  saveState(threadId, {
    byteOffset: fileSize,
    ingestor: ingestor.snapshotState(),
  });

  return 0;
}
