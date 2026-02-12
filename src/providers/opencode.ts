import type { FileEdit, HookInput, TraceEvent } from "../core/types";
import { maybeString, safeRecord, textFromUnknown } from "../core/utils";
import { normalizeModelId } from "./utils";

export interface OpenCodeHookInput extends HookInput {
  event?: unknown;
  file_path?: string;
  content?: unknown;
  tool_name?: string;
  command?: string;
  message_id?: string;
  agent?: string;
  call_id?: string;
  files?: Array<{
    file: string;
    before?: string;
    after?: string;
    additions?: number;
    deletions?: number;
  }>;
}

function extractEventField(
  event: Record<string, unknown>,
  keys: string[],
): unknown {
  for (const key of keys) {
    if (Object.hasOwn(event, key)) return event[key];
  }
  return undefined;
}

export function sessionIdFor(input: HookInput): string | undefined {
  const oi = input as OpenCodeHookInput;
  const event = safeRecord(oi.event);
  const info = safeRecord(event?.info);
  const part = safeRecord(event?.part);
  return (
    maybeString(input.session_id) ??
    maybeString(event?.sessionID) ??
    maybeString(info?.sessionID) ??
    maybeString(info?.id) ??
    maybeString(part?.sessionID)
  );
}

export function adapt(input: HookInput): TraceEvent | TraceEvent[] | undefined {
  const oi = input as OpenCodeHookInput;
  const sessionId = sessionIdFor(input);
  const model = normalizeModelId(input.model);

  switch (input.hook_event_name) {
    case "session.created": {
      return {
        kind: "session_start",
        provider: "opencode",
        sessionId,
        model,
        meta: {
          session_id: sessionId,
          source: "opencode",
        },
      };
    }

    case "session.deleted": {
      return {
        kind: "session_end",
        provider: "opencode",
        sessionId,
        model,
        meta: {
          session_id: sessionId,
          source: "opencode",
          reason: "session.deleted",
        },
      };
    }

    case "session.idle": {
      return {
        kind: "session_end",
        provider: "opencode",
        sessionId,
        model,
        meta: {
          session_id: sessionId,
          source: "opencode",
          reason: "session.idle",
        },
      };
    }

    case "message.updated": {
      const event = safeRecord(oi.event);
      if (!event) return undefined;
      const info = safeRecord(event.info);
      if (!info) return undefined;
      const roleRaw = maybeString(info.role);
      const role =
        roleRaw === "assistant" || roleRaw === "system" ? roleRaw : "user";
      const content =
        textFromUnknown(info.content) ??
        textFromUnknown(info.text) ??
        textFromUnknown(info.parts);
      if (!content) return undefined;
      return {
        kind: "message",
        provider: "opencode",
        sessionId,
        role,
        content,
        eventName: "message.updated",
        model: normalizeModelId(maybeString(info.modelID)) ?? model,
        meta: { source: "opencode.event" },
      };
    }

    case "command.executed": {
      const event = safeRecord(oi.event);
      if (!event) return undefined;
      return {
        kind: "shell",
        provider: "opencode",
        sessionId,
        model,
        transcript: input.transcript_path,
        meta: {
          event: "command.executed",
          session_id: sessionId,
          source: "opencode",
          command: extractEventField(event, ["name", "command", "cmd"]),
          arguments: extractEventField(event, ["arguments"]),
          messageID: extractEventField(event, ["messageID"]),
        },
      };
    }

    case "file.edited": {
      const event = safeRecord(oi.event);
      if (!event) return undefined;
      const path =
        maybeString(
          extractEventField(event, ["file", "file_path", "filePath", "path"]),
        ) ?? maybeString(oi.file_path);
      if (!path) return undefined;
      return {
        kind: "file_edit",
        provider: "opencode",
        sessionId,
        filePath: path,
        edits: [],
        model,
        diffs: false,
        eventName: "file.edited",
        meta: {
          event: "file.edited",
          session_id: sessionId,
          source: "opencode",
        },
      };
    }

    case "hook:chat.message": {
      const content = typeof oi.content === "string" ? oi.content : undefined;
      if (!content) return undefined;
      return {
        kind: "message",
        provider: "opencode",
        sessionId,
        role: "user",
        content,
        eventName: "hook:chat.message",
        model,
        meta: {
          source: "opencode.hook",
          message_id: oi.message_id,
          agent: oi.agent,
        },
      };
    }

    case "hook:tool.execute.after": {
      const toolName = oi.tool_name ?? "";
      const shellTools = ["bash", "shell"];

      if (shellTools.includes(toolName)) {
        return {
          kind: "shell",
          provider: "opencode",
          sessionId,
          model,
          meta: {
            event: "hook:tool.execute.after",
            session_id: sessionId,
            source: "opencode.hook",
            tool_name: toolName,
            command: oi.command,
          },
        };
      }

      const files = oi.files;
      if (!files || files.length === 0) return undefined;

      const events: TraceEvent[] = [];
      for (const f of files) {
        const edits: FileEdit[] = [
          {
            old_string: f.before ?? "",
            new_string: f.after ?? "",
          },
        ];
        events.push({
          kind: "file_edit",
          provider: "opencode",
          sessionId,
          filePath: f.file,
          edits,
          diffs: true,
          eventName: "hook:tool.execute.after",
          model,
          meta: {
            event: "hook:tool.execute.after",
            session_id: sessionId,
            source: "opencode.hook",
            tool_name: toolName,
            call_id: oi.call_id,
          },
        });
      }

      return events.length === 1 ? events[0] : events;
    }

    default:
      return undefined;
  }
}
