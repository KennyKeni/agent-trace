import { join } from "node:path";
import type { ChangeSummary } from "./types";
import { hookCommand, readJson, writeJson } from "./utils";

export function installCursor(
  targetRoot: string,
  dryRun: boolean,
  pinVersion = true,
): ChangeSummary {
  const path = join(targetRoot, ".cursor", "hooks.json");
  const command = hookCommand("cursor", { pinVersion });

  const config = readJson(path);
  const hooks = (config.hooks ?? {}) as Record<string, unknown>;
  const events = [
    "sessionStart",
    "sessionEnd",
    "beforeSubmitPrompt",
    "beforeShellExecution",
    "afterFileEdit",
    "afterTabFileEdit",
    "afterShellExecution",
  ];

  for (const event of events) {
    const entries = Array.isArray(hooks[event])
      ? [...(hooks[event] as unknown[])]
      : [];
    const filtered = entries.filter(
      (entry) =>
        !(
          entry &&
          typeof entry === "object" &&
          typeof (entry as Record<string, unknown>).command === "string" &&
          ((entry as Record<string, unknown>).command as string).includes(
            "agent-trace",
          )
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
