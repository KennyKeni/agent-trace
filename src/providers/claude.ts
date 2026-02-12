import type { HookInput, TraceEvent } from "../core/types";
import { textFromUnknown } from "../core/utils";
import { normalizeModelId, sessionIdFor } from "./utils";

export interface ClaudeHookInput extends HookInput {
  tool_name?: string;
  tool_input?: {
    file_path?: string;
    new_string?: string;
    old_string?: string;
    content?: string;
    command?: string;
  };
  tool_response?: {
    originalFile?: string;
  };
  tool_use_id?: string;
  source?: string;
  reason?: string;
  prompt?: unknown;
  message?: unknown;
  content?: unknown;
}

export { sessionIdFor } from "./utils";

export function adapt(input: HookInput): TraceEvent | TraceEvent[] | undefined {
  const ci = input as ClaudeHookInput;
  const sessionId = sessionIdFor(input);
  const model = normalizeModelId(input.model);

  switch (input.hook_event_name) {
    case "PostToolUse": {
      const toolName = ci.tool_name ?? "";
      const isFileEdit = toolName === "Write" || toolName === "Edit";
      const isBash = toolName === "Bash";
      if (!isFileEdit && !isBash) return undefined;

      if (isBash) {
        return {
          kind: "shell",
          provider: "claude",
          sessionId,
          model,
          transcript: input.transcript_path,
          meta: {
            session_id: input.session_id,
            tool_name: toolName,
            tool_use_id: ci.tool_use_id,
            command: ci.tool_input?.command,
          },
        };
      }

      const file = ci.tool_input?.file_path ?? ".unknown";
      const newContent = ci.tool_input?.new_string ?? ci.tool_input?.content;
      const edits = newContent
        ? [
            {
              old_string:
                ci.tool_input?.old_string ??
                ci.tool_response?.originalFile ??
                "",
              new_string: newContent,
            },
          ]
        : [];
      return {
        kind: "file_edit",
        provider: "claude",
        sessionId,
        filePath: file,
        edits,
        model,
        readContent: !!ci.tool_input?.file_path,
        transcript: input.transcript_path,
        eventName: "PostToolUse",
        meta: {
          session_id: input.session_id,
          tool_name: toolName,
          tool_use_id: ci.tool_use_id,
        },
      };
    }

    case "UserPromptSubmit": {
      const text = textFromUnknown(ci.prompt ?? ci.message ?? ci.content);
      if (!text) return undefined;
      return {
        kind: "message",
        provider: "claude",
        sessionId,
        role: "user",
        content: text,
        eventName: "UserPromptSubmit",
        model,
        meta: {},
      };
    }

    case "SessionStart": {
      return {
        kind: "session_start",
        provider: "claude",
        sessionId,
        model,
        meta: {
          session_id: input.session_id,
          source: ci.source,
        },
      };
    }

    case "SessionEnd": {
      return {
        kind: "session_end",
        provider: "claude",
        sessionId,
        model,
        meta: {
          session_id: input.session_id,
          reason: ci.reason,
        },
      };
    }

    default:
      return undefined;
  }
}
