import type { Provider } from "../providers/types";

export interface ChangeSummary {
  file: string;
  status: "created" | "updated" | "unchanged" | "skipped" | "removed";
  note?: string;
}

export interface InstallOptions {
  providers: Provider[];
  extensions?: string[];
  dryRun: boolean;
  version: string;
  targetRoots: string[];
}

export interface UninstallOptions {
  providers: Provider[];
  providersSpecified: boolean;
  purge: boolean;
  dryRun: boolean;
  targetRoots: string[];
}
