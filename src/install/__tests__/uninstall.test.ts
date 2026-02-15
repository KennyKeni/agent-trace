import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseUninstallArgs,
  printUninstallSummary,
  UninstallError,
  uninstall,
} from "../uninstall";
import { getPackageName } from "../utils";

const PKG = getPackageName();

function writeCursorHooks(root: string): void {
  const dir = join(root, ".cursor");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "hooks.json"),
    JSON.stringify({
      hooks: {
        afterFileEdit: [{ command: `bunx ${PKG} hook --provider cursor` }],
        afterShellExecution: [
          { command: `bunx ${PKG} hook --provider cursor` },
        ],
      },
    }),
  );
}

function writeClaudeSettings(root: string): void {
  const dir = join(root, ".claude");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "settings.json"),
    JSON.stringify({
      hooks: {
        PostToolUse: [
          {
            matcher: "",
            hooks: [
              {
                type: "command",
                command: `bunx ${PKG} hook --provider claude`,
              },
            ],
          },
        ],
      },
    }),
  );
}

function writeOpenCodePlugin(root: string): void {
  const dir = join(root, ".opencode", "plugins");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "agent-trace.ts"), "// plugin");
}

function writeConfig(root: string): void {
  const dir = join(root, ".agent-trace");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify({ version: "1.0.0" }));
}

describe("parseUninstallArgs", () => {
  let prevRoot: string | undefined;

  beforeEach(() => {
    prevRoot = process.env.AGENT_TRACE_WORKSPACE_ROOT;
    process.env.AGENT_TRACE_WORKSPACE_ROOT = "/tmp/test-root";
  });

  afterEach(() => {
    if (prevRoot !== undefined) {
      process.env.AGENT_TRACE_WORKSPACE_ROOT = prevRoot;
    } else {
      delete process.env.AGENT_TRACE_WORKSPACE_ROOT;
    }
  });

  test("no flags defaults to all providers", () => {
    const opts = parseUninstallArgs([]);
    expect(opts.providers).toEqual(["cursor", "claude", "opencode"]);
    expect(opts.providersSpecified).toBe(false);
    expect(opts.dryRun).toBe(false);
    expect(opts.purge).toBe(false);
    expect(opts.targetRoots).toEqual(["/tmp/test-root"]);
  });

  test("--providers cursor,claude parses to specified subset", () => {
    const opts = parseUninstallArgs(["--providers", "cursor,claude"]);
    expect(opts.providers).toEqual(["cursor", "claude"]);
    expect(opts.providersSpecified).toBe(true);
  });

  test("--providers normalizes case", () => {
    const opts = parseUninstallArgs(["--providers", "Cursor,CLAUDE"]);
    expect(opts.providers).toEqual(["cursor", "claude"]);
    expect(opts.providersSpecified).toBe(true);
  });

  test("--providers with invalid value throws UninstallError", () => {
    expect(() => parseUninstallArgs(["--providers", "invalid"])).toThrow(
      UninstallError,
    );
  });

  test("--target-root deduplicates", () => {
    const opts = parseUninstallArgs([
      "--target-root",
      "/tmp/a",
      "--target-root",
      "/tmp/a",
    ]);
    expect(opts.targetRoots).toHaveLength(1);
  });

  test("--dry-run and --purge flags parsed", () => {
    const opts = parseUninstallArgs(["--dry-run", "--purge"]);
    expect(opts.dryRun).toBe(true);
    expect(opts.purge).toBe(true);
  });

  test("unknown flag throws UninstallError", () => {
    expect(() => parseUninstallArgs(["--unknown-flag"])).toThrow(
      UninstallError,
    );
  });
});

