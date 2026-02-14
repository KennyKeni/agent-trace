import { execFileSync } from "node:child_process";
import type { Vcs, VcsType } from "../core/schemas";

interface VcsDetector {
  type: VcsType;
  rootCmd: [string, string[]];
  revisionCmd: [string, string[]];
  normalizeRevision?: (raw: string) => string;
}

const VCS_DETECTORS: VcsDetector[] = [
  {
    type: "jj",
    rootCmd: ["jj", ["root"]],
    revisionCmd: ["jj", ["log", "-r", "@", "--no-graph", "-T", "change_id"]],
  },
  {
    type: "hg",
    rootCmd: ["hg", ["root"]],
    revisionCmd: ["hg", ["id", "-i"]],
    normalizeRevision: (raw) => raw.replace(/\+$/, ""),
  },
  {
    type: "svn",
    rootCmd: ["svn", ["info", "--show-item", "wc-root"]],
    revisionCmd: ["svn", ["info", "--show-item", "revision"]],
  },
  {
    type: "git",
    rootCmd: ["git", ["rev-parse", "--show-toplevel"]],
    revisionCmd: ["git", ["rev-parse", "HEAD"]],
  },
];

export type VcsContext = { root: string; vcs?: Vcs };

function execQuiet(
  cmd: string,
  args: string[],
  cwd?: string,
): string | undefined {
  try {
    return execFileSync(cmd, args, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

export function detectVcsContext(cwd: string): VcsContext {
  for (const detector of VCS_DETECTORS) {
    const root = execQuiet(...detector.rootCmd, cwd);
    if (!root) continue;

    const rawRevision = execQuiet(...detector.revisionCmd, cwd);
    const vcs = rawRevision
      ? {
          type: detector.type,
          revision: detector.normalizeRevision
            ? detector.normalizeRevision(rawRevision)
            : rawRevision,
        }
      : undefined;

    return { root, vcs };
  }
  return { root: cwd };
}
