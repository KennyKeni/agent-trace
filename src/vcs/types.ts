export type SnapshotId = string;

export interface Hunk {
  start_line: number;
  end_line: number;
  change_type: "added" | "modified" | "deleted";
}

export interface FileDiff {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  oldPath?: string;
  binary?: boolean;
  hunks: Hunk[];
  hunkPatch?: string;
  patch?: string;
}

export interface NormalizedDiff {
  files: FileDiff[];
}

export interface VcsSnapshotProvider {
  kind: "git" | "jj" | "hg" | "svn";
  detect(repoRoot: string): Promise<boolean>;
  captureSnapshot(repoRoot: string): Promise<SnapshotId>;
  diffSnapshots(
    from: SnapshotId,
    to: SnapshotId,
    repoRoot: string,
    opts?: { includePatch?: boolean },
  ): Promise<NormalizedDiff>;
}
