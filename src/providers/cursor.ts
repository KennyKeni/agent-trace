import type {
  FileEdit,
  HookInput,
  PipelineEvent,
  ShellSnapshotCapability,
} from "../core/types";
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

export const shellSnapshot: ShellSnapshotCapability = {
  pre: [{ hookEvent: "beforeShellExecution" }],
  post: [{ hookEvent: "afterShellExecution" }],
};

export function adapt(
  input: HookInput,
): PipelineEvent | PipelineEvent[] | undefined {
  const ci = input as CursorHookInput;
  const sessionId = sessionIdFor(input);
  const model = normalizeModelId(input.model);

  switch (input.hook_event_name) {
    case "beforeShellExecution":
      return undefined;

    case "afterFileEdit": {
      if (!ci.file_path) return undefined;
      return {
        kind: "file_edit",
        provider: "cursor",
        sessionId,
        filePath: ci.file_path,
        edits: ci.edits ?? [],
        model,
        eventName: "afterFileEdit",
        meta: {
          conversation_id: input.conversation_id,
          generation_id: input.generation_id,
          transcript_path: input.transcript_path ?? undefined,
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
        meta: {
          conversation_id: input.conversation_id,
          generation_id: input.generation_id,
          command: ci.command,
          duration_ms: ci.duration_ms ?? ci.duration,
          transcript_path: input.transcript_path ?? undefined,
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