describe("uninstall", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-trace-uninstall-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("with cursor provider removes cursor hooks", () => {
    writeCursorHooks(tmpDir);

    const changes = uninstall({
      providers: ["cursor"],
      providersSpecified: true,
      purge: false,
      dryRun: false,
      targetRoots: [tmpDir],
    });

    const cursorChange = changes.find((c) => c.file.includes(".cursor"));
    expect(cursorChange).toBeDefined();
    expect(cursorChange?.status).toBe("updated");

    const content = JSON.parse(
      readFileSync(join(tmpDir, ".cursor", "hooks.json"), "utf-8"),
    );
    expect(content.hooks).toBeUndefined();
  });

  test("with all providers calls all three uninstallers and each has a change", () => {
    writeCursorHooks(tmpDir);
    writeClaudeSettings(tmpDir);
    writeOpenCodePlugin(tmpDir);

    const changes = uninstall({
      providers: ["cursor", "claude", "opencode"],
      providersSpecified: true,
      purge: false,
      dryRun: false,
      targetRoots: [tmpDir],
    });

    const cursorChange = changes.find((c) => c.file.includes(".cursor"));
    const claudeChange = changes.find((c) => c.file.includes(".claude"));
    const opencodeChange = changes.find((c) => c.file.includes(".opencode"));
    expect(cursorChange).toBeDefined();
    expect(claudeChange).toBeDefined();
    expect(opencodeChange).toBeDefined();
    expect(cursorChange?.status).not.toBe("unchanged");
    expect(claudeChange?.status).not.toBe("unchanged");
    expect(opencodeChange?.status).toBe("removed");
  });

  test("providersSpecified=false also calls uninstallConfig", () => {
    writeConfig(tmpDir);

    const changes = uninstall({
      providers: ["cursor", "claude", "opencode"],
      providersSpecified: false,
      purge: false,
      dryRun: false,
      targetRoots: [tmpDir],
    });

    const configChange = changes.find((c) => c.file.includes("config.json"));
    expect(configChange).toBeDefined();
    expect(configChange?.status).toBe("removed");
  });

  test("providersSpecified=true + purge=true calls uninstallConfig and removes directory", () => {
    writeConfig(tmpDir);

    const changes = uninstall({
      providers: ["cursor"],
      providersSpecified: true,
      purge: true,
      dryRun: false,
      targetRoots: [tmpDir],
    });

    const configChange = changes.find((c) => c.file.includes(".agent-trace"));
    expect(configChange).toBeDefined();
    expect(configChange?.status).toBe("removed");
    expect(existsSync(join(tmpDir, ".agent-trace"))).toBe(false);
  });

  test("providersSpecified=true + purge=false does NOT call uninstallConfig", () => {
    writeConfig(tmpDir);

    const changes = uninstall({
      providers: ["cursor"],
      providersSpecified: true,
      purge: false,
      dryRun: false,
      targetRoots: [tmpDir],
    });

    const configChange = changes.find((c) => c.file.includes("config.json"));
    expect(configChange).toBeUndefined();
    expect(existsSync(join(tmpDir, ".agent-trace", "config.json"))).toBe(true);
  });

  test("multiple target roots processes each", () => {
    const root2 = mkdtempSync(join(tmpdir(), "agent-trace-uninstall2-"));
    try {
      writeCursorHooks(tmpDir);
      writeCursorHooks(root2);

      const changes = uninstall({
        providers: ["cursor"],
        providersSpecified: true,
        purge: false,
        dryRun: false,
        targetRoots: [tmpDir, root2],
      });

      const cursorChanges = changes.filter((c) => c.file.includes(".cursor"));
      expect(cursorChanges).toHaveLength(2);
    } finally {
      rmSync(root2, { recursive: true, force: true });
    }
  });

  test("dry-run does not modify files", () => {
    writeCursorHooks(tmpDir);
    const before = readFileSync(join(tmpDir, ".cursor", "hooks.json"), "utf-8");

    uninstall({
      providers: ["cursor"],
      providersSpecified: true,
      purge: false,
      dryRun: true,
      targetRoots: [tmpDir],
    });

    const after = readFileSync(join(tmpDir, ".cursor", "hooks.json"), "utf-8");
    expect(after).toBe(before);
  });

  test("missing provider files return unchanged status with 'not found' note", () => {
    const changes = uninstall({
      providers: ["cursor", "claude", "opencode"],
      providersSpecified: true,
      purge: false,
      dryRun: false,
      targetRoots: [tmpDir],
    });

    expect(changes).toHaveLength(3);
    for (const change of changes) {
      expect(change.status).toBe("unchanged");
      expect(change.note).toBe("not found");
    }
  });

  test("malformed cursor hooks.json returns skipped status", () => {
    mkdirSync(join(tmpDir, ".cursor"), { recursive: true });
    writeFileSync(join(tmpDir, ".cursor", "hooks.json"), "not json{{{");

    const changes = uninstall({
      providers: ["cursor"],
      providersSpecified: true,
      purge: false,
      dryRun: false,
      targetRoots: [tmpDir],
    });

    const cursorChange = changes.find((c) => c.file.includes(".cursor"));
    expect(cursorChange?.status).toBe("skipped");
    expect(cursorChange?.note).toBe("malformed config");
  });

  test("malformed claude settings.json returns skipped status", () => {
    mkdirSync(join(tmpDir, ".claude"), { recursive: true });
    writeFileSync(join(tmpDir, ".claude", "settings.json"), "not json{{{");

    const changes = uninstall({
      providers: ["claude"],
      providersSpecified: true,
      purge: false,
      dryRun: false,
      targetRoots: [tmpDir],
    });

    const claudeChange = changes.find((c) => c.file.includes(".claude"));
    expect(claudeChange?.status).toBe("skipped");
    expect(claudeChange?.note).toBe("malformed config");
  });

  test("hooks exist but no agent-trace entries returns unchanged", () => {
    mkdirSync(join(tmpDir, ".cursor"), { recursive: true });
    writeFileSync(
      join(tmpDir, ".cursor", "hooks.json"),
      JSON.stringify({
        hooks: {
          afterFileEdit: [{ command: "some-other-tool hook" }],
        },
      }),
    );

    const changes = uninstall({
      providers: ["cursor"],
      providersSpecified: true,
      purge: false,
      dryRun: false,
      targetRoots: [tmpDir],
    });

    const cursorChange = changes.find((c) => c.file.includes(".cursor"));
    expect(cursorChange?.status).toBe("unchanged");
    // Original file preserved
    const content = JSON.parse(
      readFileSync(join(tmpDir, ".cursor", "hooks.json"), "utf-8"),
    );
    expect(content.hooks.afterFileEdit).toHaveLength(1);
    expect(content.hooks.afterFileEdit[0].command).toBe("some-other-tool hook");
  });

  test("opencode dry-run preserves plugin file", () => {
    writeOpenCodePlugin(tmpDir);
    const before = readFileSync(
      join(tmpDir, ".opencode", "plugins", "agent-trace.ts"),
      "utf-8",
    );

    uninstall({
      providers: ["opencode"],
      providersSpecified: true,
      purge: false,
      dryRun: true,
      targetRoots: [tmpDir],
    });

    const after = readFileSync(
      join(tmpDir, ".opencode", "plugins", "agent-trace.ts"),
      "utf-8",
    );
    expect(after).toBe(before);
  });

  test("opencode non-dry-run deletes plugin file", () => {
    writeOpenCodePlugin(tmpDir);

    const changes = uninstall({
      providers: ["opencode"],
      providersSpecified: true,
      purge: false,
      dryRun: false,
      targetRoots: [tmpDir],
    });

    const opcChange = changes.find((c) => c.file.includes(".opencode"));
    expect(opcChange?.status).toBe("removed");
    expect(
      existsSync(join(tmpDir, ".opencode", "plugins", "agent-trace.ts")),
    ).toBe(false);
  });
});

describe("printUninstallSummary", () => {
  test("empty changes prints nothing-to-uninstall message", () => {
    const spy = spyOn(console, "log").mockImplementation(() => {});
    printUninstallSummary([]);
    expect(spy).toHaveBeenCalledWith("Nothing to uninstall.");
    spy.mockRestore();
  });

  test("changes with notes format correctly", () => {
    const spy = spyOn(console, "log").mockImplementation(() => {});
    printUninstallSummary([
      {
        file: ".cursor/hooks.json",
        status: "removed",
        note: "agent-trace hooks",
      },
    ]);
    expect(spy).toHaveBeenCalledWith(
      "REMOVED: .cursor/hooks.json (agent-trace hooks)",
    );
    spy.mockRestore();
  });

  test("changes without notes format correctly", () => {
    const spy = spyOn(console, "log").mockImplementation(() => {});
    printUninstallSummary([
      { file: ".agent-trace/config.json", status: "removed" },
    ]);
    expect(spy).toHaveBeenCalledWith("REMOVED: .agent-trace/config.json");
    spy.mockRestore();
  });
});
