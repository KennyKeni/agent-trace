import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function toBase64Url(input: string): string {
  return Buffer.from(input, "utf-8").toString("base64url");
}

export function repoHash(repoRoot: string): string {
  return createHash("sha256").update(repoRoot).digest("hex").slice(0, 32);
}

export function stateDir(repoRoot: string): string {
  return join(tmpdir(), "agent-trace", repoHash(repoRoot));
}

export function stateFilePath(
  repoRoot: string,
  provider: string,
  sessionId: string,
  callId: string,
): string {
  const dir = stateDir(repoRoot);
  const sanitizedSession = toBase64Url(sessionId);
  const sanitizedCall = toBase64Url(callId);
  return join(dir, `${provider}-${sanitizedSession}-${sanitizedCall}.json`);
}

export function ensureStateDir(repoRoot: string): string {
  const dir = stateDir(repoRoot);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function fallbackSessionKey(provider: string, repoRoot: string): string {
  return `${provider}-${repoHash(repoRoot)}`;
}
