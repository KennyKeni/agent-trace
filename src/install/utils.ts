import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDir } from "../core/utils";
import type { ChangeSummary } from "./types";

export function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf-8");
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Failed to parse JSON at ${path}`);
  }
}

export function writeJson(
  path: string,
  value: unknown,
  dryRun: boolean,
): ChangeSummary {
  const next = `${JSON.stringify(value, null, 2)}\n`;
  return writeTextFile(path, next, dryRun);
}

export function writeTextFile(
  path: string,
  content: string,
  dryRun: boolean,
): ChangeSummary {
  let previous = "";
  if (existsSync(path)) previous = readFileSync(path, "utf-8");
  const status: ChangeSummary["status"] = existsSync(path)
    ? previous === content
      ? "unchanged"
      : "updated"
    : "created";
  if (!dryRun && status !== "unchanged") {
    ensureDir(dirname(path));
    writeFileSync(path, content, "utf-8");
  }
  return { file: path, status };
}

function findPackageRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

function readPkg(): { name: string; version: string } {
  const dir = dirname(fileURLToPath(import.meta.url));
  const root = findPackageRoot(dir);
  return JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
}

export function getPackageName(): string {
  return readPkg().name;
}

export function getPackageVersion(): string {
  return readPkg().version;
}

export function hookCommand(provider: string, version: string): string {
  const pkg = getPackageName();
  const target = version === "latest" ? pkg : `${pkg}@${version}`;
  return `bunx ${target} hook --provider ${provider}`;
}
