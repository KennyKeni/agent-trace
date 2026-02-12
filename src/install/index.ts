import { installClaude } from "./claude";
import { installCodex } from "./codex";
import { installConfig } from "./config";
import { installCursor } from "./cursor";
import { installOpenCode } from "./opencode";
import type { ChangeSummary, InstallOptions } from "./types";

export { InstallError, parseArgs } from "./args";
export type { ChangeSummary, InstallOptions } from "./types";

export function install(options: InstallOptions): ChangeSummary[] {
  const changes: ChangeSummary[] = [];

  if (options.providers.includes("codex")) {
    changes.push(installCodex(options.dryRun, options.pinVersion));
  }

  for (const targetRoot of options.targetRoots) {
    changes.push(installConfig(targetRoot, options.dryRun));

    if (options.providers.includes("cursor")) {
      changes.push(
        installCursor(targetRoot, options.dryRun, options.pinVersion),
      );
    }
    if (options.providers.includes("claude")) {
      changes.push(
        installClaude(targetRoot, options.dryRun, options.pinVersion),
      );
    }
    if (options.providers.includes("opencode")) {
      changes.push(
        installOpenCode(targetRoot, options.dryRun, options.pinVersion),
      );
    }
  }

  return changes;
}

export function printInstallSummary(
  changes: ChangeSummary[],
  targetRoots: string[],
): void {
  const summary = changes
    .map((change) =>
      change.note
        ? `${change.status.toUpperCase()}: ${change.file} (${change.note})`
        : `${change.status.toUpperCase()}: ${change.file}`,
    )
    .join("\n");

  console.log(summary);
  console.log("\nTargets:");
  for (const target of targetRoots) console.log(`  ${target}`);
  console.log("\nTrace output: .agent-trace/");
}
