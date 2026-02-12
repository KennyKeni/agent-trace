import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChangeSummary } from "./types";
import { getPackageName, getPackageVersion, writeTextFile } from "./utils";

export function installOpenCode(
  targetRoot: string,
  dryRun: boolean,
  pinVersion = true,
): ChangeSummary {
  const templatePath = join(import.meta.dir, "templates", "opencode-plugin.ts");
  const raw = readFileSync(templatePath, "utf-8");
  const name = getPackageName();
  const pkg = pinVersion ? `${name}@${getPackageVersion()}` : name;
  const content = raw.replace("__AGENT_TRACE_PKG__", pkg);
  const path = join(targetRoot, ".opencode", "plugins", "agent-trace.ts");
  return writeTextFile(path, content, dryRun);
}
