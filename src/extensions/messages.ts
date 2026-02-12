import { join } from "node:path";
import { registerExtension } from "../core/trace-hook";
import { getWorkspaceRoot } from "../core/trace-store";
import { appendJsonl, nowIso, sanitizeSessionId } from "./helpers";

const TRACE_ROOT_DIR = ".agent-trace";

export interface MessageRecord {
  role: "user" | "assistant" | "system";
  content: string;
  event: string;
  model_id?: string;
  metadata?: Record<string, unknown>;
}

export function appendMessage(
  provider: string,
  sessionId: string | undefined,
  message: MessageRecord,
  root = getWorkspaceRoot(),
): string {
  const sid = sanitizeSessionId(sessionId);
  const path = join(root, TRACE_ROOT_DIR, "messages", provider, `${sid}.jsonl`);
  appendJsonl(path, {
    id: crypto.randomUUID(),
    timestamp: nowIso(),
    provider,
    session_id: sid,
    ...message,
  });
  return path;
}

registerExtension({
  name: "messages",
  onTraceEvent(event) {
    if (event.kind !== "message") return;
    const metadata =
      Object.keys(event.meta).length > 0 ? event.meta : undefined;
    appendMessage(event.provider, event.sessionId, {
      role: event.role,
      content: event.content,
      event: event.eventName,
      model_id: event.model,
      metadata,
    });
  },
});
