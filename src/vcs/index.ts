import { gitSnapshotProvider } from "./git";
import type { VcsSnapshotProvider } from "./types";

export type { VcsSnapshotProvider } from "./types";

const providers: VcsSnapshotProvider[] = [gitSnapshotProvider];

export async function detectSnapshotProvider(
  repoRoot: string,
): Promise<VcsSnapshotProvider | undefined> {
  for (const provider of providers) {
    if (await provider.detect(repoRoot)) return provider;
  }
  return undefined;
}
