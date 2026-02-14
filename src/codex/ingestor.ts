import { join, resolve } from "node:path";
import { dispatchTraceEvent } from "../core/dispatch";
import type { IgnoreConfig } from "../core/ignore";
import { isInitialized, loadConfig } from "../core/ignore";
import { activeExtensions } from "../core/registry";
import { getWorkspaceRoot } from "../core/trace-store";
import type { FileEdit, TraceEvent } from "../core/types";
import { appendJsonl, sanitizeSessionId } from "../extensions/helpers";

const TOOL = { name: "codex-cli" } as const;

interface HunkLine {
  type: "context" | "del" | "add";
  text: string;
}

const CONTEXT_LINES = 3;
const MERGE_GAP = 2 * CONTEXT_LINES;

export function clusterHunkLines(lines: HunkLine[]): FileEdit[] {
  const changeIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line && line.type !== "context") changeIndices.push(i);
  }
  if (changeIndices.length === 0) return [];

  const regions: { start: number; end: number }[] = [];
  const first = changeIndices[0];
  if (first === undefined) return [];
  let rStart = first;
  let rEnd = rStart;

  for (let i = 1; i < changeIndices.length; i++) {
    const idx = changeIndices[i];
    if (idx === undefined) continue;
    if (idx === rEnd + 1) {
      rEnd = idx;
    } else {
      let allContext = true;
      for (let j = rEnd + 1; j < idx; j++) {
        const jLine = lines[j];
        if (jLine && jLine.type !== "context") {
          allContext = false;
          break;
        }
      }
      if (allContext) {
        regions.push({ start: rStart, end: rEnd });
        rStart = idx;
        rEnd = idx;
      } else {
        rEnd = idx;
      }
    }
  }
  regions.push({ start: rStart, end: rEnd });

  const firstRegion = regions[0];
  if (!firstRegion) return [];
  const merged: { start: number; end: number }[] = [firstRegion];
  for (let i = 1; i < regions.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = regions[i];
    if (!prev || !curr) continue;
    const gap = curr.start - prev.end - 1;
    if (gap <= MERGE_GAP) {
      prev.end = curr.end;
    } else {
      merged.push({ ...curr });
    }
  }

  const edits: FileEdit[] = [];
  for (const region of merged) {
    const ctxStart = Math.max(0, region.start - CONTEXT_LINES);
    const ctxEnd = Math.min(lines.length - 1, region.end + CONTEXT_LINES);

    const oldParts: string[] = [];
    const newParts: string[] = [];
    for (let i = ctxStart; i <= ctxEnd; i++) {
      const l = lines[i];
      if (!l) continue;
      if (l.type === "context") {
        oldParts.push(l.text);
        newParts.push(l.text);
      } else if (l.type === "del") {
        oldParts.push(l.text);
      } else {
        newParts.push(l.text);
      }
    }

    edits.push({
      old_string: oldParts.join("\n"),
      new_string: newParts.join("\n"),
    });
  }

  return edits;
}

export interface IngestorState {
  sessionId: string | undefined;
  modelId: string | undefined;
  turnIndex: number;
  sessionStarted: boolean;
  sessionEnded: boolean;
  pendingUserPrompt: string | undefined;
  lastAgentMessage: string | undefined;
}

interface RolloutLine {
  timestamp?: string;
  type: string;
  payload: Record<string, unknown>;
}

