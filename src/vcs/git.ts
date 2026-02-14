import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHunksFromPatch, segmentPatchByFile } from "./parse-diff";
import type {
  FileDiff,
  NormalizedDiff,
  SnapshotId,
  VcsSnapshotProvider,
} from "./types";

async function runGit(
  args: string[],
  cwd: string,
  env?: Record<string, string>,
): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(
      `git ${args[0]} failed (exit ${exitCode}): ${stderr.trim()}`,
    );
  }
  return stdout.trimEnd();
}

type RawFileEntry = {
  status: string;
  path: string;
  oldPath?: string;
  oldMode: string;
  newMode: string;
};

function parseRawDiffTree(output: string): RawFileEntry[] {
  if (!output) return [];
  // --raw -z output: colon-prefixed metadata\0path[\0path]\0...
  // Each entry: :<oldMode> <newMode> <oldSha> <newSha> <status>\0<path>\0[<path>\0]
  const parts = output.split("\0");
  const entries: RawFileEntry[] = [];
  let i = 0;
  while (i < parts.length) {
    const meta = parts[i];
    if (!meta || !meta.startsWith(":")) {
      i++;
      continue;
    }
    // Parse: :<oldMode> <newMode> <oldSha> <newSha> <statusLetter>[score]
    const metaMatch = meta.match(
      /^:(\d+)\s+(\d+)\s+[0-9a-f]+\s+[0-9a-f]+\s+([A-Z])(\d*)/,
    );
    if (!metaMatch || !metaMatch[1] || !metaMatch[2] || !metaMatch[3]) {
      i++;
      continue;
    }
    const oldMode = metaMatch[1];
    const newMode = metaMatch[2];
    const statusLetter = metaMatch[3];
    i++;

    const path = parts[i] ?? "";
    i++;

    let oldPath: string | undefined;
    if (statusLetter === "R" || statusLetter === "C") {
      // Rename/copy: two paths (old then new)
      oldPath = path;
      const newPath = parts[i] ?? "";
      i++;
      entries.push({
        status: statusLetter,
        path: newPath,
        oldPath,
        oldMode,
        newMode,
      });
    } else {
      entries.push({ status: statusLetter, path, oldMode, newMode });
    }
  }
  return entries;
}

function statusFromLetter(letter: string): FileDiff["status"] | undefined {
  switch (letter) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "T":
      return "modified"; // type change mapped to modified
    default:
      return undefined;
  }
}

export const gitSnapshotProvider: VcsSnapshotProvider = {
  kind: "git",

  async detect(repoRoot: string): Promise<boolean> {
    try {
      await runGit(["rev-parse", "--show-toplevel"], repoRoot);
      return true;
    } catch {
      return false;
    }
  },

  async captureSnapshot(repoRoot: string): Promise<SnapshotId> {
    const tempIndex = join(
      tmpdir(),
      `agent-trace-idx-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    try {
      await runGit(["add", "-A", "--", "."], repoRoot, {
        GIT_INDEX_FILE: tempIndex,
      });
      const treeSha = await runGit(["write-tree"], repoRoot, {
        GIT_INDEX_FILE: tempIndex,
      });
      return treeSha;
    } finally {
      try {
        unlinkSync(tempIndex);
      } catch {
        // temp file cleanup is best-effort
      }
    }
  },

  async diffSnapshots(
    from: SnapshotId,
    to: SnapshotId,
    repoRoot: string,
    opts?: { includePatch?: boolean },
  ): Promise<NormalizedDiff> {
    if (from === to) return { files: [] };

    // Step 1: machine-friendly file metadata
    const rawOutput = await runGit(
      ["diff-tree", "--raw", "-z", "-r", "-M", from, to],
      repoRoot,
    );
    const rawEntries = parseRawDiffTree(rawOutput);

    if (rawEntries.length === 0) return { files: [] };

    // Step 2a: zero-context diff for accurate hunk/range computation
    // -c core.quotePath=false prevents git from quoting paths with special chars
    const hunkOutput = await runGit(
      [
        "-c",
        "core.quotePath=false",
        "-c",
        "color.ui=false",
        "diff-tree",
        "-r",
        "-M",
        "-p",
        "--unified=0",
        from,
        to,
      ],
      repoRoot,
    );
    const hunksByFile = segmentPatchByFile(hunkOutput);

    // Step 2b: context-rich diff for stored patch text (only when extensions need it)
    let patchByFile: Map<string, string> | undefined;
    if (opts?.includePatch) {
      const patchOutput = await runGit(
        [
          "-c",
          "core.quotePath=false",
          "-c",
          "color.ui=false",
          "diff-tree",
          "-r",
          "-M",
          "-p",
          "--unified=3",
          from,
          to,
        ],
        repoRoot,
      );
      patchByFile = segmentPatchByFile(patchOutput);
    }

    const files: FileDiff[] = [];
    for (const entry of rawEntries) {
      if (
        entry.path.startsWith(".agent-trace/") ||
        entry.oldPath?.startsWith(".agent-trace/")
      ) {
        continue;
      }

      const status = statusFromLetter(entry.status);
      if (!status) {
        console.warn(
          `[agent-trace] Unknown git status '${entry.status}' for path '${entry.path}', skipping`,
        );
        continue;
      }

      if (entry.status === "T") {
        console.warn(
          `[agent-trace] Git type change for '${entry.path}', no line attribution available`,
        );
      }

      const fileHunkPatch = hunksByFile.get(entry.path);
      const binary = fileHunkPatch
        ? fileHunkPatch.includes("Binary files") ||
          fileHunkPatch.includes("GIT binary patch")
        : false;
      if (binary) {
        files.push({
          path: entry.path,
          status,
          oldPath: entry.oldPath,
          binary: true,
          hunks: [],
        });
        continue;
      }

      // Deleted files and type changes get empty hunks per spec
      if (status === "deleted" || entry.status === "T") {
        files.push({
          path: entry.path,
          status,
          oldPath: entry.oldPath,
          hunks: [],
        });
        continue;
      }

      const hunks = fileHunkPatch ? parseHunksFromPatch(fileHunkPatch) : [];

      const diff: FileDiff = {
        path: entry.path,
        status,
        hunks,
      };

      if (fileHunkPatch) diff.hunkPatch = fileHunkPatch;
      if (entry.oldPath) diff.oldPath = entry.oldPath;
      if (opts?.includePatch) diff.patch = patchByFile?.get(entry.path);

      files.push(diff);
    }

    return { files };
  },
};
