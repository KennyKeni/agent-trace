import { appendFileSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { detectVcsContext, type VcsContext } from "../vcs/detect";
import type {
  ContributorType,
  Conversation,
  Range,
  TraceRecord,
  Vcs,
} from "./schemas";
import { SPEC_VERSION } from "./schemas";
import type { FileEdit, RangePosition } from "./types";
import { ensureDir, resolvePosition } from "./utils";

function contentHash(text: string): string {
  const h = Bun.hash.murmur32v3(text, 0) >>> 0;
  return `murmur3:${h.toString(16).padStart(8, "0")}`;
}

const TRACE_PATH = ".agent-trace/traces.jsonl";

let cachedContext: VcsContext | undefined;

export function _resetContextCache(): void {
  cachedContext = undefined;
}

function getCachedContext(): VcsContext {
  if (!cachedContext) {
    cachedContext = detectVcsContext(process.cwd());
  }
  return cachedContext;
}

export function getWorkspaceRoot(): string {
  if (process.env.AGENT_TRACE_WORKSPACE_ROOT) {
    return process.env.AGENT_TRACE_WORKSPACE_ROOT;
  }
  if (process.env.CURSOR_PROJECT_DIR) {
    return process.env.CURSOR_PROJECT_DIR;
  }
  if (process.env.CLAUDE_PROJECT_DIR) {
    return process.env.CLAUDE_PROJECT_DIR;
  }
  return getCachedContext().root;
}

export function getVcsInfo(cwd: string): Vcs | undefined {
  const ctx = getCachedContext();
  if (ctx.root === cwd || resolve(ctx.root) === resolve(cwd)) {
    return ctx.vcs;
  }
  return detectVcsContext(cwd).vcs;
}

export function toRelativePath(
  filePath: string,
  root: string,
): string | undefined {
  if (!isAbsolute(filePath)) {
    const resolved = resolve(root, filePath);
    const rel = relative(resolve(root), resolved);
    if (
      rel === ".." ||
      rel.startsWith(`..${sep}`) ||
      isAbsolute(rel) ||
      rel === ""
    )
      return undefined;
    return rel;
  }

  const rootResolved = resolve(root);
  const fileResolved = resolve(filePath);
  const rel = relative(rootResolved, fileResolved);

  // Outside-root paths are not repo-relative and should not be traced.
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return undefined;
  }

  // A file path equal to root is not a valid file entry.
  if (rel === "") return undefined;

  return rel;
}

export function computeRangePositions(
  edits: FileEdit[],
  fileContent?: string,
): RangePosition[] {
  return edits
    .filter((e) => e.new_string)
    .map((edit) => {
      const pos = resolvePosition(edit, fileContent);
      return { ...pos, content_hash: contentHash(edit.new_string) };
    });
}

export function createTrace(
  type: ContributorType,
  filePath: string,
  opts: {
    root?: string;
    model?: string;
    rangePositions?: RangePosition[];
    transcript?: string | null;
    tool?: { name: string; version?: string };
    metadata?: Record<string, unknown>;
  } = {},
): TraceRecord | undefined {
  const root = opts.root ?? getWorkspaceRoot();
  const relativePath = toRelativePath(filePath, root);
  if (!relativePath) return undefined;
  const conversationUrl = opts.transcript
    ? `file://${opts.transcript}`
    : undefined;

  const ranges: Range[] = opts.rangePositions?.length
    ? opts.rangePositions.map((pos) => ({ ...pos }))
    : [];

  const conversation: Conversation = {
    url: conversationUrl,
    contributor: { type, model_id: opts.model },
    ranges,
  };

  return {
    version: SPEC_VERSION,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    vcs: getVcsInfo(root),
    tool: opts.tool,
    files: [
      {
        path: relativePath,
        conversations: [conversation],
      },
    ],
    metadata: opts.metadata,
  };
}

export function appendTrace(trace: TraceRecord, root?: string): void {
  const resolvedRoot = root ?? getWorkspaceRoot();
  const filePath = join(resolvedRoot, TRACE_PATH);
  const dir = join(resolvedRoot, ".agent-trace");
  ensureDir(dir);
  appendFileSync(filePath, `${JSON.stringify(trace)}\n`, "utf-8");
}

export function tryReadFile(path: string): string | undefined {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return undefined;
  }
}
