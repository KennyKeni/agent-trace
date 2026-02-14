import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ChangeSummary } from "./types";
import { getPackageName, hookCommand, readJson, writeJson } from "./utils";

const CLAUDE_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
];

function ensureClaudeCommandGroup(
  hooks: Record<string, unknown>,
  event: string,
  command: string,
  pkg: string,
  matcher?: string,
): void {
  const groups = Array.isArray(hooks[event])
    ? [...(hooks[event] as unknown[])]
    : [];
  let target: Record<string, unknown> | undefined;

  for (const group of groups) {
    if (!group || typeof group !== "object") continue;
    const candidate = group as Record<string, unknown>;
    const candidateMatcher =
      typeof candidate.matcher === "string" ? candidate.matcher : undefined;
    if ((matcher ?? undefined) === candidateMatcher) {
      target = candidate;
      break;
    }
  }

  if (!target) {
    target = {};
    if (matcher) target.matcher = matcher;
    target.hooks = [];
    groups.push(target);
  }

  const inner = Array.isArray(target.hooks)
    ? [...(target.hooks as unknown[])]
    : [];
  const filtered = inner.filter(
    (entry) =>
      !(
        entry &&
        typeof entry === "object" &&
        (entry as Record<string, unknown>).type === "command" &&
        typeof (entry as Record<string, unknown>).command === "string" &&
        ((entry as Record<string, unknown>).command as string).includes(pkg)
      ),
  );
  filtered.push({ type: "command", command });
  target.hooks = filtered;
  hooks[event] = groups;
}

export function installClaude(
  targetRoot: string,
  dryRun: boolean,
  version: string,
): ChangeSummary {
  const path = join(targetRoot, ".claude", "settings.json");
  const command = hookCommand("claude", version);
  const pkg = getPackageName();

  const config = readJson(path);
  const hooks = (config.hooks ?? {}) as Record<string, unknown>;

  ensureClaudeCommandGroup(hooks, "SessionStart", command, pkg);
  ensureClaudeCommandGroup(hooks, "SessionEnd", command, pkg);
  ensureClaudeCommandGroup(hooks, "UserPromptSubmit", command, pkg);
  ensureClaudeCommandGroup(hooks, "PreToolUse", command, pkg, "Bash");
  ensureClaudeCommandGroup(hooks, "PostToolUse", command, pkg, "Write|Edit");
  ensureClaudeCommandGroup(hooks, "PostToolUse", command, pkg, "Bash");
  ensureClaudeCommandGroup(
    hooks,
    "PostToolUseFailure",
    command,
    pkg,
    "Write|Edit|Bash",
  );

  return writeJson(path, { ...config, hooks }, dryRun);
}

function isAgentTraceHook(entry: unknown, pkg: string): boolean {
  return !!(
    entry &&
    typeof entry === "object" &&
    (entry as Record<string, unknown>).type === "command" &&
    typeof (entry as Record<string, unknown>).command === "string" &&
    ((entry as Record<string, unknown>).command as string).includes(pkg)
  );
}

export function uninstallClaude(
  targetRoot: string,
  dryRun: boolean,
): ChangeSummary {
  const path = join(targetRoot, ".claude", "settings.json");
  if (!existsSync(path)) {
    return { file: path, status: "unchanged", note: "not found" };
  }

  let config: Record<string, unknown>;
  try {
    config = readJson(path);
  } catch {
    return { file: path, status: "skipped", note: "malformed config" };
  }

  const hooks = config.hooks;
  if (!hooks || typeof hooks !== "object") {
    return { file: path, status: "unchanged" };
  }

  const pkg = getPackageName();
  const hooksObj = hooks as Record<string, unknown>;
  let changed = false;

  for (const event of CLAUDE_EVENTS) {
    if (!Array.isArray(hooksObj[event])) continue;
    const groups = hooksObj[event] as Record<string, unknown>[];

    for (const group of groups) {
      if (!Array.isArray(group.hooks)) continue;
      const inner = group.hooks as unknown[];
      const filtered = inner.filter((e) => !isAgentTraceHook(e, pkg));
      if (filtered.length !== inner.length) changed = true;
      group.hooks = filtered;
    }

    const nonEmpty = groups.filter(
      (g) => Array.isArray(g.hooks) && (g.hooks as unknown[]).length > 0,
    );
    if (nonEmpty.length === 0) {
      delete hooksObj[event];
    } else {
      hooksObj[event] = nonEmpty;
    }
  }

  if (Object.keys(hooksObj).length === 0) {
    delete config.hooks;
  }

  if (!changed) {
    return { file: path, status: "unchanged" };
  }

  return writeJson(path, config, dryRun);
}
