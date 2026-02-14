import { readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { stateDir } from "./keys";

export function gcStaleSnapshots(repoRoot: string, ttlMs = 86_400_000): void {
  const dir = stateDir(repoRoot);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  const cutoff = Date.now() - ttlMs;
  for (const entry of entries) {
    if (entry.startsWith(".") || entry.endsWith(".lock")) continue;
    const fullPath = join(dir, entry);
    try {
      const stat = statSync(fullPath);
      if (stat.mtimeMs < cutoff) {
        unlinkSync(fullPath);
      }
    } catch {
      // best-effort
    }
  }
}
