import { existsSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { ChangeSummary } from "./types";
import { readJson, writeJson } from "./utils";

export function readConfig(targetRoot: string): Record<string, unknown> | null {
  const path = join(targetRoot, ".agent-trace", "config.json");
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function installConfig(
  targetRoot: string,
  dryRun: boolean,
  version: string,
  extensions: string[] = [],
): ChangeSummary {
  const path = join(targetRoot, ".agent-trace", "config.json");

  if (existsSync(path)) {
    return { file: path, status: "unchanged", note: "already exists" };
  }

  const config = {
    version,
    extensions,
    useGitignore: true,
    useBuiltinSensitive: true,
    ignore: [] as string[],
    ignoreMode: "redact",
  };

  return writeJson(path, config, dryRun);
}

export function updateConfigVersion(
  targetRoot: string,
  version: string,
  dryRun: boolean,
): ChangeSummary {
  const path = join(targetRoot, ".agent-trace", "config.json");
  const config = readJson(path);
  config.version = version;
  return writeJson(path, config, dryRun);
}

export function uninstallConfig(
  targetRoot: string,
  dryRun: boolean,
  purge: boolean,
): ChangeSummary {
  const dir = join(targetRoot, ".agent-trace");

  if (purge) {
    if (!existsSync(dir)) {
      return { file: dir, status: "unchanged", note: "not found" };
    }
    if (!dryRun) rmSync(dir, { recursive: true });
    return { file: dir, status: "removed", note: "purged" };
  }

  const configPath = join(dir, "config.json");
  if (!existsSync(configPath)) {
    return { file: configPath, status: "unchanged", note: "not found" };
  }
  if (!dryRun) unlinkSync(configPath);
  return { file: configPath, status: "removed" };
}
