import { resolve } from "node:path";
import { parseArgs as nodeParseArgs } from "node:util";
import { getWorkspaceRoot } from "../core/trace-store";
import { isProvider, PROVIDERS, type Provider } from "../providers/types";
import type { InstallOptions } from "./types";

export class InstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstallError";
  }
}

function normalizePath(path: string): string {
  return resolve(path);
}

function parseProviders(raw?: string): Provider[] {
  if (!raw) return [...PROVIDERS];
  const values = raw
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  const invalid = values.filter((value) => !isProvider(value));
  if (invalid.length > 0) {
    throw new InstallError(
      `Invalid providers: ${invalid.join(", ")}. Valid values: ${PROVIDERS.join(", ")}`,
    );
  }
  return values as Provider[];
}

export function parseArgs(argv: string[]): InstallOptions {
  let values: {
    providers?: string;
    "target-root"?: string[];
    "dry-run"?: boolean;
    latest?: boolean;
  };

  try {
    ({ values } = nodeParseArgs({
      args: argv,
      options: {
        providers: { type: "string" },
        "target-root": { type: "string", multiple: true },
        "dry-run": { type: "boolean" },
        latest: { type: "boolean" },
      },
      strict: true,
    }));
  } catch (err) {
    if (err instanceof TypeError) {
      throw new InstallError(err.message);
    }
    throw err;
  }

  const providers = parseProviders(values.providers);
  const dryRun = values["dry-run"] ?? false;
  const pinVersion = !(values.latest ?? false);

  const targetRoots = values["target-root"]?.map(normalizePath) ?? [];
  if (targetRoots.length === 0) {
    targetRoots.push(getWorkspaceRoot());
  }

  const dedupedTargets = [...new Set(targetRoots.map(normalizePath))];

  return { providers, dryRun, pinVersion, targetRoots: dedupedTargets };
}
