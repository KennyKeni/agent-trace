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
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

// --- Pipeline Event (internal boundary type) ---

interface PipelineEventBase {
  kind: string;
  provider: string;
  sessionId?: string;
  model?: string;
  meta: Record<string, unknown>;
}

export interface FileEditEvent extends PipelineEventBase {
  kind: "file_edit";
  filePath: string;
  eventName: string;
  edits: FileEdit[];
  snapshotRanges?: RangePosition[];
  hunkPatch?: string;
  precomputedPatch?: string;
}

export interface ShellEvent extends PipelineEventBase {
  kind: "shell";
}

export interface MessageEvent extends PipelineEventBase {
  kind: "message";
  eventName: string;
  role: "user" | "assistant" | "system";
  content: string;
}

export interface SessionStartEvent extends PipelineEventBase {
  kind: "session_start";
}

export interface SessionEndEvent extends PipelineEventBase {
  kind: "session_end";
}

export type PipelineEvent =
  | FileEditEvent
  | ShellEvent
  | MessageEvent
  | SessionStartEvent
  | SessionEndEvent;

// --- Capabilities ---

export const CAPABILITIES = {
  NEEDS_PATCHES: "needs_patches",
} as const;

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

// --- Extension Context ---

export interface ExtensionContext {
  root: string;
  toolInfo?: { name: string; version?: string };
  appendJsonl(path: string, value: unknown): void;
  appendText(path: string, text: string): void;
  tryReadFile(path: string): string | undefined;
}

// --- Extension ---

export interface Extension {
  name: string;
  capabilities?: Capability[];
  onTraceEvent?(event: PipelineEvent, ctx: ExtensionContext): void;
}

// --- Provider ---

export interface ShellMatcher {
  hookEvent: string;
  toolNames?: string[];
  failure?: boolean;
}

export interface ShellSnapshotCapability {
  pre: ShellMatcher[];
  post: ShellMatcher[];
  callId?: (input: HookInput) => string | undefined;
}

export interface ProviderAdapter {
  adapt(input: HookInput): PipelineEvent | PipelineEvent[] | undefined;
  sessionIdFor(input: HookInput): string | undefined;
  toolInfo?(): { name: string; version?: string };
  shellSnapshot?: ShellSnapshotCapability;
}
