import type { FileEdit, HookInput, TraceEvent } from "../core/types";
import { textFromUnknown } from "../core/utils";
import { normalizeModelId, sessionIdFor } from "./utils";

export interface CursorHookInput extends HookInput {
  file_path?: string;
  edits?: FileEdit[];
  command?: string;
  duration?: number;
  duration_ms?: number;
  is_background_agent?: boolean;
  composer_mode?: string;
  reason?: string;
  prompt?: unknown;
  message?: unknown;
  content?: unknown;
}

export { sessionIdFor } from "./utils";

export function adapt(input: HookInput): TraceEvent | TraceEvent[] | undefined {
  const ci = input as CursorHookInput;
  const sessionId = sessionIdFor(input);
  const model = normalizeModelId(input.model);

  switch (input.hook_event_name) {
    case "afterFileEdit": {
      if (!ci.file_path) return undefined;
      return {
        kind: "file_edit",
        provider: "cursor",
        sessionId,
        filePath: ci.file_path,
        edits: ci.edits ?? [],
        model,
        transcript: input.transcript_path,
        readContent: true,
        eventName: "afterFileEdit",
        meta: {
          conversation_id: input.conversation_id,
          generation_id: input.generation_id,
        },
      };
    }

    case "afterTabFileEdit": {
      if (!ci.file_path) return undefined;
      return {
        kind: "file_edit",
        provider: "cursor",
        sessionId,
        filePath: ci.file_path,
        edits: ci.edits ?? [],
        model,
        eventName: "afterTabFileEdit",
        meta: {
          conversation_id: input.conversation_id,
          generation_id: input.generation_id,
        },
      };
    }

    case "afterShellExecution": {
      return {
        kind: "shell",
        provider: "cursor",
        sessionId,
        model,
        transcript: input.transcript_path,
        meta: {
          conversation_id: input.conversation_id,
          generation_id: input.generation_id,
          command: ci.command,
          duration_ms: ci.duration_ms ?? ci.duration,
        },
      };
    }

    case "sessionStart": {
      return {
        kind: "session_start",
        provider: "cursor",
        sessionId,
        model,
        meta: {
          session_id: input.session_id,
          conversation_id: input.conversation_id,
          is_background_agent: ci.is_background_agent,
          composer_mode: ci.composer_mode,
        },
      };
    }

    case "sessionEnd": {
      return {
        kind: "session_end",
        provider: "cursor",
        sessionId,
        model,
        meta: {
          session_id: input.session_id,
          conversation_id: input.conversation_id,
          reason: ci.reason,
          duration_ms: ci.duration_ms,
        },
      };
    }

    case "beforeSubmitPrompt": {
      const text = textFromUnknown(ci.prompt ?? ci.message ?? ci.content);
      if (!text) return undefined;
      return {
        kind: "message",
        provider: "cursor",
        sessionId,
        role: "user",
        content: text,
        eventName: "beforeSubmitPrompt",
        model,
        meta: {},
      };
    }

    default:
      return undefined;
  }
}
