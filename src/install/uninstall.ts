import { resolve } from "node:path";
import { parseArgs as nodeParseArgs } from "node:util";
import { getWorkspaceRoot } from "../core/trace-store";
import { isProvider, PROVIDERS, type Provider } from "../providers/types";
import { uninstallClaude } from "./claude";
import { uninstallConfig } from "./config";
import { uninstallCursor } from "./cursor";
import { uninstallOpenCode } from "./opencode";
import type { ChangeSummary, UninstallOptions } from "./types";

export class UninstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UninstallError";
  }
}

function parseProviders(raw?: string): {
  providers: Provider[];
  specified: boolean;
} {
  if (!raw) return { providers: [...PROVIDERS], specified: false };
  const values = raw
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  const invalid = values.filter((value) => !isProvider(value));
  if (invalid.length > 0) {
    throw new UninstallError(
      `Invalid providers: ${invalid.join(", ")}. Valid values: ${PROVIDERS.join(", ")}`,
    );
  }
  return { providers: values as Provider[], specified: true };
}

export function parseUninstallArgs(argv: string[]): UninstallOptions {
  let values: {
    providers?: string;
    "target-root"?: string[];
    "dry-run"?: boolean;
    purge?: boolean;
  };

  try {
    ({ values } = nodeParseArgs({
      args: argv,
      options: {
        providers: { type: "string" },
        "target-root": { type: "string", multiple: true },
        "dry-run": { type: "boolean" },
        purge: { type: "boolean" },
      },
      strict: true,
    }));
  } catch (err) {
    if (err instanceof TypeError) {
      throw new UninstallError(err.message);
    }
    throw err;
  }

  const { providers, specified } = parseProviders(values.providers);
  const dryRun = values["dry-run"] ?? false;
  const purge = values.purge ?? false;

  const targetRoots = values["target-root"]?.map((p) => resolve(p)) ?? [];
  if (targetRoots.length === 0) {
    targetRoots.push(getWorkspaceRoot());
  }

  const dedupedTargets = [...new Set(targetRoots)];

  return {
    providers,
    providersSpecified: specified,
    purge,
    dryRun,
    targetRoots: dedupedTargets,
  };
}

export function uninstall(options: UninstallOptions): ChangeSummary[] {
  const changes: ChangeSummary[] = [];

  for (const targetRoot of options.targetRoots) {
    if (options.providers.includes("cursor")) {
      changes.push(uninstallCursor(targetRoot, options.dryRun));
    }
    if (options.providers.includes("claude")) {
      changes.push(uninstallClaude(targetRoot, options.dryRun));
    }
    if (options.providers.includes("opencode")) {
      changes.push(uninstallOpenCode(targetRoot, options.dryRun));
    }

    if (!options.providersSpecified || options.purge) {
      changes.push(uninstallConfig(targetRoot, options.dryRun, options.purge));
    }
  }

  return changes;
}

export function printUninstallSummary(changes: ChangeSummary[]): void {
  if (changes.length === 0) {
    console.log("Nothing to uninstall.");
    return;
  }

  for (const change of changes) {
    const line = change.note
      ? `${change.status.toUpperCase()}: ${change.file} (${change.note})`
      : `${change.status.toUpperCase()}: ${change.file}`;
    console.log(line);
  }
}
