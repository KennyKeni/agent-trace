import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { HookInput } from "./types";

export type IgnoreMode = "redact" | "skip";

export interface IgnoreConfig {
  useGitignore: boolean;
  useBuiltinSensitive: boolean;
  patterns: string[];
  mode: IgnoreMode;
}

export interface AgentTraceConfig {
  extensions: string[] | null;
  ignore: IgnoreConfig;
}

export const BUILTIN_SENSITIVE = [
  "**/.env",
  "**/.env.*",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
  "**/id_rsa",
  "**/id_dsa",
  "**/id_ecdsa",
  "**/id_ed25519",
  "**/*.kubeconfig",
  "**/credentials.*",
];

interface RawConfig {
  extensions?: unknown;
  useGitignore?: unknown;
  useBuiltinSensitive?: unknown;
  ignore?: unknown;
  ignoreMode?: unknown;
}

function parseRawConfig(configPath: string): RawConfig | null {
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf-8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as RawConfig;
    }
    return null;
  } catch {
    console.error("agent-trace: malformed config.json");
    return null;
  }
}

function extractExtensions(raw: RawConfig | null): string[] | null {
  if (!raw || !Array.isArray(raw.extensions)) return null;
  return raw.extensions.filter(
    (e: unknown): e is string => typeof e === "string",
  );
}

function extractIgnoreConfig(raw: RawConfig | null): IgnoreConfig {
  return {
    useGitignore: raw?.useGitignore !== false,
    useBuiltinSensitive: raw?.useBuiltinSensitive !== false,
    patterns: Array.isArray(raw?.ignore)
      ? (raw.ignore as unknown[]).filter(
          (p): p is string => typeof p === "string",
        )
      : [],
    mode: raw?.ignoreMode === "skip" ? "skip" : "redact",
  };
}

export function loadConfig(root: string): AgentTraceConfig {
  const configPath = join(root, ".agent-trace", "config.json");
  const raw = parseRawConfig(configPath);
  return {
    extensions: extractExtensions(raw),
    ignore: extractIgnoreConfig(raw),
  };
}

export function loadIgnoreConfig(root: string): IgnoreConfig {
  return loadConfig(root).ignore;
}

function toRelPosix(filePath: string, root: string): string {
  const abs = isAbsolute(filePath) ? filePath : resolve(root, filePath);
  return relative(root, abs).split(sep).join("/");
}

const globCache = new Map<string, InstanceType<typeof Bun.Glob>>();

function getGlob(pattern: string): InstanceType<typeof Bun.Glob> {
  let g = globCache.get(pattern);
  if (!g) {
    g = new Bun.Glob(pattern);
    globCache.set(pattern, g);
  }
  return g;
}

function matchesAnyPattern(relPath: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (getGlob(pattern).match(relPath)) return true;
  }
  return false;
}

const gitIgnoreCache = new Map<string, boolean>();

function gitCheckIgnore(relPath: string, root: string): boolean {
  const key = `${root}\0${relPath}`;
  const cached = gitIgnoreCache.get(key);
  if (cached !== undefined) return cached;

  try {
    execFileSync("git", ["check-ignore", "-q", relPath], {
      cwd: root,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    gitIgnoreCache.set(key, true);
    return true;
  } catch {
    gitIgnoreCache.set(key, false);
    return false;
  }
}

export function isIgnored(
  filePath: string,
  root: string,
  config: IgnoreConfig,
): boolean {
  const relPath = toRelPosix(filePath, root);

  if (
    config.useBuiltinSensitive &&
    matchesAnyPattern(relPath, BUILTIN_SENSITIVE)
  ) {
    return true;
  }

  if (config.patterns.length > 0 && matchesAnyPattern(relPath, config.patterns))
    return true;

  if (config.useGitignore && gitCheckIgnore(relPath, root)) return true;

  return false;
}

export function extractFilePathsFromRaw(
  provider: string,
  input: HookInput,
): string[] | null {
  const raw = input as unknown as Record<string, unknown>;

  switch (provider) {
    case "claude": {
      const toolInput = raw.tool_input as Record<string, unknown> | undefined;
      if (!toolInput) return null;
      const filePath = toolInput.file_path as string | undefined;
      return filePath ? [filePath] : [];
    }
    case "cursor": {
      const filePath = raw.file_path as string | undefined;
      const hasEdits = Array.isArray(raw.edits);
      if (!filePath && !hasEdits) return null;
      return filePath ? [filePath] : [];
    }
    case "opencode": {
      const files = raw.files as Array<{ file: string }> | undefined;
      if (files && Array.isArray(files)) {
        const paths = files
          .map((f) => (typeof f?.file === "string" ? f.file : ""))
          .filter(Boolean);
        return paths.length > 0 ? paths : [];
      }
      const filePath = raw.file_path as string | undefined;
      if (filePath) return [filePath];
      const eventName = raw.hook_event_name as string | undefined;
      if (
        eventName === "file.edited" ||
        eventName === "hook:tool.execute.after"
      ) {
        return [];
      }
      return null;
    }
    default:
      return null;
  }
}

const SENSITIVE_KEYS = new Set([
  "old_string",
  "new_string",
  "content",
  "before",
  "after",
  "originalFile",
]);

function scrubValue(obj: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key) && typeof value === "string") {
      obj[key] = "[REDACTED]";
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      scrubValue(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          scrubValue(item as Record<string, unknown>);
        }
      }
    }
  }
}

export function scrubRawInput(input: HookInput): HookInput {
  const cloned = structuredClone(input);
  scrubValue(cloned as unknown as Record<string, unknown>);
  return cloned;
}
