import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ChangeSummary } from "./types";
import { writeJson } from "./utils";

const DEFAULT_CONFIG = {
  extensions: ["diffs", "line-hashes", "raw-events", "messages"],
  useGitignore: true,
  useBuiltinSensitive: true,
  ignore: [] as string[],
  ignoreMode: "redact",
};

export function installConfig(
  targetRoot: string,
  dryRun: boolean,
): ChangeSummary {
  const path = join(targetRoot, ".agent-trace", "config.json");

  if (existsSync(path)) {
    return { file: path, status: "unchanged", note: "already exists" };
  }

  return writeJson(path, DEFAULT_CONFIG, dryRun);
}