export function parsePatchInput(input: string): Map<string, FileEdit[]> {
  const result = new Map<string, FileEdit[]>();
  const filePattern = /^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s+(.+)$/;
  const lines = input.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const fileMatch = filePattern.exec(line);
    if (!fileMatch) {
      i++;
      continue;
    }

    const filePath = fileMatch[1]?.trim();
    if (!filePath) {
      i++;
      continue;
    }

    i++;
    const edits: FileEdit[] = [];

    // Collect +lines between file header and first @@ (for Add File without hunk header)
    const looseNewLines: string[] = [];

    while (i < lines.length) {
      const cur = lines[i] ?? "";
      if (cur.startsWith("***")) break;

      if (cur.startsWith("@@")) {
        i++;
        const hunkLines: HunkLine[] = [];

        while (i < lines.length) {
          const dl = lines[i] ?? "";
          if (dl.startsWith("@@") || dl.startsWith("***")) break;
          if (dl.startsWith("-")) {
            hunkLines.push({ type: "del", text: dl.slice(1) });
          } else if (dl.startsWith("+")) {
            hunkLines.push({ type: "add", text: dl.slice(1) });
          } else if (dl.startsWith(" ")) {
            hunkLines.push({ type: "context", text: dl.slice(1) });
          }
          i++;
        }

        edits.push(...clusterHunkLines(hunkLines));
        continue;
      }

      if (cur.startsWith("+")) {
        looseNewLines.push(cur.slice(1));
      }

      i++;
    }

    if (looseNewLines.length > 0 && edits.length === 0) {
      edits.push({
        old_string: "",
        new_string: looseNewLines.join("\n"),
      });
    }

    const existing = result.get(filePath) ?? [];
    result.set(filePath, [...existing, ...edits]);
  }

  return result;
}

export class CodexTraceIngestor {
  sessionId: string | undefined;
  modelId: string | undefined;
  private transcriptPath: string | undefined;
  private cachedIgnoreConfig: IgnoreConfig | undefined;
  turnIndex = 0;
  sessionStarted = false;
  sessionEnded = false;
  pendingUserPrompt: string | undefined;
  lastAgentMessage: string | undefined;

  constructor(opts?: { transcriptPath?: string }) {
    this.transcriptPath = opts?.transcriptPath;
  }

  private getIgnoreConfig(): IgnoreConfig {
    if (!this.cachedIgnoreConfig) {
      this.cachedIgnoreConfig = loadConfig(getWorkspaceRoot()).ignore;
    }
    return this.cachedIgnoreConfig;
  }

  private emitTraceEvent(event: TraceEvent): void {
    if (!this.sessionId) return;
    const root = getWorkspaceRoot();
    if (!isInitialized(root)) return;
    const config = loadConfig(root);
    const extensions = activeExtensions(config.extensions);
    dispatchTraceEvent(event, extensions, TOOL, this.getIgnoreConfig());
  }

  restoreState(state: IngestorState): void {
    this.sessionId = state.sessionId;
    this.modelId = state.modelId;
    this.turnIndex = state.turnIndex;
    this.sessionStarted = state.sessionStarted;
    this.sessionEnded = state.sessionEnded;
    this.pendingUserPrompt = state.pendingUserPrompt;
    this.lastAgentMessage = state.lastAgentMessage;
  }

  snapshotState(): IngestorState {
    return {
      sessionId: this.sessionId,
      modelId: this.modelId,
      turnIndex: this.turnIndex,
      sessionStarted: this.sessionStarted,
      sessionEnded: this.sessionEnded,
      pendingUserPrompt: this.pendingUserPrompt,
      lastAgentMessage: this.lastAgentMessage,
    };
  }

  processLine(line: string): void {
    let parsed: RolloutLine;
    try {
      parsed = JSON.parse(line) as RolloutLine;
    } catch {
      return;
    }

    const outerType = parsed.type;
    if (!outerType || !parsed.payload) return;

    switch (outerType) {
      case "session_meta":
        this.onSessionMeta(parsed.payload);
        break;
      case "turn_context":
        this.onTurnContext(parsed.payload);
        break;
      case "event_msg":
        this.onEventMsg(parsed.payload);
        break;
      case "response_item":
        this.onResponseItem(parsed.payload);
        break;
      default:
        console.warn(
          `[agent-trace] Unknown Codex JSONL event type: "${outerType}"`,
        );
        break;
    }

    this.appendRaw(parsed);
  }

