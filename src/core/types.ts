export interface FileEdit {
  old_string: string;
  new_string: string;
  range?: {
    start_line_number: number;
    end_line_number: number;
    start_column: number;
    end_column: number;
  };
}

export interface RangePosition {
  start_line: number;
  end_line: number;
  content_hash?: string;
}

export interface HookInput {
  hook_event_name: string;
  model?: string;
  session_id?: string;
  conversation_id?: string;
  generation_id?: string;
  transcript_path?: string | null;
}

export type TraceEvent =
  | {
      kind: "file_edit";
      provider: string;
      sessionId?: string;
      filePath: string;
      edits: FileEdit[];
      model?: string;
      transcript?: string | null;
      readContent?: boolean;
      diffs?: boolean;
      eventName: string;
      tool?: { name: string; version?: string };
      meta: Record<string, unknown>;
    }
  | {
      kind: "shell";
      provider: string;
      sessionId?: string;
      model?: string;
      transcript?: string | null;
      tool?: { name: string; version?: string };
      meta: Record<string, unknown>;
    }
  | {
      kind: "session_start";
      provider: string;
      sessionId?: string;
      model?: string;
      tool?: { name: string; version?: string };
      meta: Record<string, unknown>;
    }
  | {
      kind: "session_end";
      provider: string;
      sessionId?: string;
      model?: string;
      tool?: { name: string; version?: string };
      meta: Record<string, unknown>;
    }
  | {
      kind: "message";
      provider: string;
      sessionId?: string;
      role: "user" | "assistant" | "system";
      content: string;
      eventName: string;
      model?: string;
      tool?: { name: string; version?: string };
      meta: Record<string, unknown>;
    };

export interface ProviderAdapter {
  adapt(input: HookInput): TraceEvent | TraceEvent[] | undefined;
  sessionIdFor(input: HookInput): string | undefined;
  toolInfo?(): { name: string; version?: string };
}

export interface Extension {
  name: string;
  onRawInput?(
    provider: string,
    sessionId: string | undefined,
    input: HookInput,
  ): void;
  onTraceEvent?(event: TraceEvent): void;
}
