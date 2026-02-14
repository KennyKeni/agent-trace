import { join } from "node:path";
import type { ChangeSummary } from "./types";
import { hookCommand, readJson, writeJson } from "./utils";

function ensureClaudeCommandGroup(
  hooks: Record<string, unknown>,
  event: string,
  command: string,
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
        ((entry as Record<string, unknown>).command as string).includes(
          "agent-trace",
        )
      ),
  );
  filtered.push({ type: "command", command });
  target.hooks = filtered;
  hooks[event] = groups;
}

export function installClaude(
  targetRoot: string,
  dryRun: boolean,
  pinVersion = true,
): ChangeSummary {
  const path = join(targetRoot, ".claude", "settings.json");
  const command = hookCommand("claude", { pinVersion });

  const config = readJson(path);
  const hooks = (config.hooks ?? {}) as Record<string, unknown>;

  ensureClaudeCommandGroup(hooks, "SessionStart", command);
  ensureClaudeCommandGroup(hooks, "SessionEnd", command);
  ensureClaudeCommandGroup(hooks, "UserPromptSubmit", command);
  ensureClaudeCommandGroup(hooks, "PreToolUse", command, "Bash");
  ensureClaudeCommandGroup(hooks, "PostToolUse", command, "Write|Edit");
  ensureClaudeCommandGroup(hooks, "PostToolUse", command, "Bash");
  ensureClaudeCommandGroup(
    hooks,
    "PostToolUseFailure",
    command,
    "Write|Edit|Bash",
  );

  return writeJson(path, { ...config, hooks }, dryRun);
}
