import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  ContributorType,
  Conversation,
  Range,
  TraceRecord,
  Vcs,
  VcsType,
} from "./schemas";
import { SPEC_VERSION } from "./schemas";
import type { FileEdit, RangePosition } from "./types";
import { ensureDir, resolvePosition } from "./utils";

export type {
  ContributorType,
  Conversation,
  Range,
  TraceRecord,
  Vcs,
  VcsType,
} from "./schemas";

export type { FileEdit, RangePosition } from "./types";

function contentHash(text: string): string {
  const h = Bun.hash.murmur32v3(text, 0) >>> 0;
  return `murmur3:${h.toString(16).padStart(8, "0")}`;
}

const TRACE_PATH = ".agent-trace/traces.jsonl";

interface VcsDetector {
  type: VcsType;
  rootCmd: [string, string[]];
  revisionCmd: [string, string[]];
  normalizeRevision?: (raw: string) => string;
}

const VCS_DETECTORS: VcsDetector[] = [
  {
    type: "jj",
    rootCmd: ["jj", ["root"]],
    revisionCmd: ["jj", ["log", "-r", "@", "--no-graph", "-T", "change_id"]],
  },
  {
    type: "hg",
    rootCmd: ["hg", ["root"]],
    revisionCmd: ["hg", ["id", "-i"]],
    normalizeRevision: (raw) => raw.replace(/\+$/, ""),
  },
  {
    type: "svn",
    rootCmd: ["svn", ["info", "--show-item", "wc-root"]],
    revisionCmd: ["svn", ["info", "--show-item", "revision"]],
  },
  {
    type: "git",
    rootCmd: ["git", ["rev-parse", "--show-toplevel"]],
    revisionCmd: ["git", ["rev-parse", "HEAD"]],
  },
];

type VcsContext = { root: string; vcs?: Vcs };

function execQuiet(
  cmd: string,
  args: string[],
  cwd?: string,
): string | undefined {
  try {
    return execFileSync(cmd, args, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

export function detectVcsContext(cwd: string): VcsContext {
  for (const detector of VCS_DETECTORS) {
    const root = execQuiet(...detector.rootCmd, cwd);
    if (!root) continue;

    const rawRevision = execQuiet(...detector.revisionCmd, cwd);
    const vcs = rawRevision
      ? {
          type: detector.type,
          revision: detector.normalizeRevision
            ? detector.normalizeRevision(rawRevision)
            : rawRevision,
        }
      : undefined;

    return { root, vcs };
  }
  return { root: cwd };
}

let cachedContext: VcsContext | undefined;

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
    model?: string;
    rangePositions?: RangePosition[];
    transcript?: string | null;
    tool?: { name: string; version?: string };
    metadata?: Record<string, unknown>;
  } = {},
): TraceRecord | undefined {
  const root = getWorkspaceRoot();
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

export function appendTrace(trace: TraceRecord): void {
  const root = getWorkspaceRoot();
  const filePath = join(root, TRACE_PATH);
  const dir = join(root, ".agent-trace");
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
