import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { detectVcsContext } from "../vcs/detect";
import type { ChangeSummary } from "./types";

const GITIGNORE_ENTRY = ".agent-trace/";
const HGIGNORE_ENTRY = "^\\.agent-trace/";

function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

function containsEntry(content: string, entry: string): boolean {
  return content.split("\n").some((line) => line.trim() === entry);
}

function appendEntry(
  filePath: string,
  entry: string,
  dryRun: boolean,
): ChangeSummary {
  let content = "";
  const exists = existsSync(filePath);
  if (exists) {
    content = readFileSync(filePath, "utf-8");
  }

  if (containsEntry(content, entry)) {
    return { file: filePath, status: "unchanged", note: "already ignored" };
  }

  const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  const newContent = `${content}${separator}${entry}\n`;

  if (!dryRun) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, newContent, "utf-8");
  }

  return {
    file: filePath,
    status: exists ? "updated" : "created",
    note: `added ${GITIGNORE_ENTRY} to ignore`,
  };
}

export function installIgnoreEntry(
  targetRoot: string,
  dryRun: boolean,
): ChangeSummary {
  const ctx = detectVcsContext(targetRoot);
  const vcsType = ctx.vcs?.type;

  const realRoot = safeRealpath(ctx.root);
  const realTarget = safeRealpath(targetRoot);
  const rel = relative(realRoot, realTarget);
  const isDescendant = !rel.startsWith("..") && !isAbsolute(rel);
  const ignoreRoot = isDescendant ? ctx.root : targetRoot;

  switch (vcsType) {
    case "git":
    case "jj":
      return appendEntry(
        join(ignoreRoot, ".gitignore"),
        GITIGNORE_ENTRY,
        dryRun,
      );

    case "hg":
      return appendEntry(join(ignoreRoot, ".hgignore"), HGIGNORE_ENTRY, dryRun);

    case "svn":
      return {
        file: join(ignoreRoot, "(svn:ignore)"),
        status: "skipped",
        note: "SVN ignore requires manual svn:ignore setup",
      };

    default:
      return appendEntry(
        join(ignoreRoot, ".gitignore"),
        GITIGNORE_ENTRY,
        dryRun,
      );
  }
}
