import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { ChangeSummary } from "./types";
import { getPackageName, writeTextFile } from "./utils";

export function installOpenCode(
  targetRoot: string,
  dryRun: boolean,
  version: string,
): ChangeSummary {
  const templatePath = join(import.meta.dir, "templates", "opencode-plugin.ts");
  const raw = readFileSync(templatePath, "utf-8");
  const name = getPackageName();
  const pkg = version === "latest" ? name : `${name}@${version}`;
  const content = raw.replace("__AGENT_TRACE_PKG__", pkg);
  const path = join(targetRoot, ".opencode", "plugins", "agent-trace.ts");
  return writeTextFile(path, content, dryRun);
}

export function uninstallOpenCode(
  targetRoot: string,
  dryRun: boolean,
): ChangeSummary {
  const path = join(targetRoot, ".opencode", "plugins", "agent-trace.ts");
  if (!existsSync(path)) {
    return { file: path, status: "unchanged", note: "not found" };
  }
  if (!dryRun) unlinkSync(path);
  return { file: path, status: "removed" };
}
