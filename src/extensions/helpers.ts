import { appendFileSync } from "node:fs";
import { ensureParent } from "../core/utils";

export { ensureParent } from "../core/utils";

export function appendJsonl(path: string, value: unknown): void {
  ensureParent(path);
  appendFileSync(path, `${JSON.stringify(value)}\n`, "utf-8");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function sanitizeSessionId(sessionId?: string | null): string {
  const raw = (sessionId ?? "unknown").trim();
  if (!raw) return "unknown";
  return raw.replace(/[^a-zA-Z0-9._-]/g, "_");
}
