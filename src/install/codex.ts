import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChangeSummary } from "./types";
import { getPackageName, getPackageVersion, writeTextFile } from "./utils";

function codexConfigPath(): string {
  const home = process.env.CODEX_HOME ?? join(homedir(), ".codex");
  return join(home, "config.toml");
}

function buildNotifyValue(pinVersion: boolean): string {
  const pkg = getPackageName();
  const target = pinVersion ? `${pkg}@${getPackageVersion()}` : pkg;
  return `notify = ["bunx", "-y", "${target}", "codex", "notify"]`;
}

export function installCodex(
  dryRun: boolean,
  pinVersion = true,
): ChangeSummary {
  const configPath = codexConfigPath();
  const notifyLine = buildNotifyValue(pinVersion);

  let content = "";
  if (existsSync(configPath)) {
    content = readFileSync(configPath, "utf-8");
  }

  if (/^notify\s*=.*agent-trace/m.test(content)) {
    return { file: configPath, status: "unchanged" };
  }

  const notifyPattern = /^notify\s*=\s*\[.*\]\s*$/m;
  let next: string;
  if (notifyPattern.test(content)) {
    next = content.replace(notifyPattern, notifyLine);
  } else {
    // Insert at global scope (before first [section] header)
    const sectionMatch = content.match(/^\[/m);
    if (sectionMatch?.index !== undefined) {
      const before = content.slice(0, sectionMatch.index).trimEnd();
      const after = content.slice(sectionMatch.index);
      next = `${before}\n${notifyLine}\n\n${after}`;
    } else {
      const trimmed = content.trimEnd();
      next = trimmed ? `${trimmed}\n${notifyLine}\n` : `${notifyLine}\n`;
    }
  }

  return writeTextFile(configPath, next, dryRun);
}