  private appendRaw(event: RolloutLine): void {
    if (!this.sessionId) return;
    const root = getWorkspaceRoot();
    if (!isInitialized(root)) return;
    const sid = sanitizeSessionId(this.sessionId);
    const path = join(root, ".agent-trace", "raw", "codex", `${sid}.jsonl`);
    appendJsonl(path, {
      timestamp: new Date().toISOString(),
      provider: "codex",
      session_id: sid,
      event,
    });
  }

  private onSessionMeta(payload: Record<string, unknown>): void {
    this.sessionId = (payload.id as string) ?? this.sessionId;
    this.sessionStarted = true;

    this.emitTraceEvent({
      kind: "session_start",
      provider: "codex",
      sessionId: this.sessionId,
      model: this.modelId,
      meta: {
        codex_session_id: this.sessionId,
        cli_version: payload.cli_version,
        model_provider: payload.model_provider,
      },
    });
  }

  private onTurnContext(payload: Record<string, unknown>): void {
    const model = payload.model as string | undefined;
    if (model) this.modelId = model;
    this.turnIndex++;
  }

  private onEventMsg(payload: Record<string, unknown>): void {
    const innerType = payload.type as string | undefined;
    if (!innerType) return;

    switch (innerType) {
      case "user_message": {
        const message = (payload.message as string) ?? undefined;
        this.pendingUserPrompt = message;
        if (message) {
          this.emitTraceEvent({
            kind: "message",
            provider: "codex",
            sessionId: this.sessionId,
            role: "user",
            content: message,
            eventName: "user_message",
            model: this.modelId,
            meta: {
              codex_session_id: this.sessionId,
              turn_index: this.turnIndex,
            },
          });
        }
        break;
      }
      case "agent_message": {
        const message = (payload.message as string) ?? undefined;
        this.lastAgentMessage = message;
        if (message) {
          this.emitTraceEvent({
            kind: "message",
            provider: "codex",
            sessionId: this.sessionId,
            role: "assistant",
            content: message,
            eventName: "agent_message",
            model: this.modelId,
            meta: {
              codex_session_id: this.sessionId,
              turn_index: this.turnIndex,
            },
          });
        }
        break;
      }
    }
  }

  private onResponseItem(payload: Record<string, unknown>): void {
    const itemType = payload.type as string | undefined;
    if (!itemType) return;

    switch (itemType) {
      case "custom_tool_call":
        this.onToolCall(payload);
        break;
      case "function_call":
        this.onFunctionCall(payload);
        break;
      default:
        break;
    }
  }

  private onToolCall(payload: Record<string, unknown>): void {
    const name = payload.name as string | undefined;
    if (name !== "apply_patch") return;

    const input = payload.input as string | undefined;
    if (!input) return;

    const parsed = parsePatchInput(input);
    const root = getWorkspaceRoot();

    for (const [filePath, edits] of parsed) {
      this.emitTraceEvent({
        kind: "file_edit",
        provider: "codex",
        sessionId: this.sessionId,
        filePath: resolve(root, filePath),
        edits,
        model: this.modelId,
        transcript: this.transcriptPath ?? undefined,
        readContent: false,
        eventName: "apply_patch",
        meta: {
          codex_session_id: this.sessionId,
          turn_index: this.turnIndex,
          source: "apply_patch",
        },
      });
    }
  }

  private onFunctionCall(payload: Record<string, unknown>): void {
    const name = payload.name as string | undefined;
    if (name !== "exec_command") return;

    let cmd: string | undefined;
    const argsStr = payload.arguments as string | undefined;
    if (argsStr) {
      try {
        const args = JSON.parse(argsStr) as Record<string, unknown>;
        cmd = args.cmd as string | undefined;
      } catch {
        // ignore malformed arguments
      }
    }

    this.emitTraceEvent({
      kind: "shell",
      provider: "codex",
      sessionId: this.sessionId,
      model: this.modelId,
      transcript: this.transcriptPath ?? undefined,
      meta: {
        codex_session_id: this.sessionId,
        turn_index: this.turnIndex,
        command: cmd,
      },
    });
  }
}
