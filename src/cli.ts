#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runHook } from "./core/trace-hook";
import "./extensions";
import "./providers";
import { getWorkspaceRoot } from "./core/trace-store";
import {
  InstallError,
  install,
  parseArgs,
  printInstallSummary,
} from "./install";
import { getPackageVersion } from "./install/utils";

function printHelp(): void {
  console.log(`agent-trace - AI code attribution tracker

Usage:
  agent-trace <command> [options]

Commands:
  init       Initialize hooks for Cursor, Claude Code, OpenCode, and Codex
  hook       Run the trace hook (reads JSON from stdin)
  codex      Codex subcommands (notify, ingest, exec)
  status     Show installed hook status
  help       Show this help message

Init options:
  --providers <list>   Comma-separated providers (cursor,claude,opencode,codex) [default: all]
  --target-root <dir>  Target project root [default: current directory]
  --dry-run            Preview changes without writing
  --latest             Use latest version instead of pinning to current

Codex subcommands:
  codex notify '<json>'   Handle Codex notify callback
  codex ingest            Read Codex JSONL from stdin
  codex exec [args...]    Wrap codex exec --json with tracing

Examples:
  agent-trace init
  agent-trace init --providers cursor
  agent-trace init --providers codex
  agent-trace init --target-root ~/my-project
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

function status(): void {
  const root = getWorkspaceRoot();

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

  console.log(`Workspace: ${root}\n`);
  console.log(`Cursor:     ${cursorStatus}`);
  console.log(`Claude:     ${claudeStatus}`);
  console.log(`OpenCode:   ${opencodeStatus}`);
  console.log(`Codex:      ${codexStatus}`);
  console.log(`Traces:     ${hasTraces ? "present" : "none"}`);
}

const command = process.argv[2];

switch (command) {
  case "init": {
    try {
      const options = parseArgs(process.argv.slice(3));
      const changes = install(options);
      printInstallSummary(changes, options.targetRoots);
    } catch (e) {
      if (e instanceof InstallError) {
        console.error(e.message);
        process.exit(1);
      }
      throw e;
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
    status();
    break;
  case "--version":
  case "-v":
    console.log(getPackageVersion());
    break;
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
