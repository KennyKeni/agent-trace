import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChangeSummary } from "./types";
import { getPackageName, writeTextFile } from "./utils";

function codexConfigPath(): string {
  const home = process.env.CODEX_HOME ?? join(homedir(), ".codex");
  return join(home, "config.toml");
}

function buildNotifyValue(): string {
  const pkg = getPackageName();
  return `notify = ["bunx", "-y", "${pkg}", "codex", "notify"]`;
}

export function installCodex(dryRun: boolean): ChangeSummary {
  const configPath = codexConfigPath();
  const notifyLine = buildNotifyValue();

  let content = "";
  if (existsSync(configPath)) {
    content = readFileSync(configPath, "utf-8");
  }

  const pkg = getPackageName();
  if (content.includes(pkg) && /^notify\s*=/m.test(content)) {
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

export function uninstallCodex(dryRun: boolean): ChangeSummary {
  const configPath = codexConfigPath();
  if (!existsSync(configPath)) {
    return { file: configPath, status: "unchanged", note: "not found" };
  }

  let content: string;
  try {
    content = readFileSync(configPath, "utf-8");
  } catch {
    return { file: configPath, status: "skipped", note: "could not read" };
  }

  const pkg = getPackageName();
  if (!content.includes(pkg)) {
    return { file: configPath, status: "unchanged" };
  }

  // Remove single-line notify containing the package
  const singleLine = /^notify\s*=\s*\[.*\]\s*$/m;
  // Remove multiline notify containing the package
  const multiLine = /^notify\s*=\s*\[\s*\n(?:.*\n)*?\s*\]\s*$/m;

  let next = content;
  for (const pattern of [singleLine, multiLine]) {
    const match = next.match(pattern);
    if (match?.[0].includes(pkg) && match.index !== undefined) {
      next =
        next.slice(0, match.index) + next.slice(match.index + match[0].length);
    }
  }

  // Clean up extra blank lines left behind
  next = next.replace(/\n{3,}/g, "\n\n");

  if (next === content) {
    return { file: configPath, status: "unchanged" };
  }

  return writeTextFile(configPath, next, dryRun);
}
