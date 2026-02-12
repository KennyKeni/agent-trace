import { join } from "node:path";
import { registerExtension } from "../core/trace-hook";
import { getWorkspaceRoot } from "../core/trace-store";
import { appendJsonl, nowIso, sanitizeSessionId } from "./helpers";

const TRACE_ROOT_DIR = ".agent-trace";

export function appendRawEvent(
  provider: string,
  sessionId: string | undefined,
  event: unknown,
  root = getWorkspaceRoot(),
): string {
  const sid = sanitizeSessionId(sessionId);
  const path = join(root, TRACE_ROOT_DIR, "raw", provider, `${sid}.jsonl`);
  appendJsonl(path, {
    timestamp: nowIso(),
    provider,
    session_id: sid,
    event,
  });
  return path;
}

registerExtension({
  name: "raw-events",
  onRawInput(provider, sessionId, input) {
    appendRawEvent(provider, sessionId, input);
  },
});
