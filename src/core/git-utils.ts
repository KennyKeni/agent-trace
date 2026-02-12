import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export interface RangePosition {
  start_line: number;
  end_line: number;
}

function runGit(args: string[], cwd: string): string | undefined {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function listDirtyFiles(root: string): string[] {
  const out = runGit(["status", "--porcelain", "-uall", "--no-renames"], root);
  if (!out) return [];
  return out
    .split("\n")
    .filter((line) => line.length > 3)
    .map((line) => line.slice(3));
}

function hashPath(filePath: string): string | undefined {
  try {
    const content = readFileSync(filePath, "utf-8");
    const h = Bun.hash.murmur32v3(content, 0) >>> 0;
    return h.toString(16).padStart(8, "0");
  } catch {
    return undefined;
  }
}

export function getDirtyFileHashes(root: string): Map<string, string> {
  const files = listDirtyFiles(root);
  const result = new Map<string, string>();
  for (const rel of files) {
    const hash = hashPath(`${root}/${rel}`);
    if (hash) result.set(rel, hash);
  }
  return result;
}

export function diffChangedPaths(
  before: Map<string, string>,
  after: Map<string, string>,
): string[] {
  const changed: string[] = [];
  for (const [path, hash] of after) {
    if (before.get(path) !== hash) {
      changed.push(path);
    }
  }
  for (const path of before.keys()) {
    if (!after.has(path) && !changed.includes(path)) {
      changed.push(path);
    }
  }
  return changed;
}

export function getGitDiffForPath(
  path: string,
  root: string,
): string | undefined {
  return runGit(["diff", "--no-color", "--", path], root);
}

export function parseRangesFromUnifiedDiff(diff: string): RangePosition[] {
  const ranges: RangePosition[] = [];
  const hunkPattern = /^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@/;

  for (const line of diff.split("\n")) {
    const match = hunkPattern.exec(line);
    if (match) {
      const start = Number.parseInt(match[1] ?? "1", 10);
      const count = match[2] ? Number.parseInt(match[2], 10) : 1;
      ranges.push({
        start_line: start,
        end_line: start + Math.max(count - 1, 0),
      });
    }
  }
  return ranges;
}
