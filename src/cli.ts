#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HookInput } from "./core/types";

function parseProvider(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--provider") {
      return argv[i + 1] ?? undefined;
    }
    if (arg?.startsWith("--provider=")) {
      return arg.slice("--provider=".length) || undefined;
    }
  }
  return undefined;
}

async function runHook() {
  const { registerBuiltinProviders } = await import("./providers");
  const { registerBuiltinExtensions } = await import("./extensions");
  const { registeredProviderNames } = await import("./core/registry");
  const { processHookInput } = await import("./core/pipeline");

  registerBuiltinProviders();
  registerBuiltinExtensions();

  const registered = registeredProviderNames();
  if (registered.length === 0) {
    console.error("No providers registered.");
    process.exit(1);
  }

  const chunks: Buffer[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(Buffer.from(chunk));
  }

  const json = Buffer.concat(chunks).toString("utf-8").trim();
  if (!json) process.exit(0);

  try {
    const providerName = parseProvider(process.argv.slice(2));
    if (!providerName) {
      console.error(
        `Missing --provider flag. Registered providers: ${registered.join(", ")}`,
      );
      process.exit(1);
    }

    const input = JSON.parse(json) as HookInput;
    await processHookInput(providerName, input);
  } catch (e) {
    console.error("Hook error:", e);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`agent-trace - AI code attribution tracker

Usage:
  agent-trace <command> [options]

Commands:
  init        Initialize hooks for Cursor, Claude Code, OpenCode, and Codex
  uninstall   Remove agent-trace hooks from providers
  hook        Run the trace hook (reads JSON from stdin)
  codex       Codex subcommands (notify, ingest)
  status      Show installed hook status
  help        Show this help message

Init options:
  --providers <list>   Comma-separated providers (cursor,claude,opencode,codex) [default: all]
  --target-root <dir>  Target project root [default: current directory]
  --dry-run            Preview changes without writing
  --latest             Use latest version instead of pinning to current

Uninstall options:
  --providers <list>   Comma-separated providers to remove [default: all]
  --target-root <dir>  Target project root [default: current directory]
  --dry-run            Preview changes without removing
  --purge              Also delete .agent-trace/ directory (traces + config)

Codex subcommands:
  codex notify '<json>'   Handle Codex notify callback
  codex ingest            Read Codex JSONL from stdin

Examples:
  agent-trace init
  agent-trace init --providers cursor
  agent-trace uninstall
  agent-trace uninstall --providers cursor --dry-run
  agent-trace uninstall --purge
  agent-trace status`);
}

function checkHookConfig(
  path: string,
  searchString: string,
): "installed" | "not installed" {
  if (!existsSync(path)) return "not installed";
  try {
    const content = readFileSync(path, "utf-8");
    return content.includes(searchString) ? "installed" : "not installed";
  } catch {
    return "not installed";
  }
}

function codexConfigStatus(): "installed" | "not installed" {
  const home = process.env.CODEX_HOME ?? join(homedir(), ".codex");
  const configPath = join(home, "config.toml");
  return checkHookConfig(configPath, "agent-trace");
}

async function status() {
  const { getWorkspaceRoot } = await import("./core/trace-store");
  const { readConfig } = await import("./install/config");
  const { getPackageVersion } = await import("./install/utils");

  const root = getWorkspaceRoot();
  const cliVersion = getPackageVersion();

  const config = readConfig(root);
  const configVersion =
    config && typeof config.version === "string" ? config.version : null;

  let versionLine: string;
  if (!configVersion) {
    versionLine = "not configured";
  } else if (configVersion === "latest") {
    versionLine = "latest (unpinned)";
  } else if (configVersion === cliVersion) {
    versionLine = `v${configVersion} (up to date)`;
  } else {
    versionLine = `v${configVersion} (outdated — current: v${cliVersion})`;
  }

  const cursorPath = join(root, ".cursor", "hooks.json");
  const claudePath = join(root, ".claude", "settings.json");
  const opencodePath = join(root, ".opencode", "plugins", "agent-trace.ts");

  const cursorStatus = checkHookConfig(
    cursorPath,
    "agent-trace hook --provider cursor",
  );
  const claudeStatus = checkHookConfig(
    claudePath,
    "agent-trace hook --provider claude",
  );
  const opencodeStatus = checkHookConfig(opencodePath, "agent-trace");
  const codexStatus = codexConfigStatus();
  const traceDir = join(root, ".agent-trace");
  const hasTraces = existsSync(join(traceDir, "traces.jsonl"));

  console.log(`Workspace:  ${root}`);
  console.log(`Version:    ${versionLine}\n`);
  console.log(`Cursor:     ${cursorStatus}`);
  console.log(`Claude:     ${claudeStatus}`);
  console.log(`OpenCode:   ${opencodeStatus}`);
  console.log(`Codex:      ${codexStatus} (global, always latest)`);
  console.log(`Traces:     ${hasTraces ? "present" : "none"}`);
}

const command = process.argv[2];

switch (command) {
  case "init": {
    const initArgs = process.argv.slice(3);
    if (initArgs.length === 0) {
      const { interactiveInit } = await import("./install/interactive");
      await interactiveInit();
    } else {
      const { registerBuiltinProviders } = await import("./providers");
      const { InstallError, install, parseArgs, printInstallSummary } =
        await import("./install");

      registerBuiltinProviders();

      try {
        const options = parseArgs(initArgs);
        const changes = install(options);
        printInstallSummary(changes, options.targetRoots);
      } catch (e) {
        if (e instanceof InstallError) {
          console.error(e.message);
          process.exit(1);
        }
        throw e;
      }
    }
    break;
  }
  case "uninstall": {
    const uninstallArgs = process.argv.slice(3);
    if (uninstallArgs.length === 0) {
      const { interactiveUninstall } = await import("./install/interactive");
      await interactiveUninstall();
    } else {
      const {
        UninstallError,
        uninstall,
        parseUninstallArgs,
        printUninstallSummary,
      } = await import("./install/uninstall");
      try {
        const options = parseUninstallArgs(uninstallArgs);
        const changes = uninstall(options);
        printUninstallSummary(changes);
      } catch (e) {
        if (e instanceof UninstallError) {
          console.error(e.message);
          process.exit(1);
        }
        throw e;
      }
    }
    break;
  }
  case "hook":
    await runHook();
    break;
  case "codex": {
    const { runCodexSubcommand } = await import("./codex");
    const exitCode = await runCodexSubcommand(process.argv.slice(3));
    process.exit(exitCode);
    break;
  }
  case "status":
    await status();
    break;
  case "--version":
  case "-v": {
    const { getPackageVersion } = await import("./install/utils");
    console.log(getPackageVersion());
    break;
  }
  case "help":
  case "--help":
  case "-h":
  case undefined:
    printHelp();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
}
