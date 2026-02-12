import type { Provider } from "../providers/types";

export interface ChangeSummary {
  file: string;
  status: "created" | "updated" | "unchanged" | "skipped";
  note?: string;
}

export interface InstallOptions {
  providers: Provider[];
  dryRun: boolean;
  pinVersion: boolean;
  targetRoots: string[];
}
