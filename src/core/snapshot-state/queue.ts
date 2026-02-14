import {
  appendFileSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { ensureStateDir, stateDir, toBase64Url } from "./keys";

export interface FifoEntry {
  preTree: string;
  executionId: string;
  createdAt: number;
  pid: number;
  provider: string;
}

function queuePath(
  repoRoot: string,
  provider: string,
  sessionId: string,
): string {
  const dir = stateDir(repoRoot);
  const sanitizedSession = toBase64Url(sessionId);
  return join(dir, `${provider}-${sanitizedSession}-queue.jsonl`);
}

function ensureQueueFile(path: string): void {
  try {
    writeFileSync(path, "", { flag: "wx", mode: 0o600 });
  } catch {
    // file already exists
  }
}

export async function fifoPush(
  repoRoot: string,
  provider: string,
  sessionId: string,
  entry: FifoEntry,
): Promise<boolean> {
  ensureStateDir(repoRoot);
  const qFile = queuePath(repoRoot, provider, sessionId);
  ensureQueueFile(qFile);

  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(qFile, {
      stale: 30_000,
      retries: { retries: 3, minTimeout: 50, factor: 2 },
    });
    appendFileSync(qFile, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    return true;
  } catch {
    console.warn(
      "[agent-trace] Failed to acquire FIFO lock for push, skipping",
    );
    return false;
  } finally {
    if (release) await release();
  }
}

export async function fifoPop(
  repoRoot: string,
  provider: string,
  sessionId: string,
  ttlMs = 86_400_000,
): Promise<FifoEntry | undefined> {
  const qFile = queuePath(repoRoot, provider, sessionId);
  ensureQueueFile(qFile);

  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(qFile, {
      stale: 30_000,
      retries: { retries: 3, minTimeout: 50, factor: 2 },
    });

    let raw: string;
    try {
      raw = readFileSync(qFile, "utf-8");
    } catch {
      return undefined;
    }

    const lines = raw.split("\n").filter((l) => l.trim());
    if (lines.length === 0) return undefined;

    const cutoff = Date.now() - ttlMs;

    let foundIdx = -1;
    let entry: FifoEntry | undefined;
    for (let i = 0; i < lines.length; i++) {
      try {
        const line = lines[i];
        if (!line) continue;
        const parsed = JSON.parse(line) as FifoEntry;
        if (parsed.createdAt >= cutoff) {
          foundIdx = i;
          entry = parsed;
          break;
        }
      } catch {
        // corrupted entry, skip
      }
    }

    if (foundIdx === -1 || !entry) {
      try {
        unlinkSync(qFile);
      } catch {
        /* empty */
      }
      return undefined;
    }

    const remaining = lines.slice(foundIdx + 1);
    if (remaining.length === 0) {
      try {
        unlinkSync(qFile);
      } catch {
        /* empty */
      }
    } else {
      writeFileSync(qFile, `${remaining.join("\n")}\n`, { mode: 0o600 });
    }

    return entry;
  } catch {
    console.warn("[agent-trace] Failed to acquire FIFO lock for pop, skipping");
    return undefined;
  } finally {
    if (release) await release();
  }
}
