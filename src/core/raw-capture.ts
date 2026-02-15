import { join } from "node:path";
import type { ExtensionContext, HookInput } from "./types";
import { nowIso, sanitizeSessionId } from "./utils";

const TRACE_ROOT_DIR = ".agent-trace";

export function writeRawEvent(
  provider: string,
  sessionId: string | undefined,
  input: HookInput,
  ctx: ExtensionContext,
): void {
  const sid = sanitizeSessionId(sessionId);
  const path = join(ctx.root, TRACE_ROOT_DIR, "raw", provider, `${sid}.jsonl`);
  ctx.appendJsonl(path, {
    timestamp: nowIso(),
    provider,
    session_id: sid,
    event: input,
  });
}
