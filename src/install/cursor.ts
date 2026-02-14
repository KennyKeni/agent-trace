import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ChangeSummary } from "./types";
import { getPackageName, hookCommand, readJson, writeJson } from "./utils";

const CURSOR_EVENTS = [
  "sessionStart",
  "sessionEnd",
  "beforeSubmitPrompt",
  "beforeShellExecution",
  "afterFileEdit",
  "afterTabFileEdit",
  "afterShellExecution",
];

export function installCursor(
  targetRoot: string,
  dryRun: boolean,
  version: string,
): ChangeSummary {
  const path = join(targetRoot, ".cursor", "hooks.json");
  const command = hookCommand("cursor", version);

  const pkg = getPackageName();
  const config = readJson(path);
  const hooks = (config.hooks ?? {}) as Record<string, unknown>;

  for (const event of CURSOR_EVENTS) {
    const entries = Array.isArray(hooks[event])
      ? [...(hooks[event] as unknown[])]
      : [];
    const filtered = entries.filter(
      (entry) =>
        !(
          entry &&
          typeof entry === "object" &&
          typeof (entry as Record<string, unknown>).command === "string" &&
          ((entry as Record<string, unknown>).command as string).includes(pkg)
        ),
    );
    filtered.push({ command });
    hooks[event] = filtered;
  }

  const next = {
    ...config,
    version: Number.isInteger(config.version) ? config.version : 1,
    hooks,
  };

  return writeJson(path, next, dryRun);
}

function isAgentTraceEntry(entry: unknown, pkg: string): boolean {
  return !!(
    entry &&
    typeof entry === "object" &&
    typeof (entry as Record<string, unknown>).command === "string" &&
    ((entry as Record<string, unknown>).command as string).includes(pkg)
  );
}

export function uninstallCursor(
  targetRoot: string,
  dryRun: boolean,
): ChangeSummary {
  const path = join(targetRoot, ".cursor", "hooks.json");
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

  for (const event of CURSOR_EVENTS) {
    if (!Array.isArray(hooksObj[event])) continue;
    const entries = hooksObj[event] as unknown[];
    const filtered = entries.filter((e) => !isAgentTraceEntry(e, pkg));
    if (filtered.length !== entries.length) changed = true;
    if (filtered.length === 0) {
      delete hooksObj[event];
    } else {
      hooksObj[event] = filtered;
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
