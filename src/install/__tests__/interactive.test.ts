import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
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
import { getPackageName, getPackageVersion } from "../utils";

const PKG = getPackageName();
const VERSION = getPackageVersion();

let groupReturn: Record<string, unknown> = {};
let selectReturn: unknown = "cancel";
let confirmReturn: unknown = true;

mock.module("@clack/prompts", () => ({
  intro: () => {},
  outro: () => {},
  cancel: () => {},
  log: { info: () => {}, message: () => {} },
  isCancel: (val: unknown) => typeof val === "symbol",
  group: async () => groupReturn,
  multiselect: async () => groupReturn.providers ?? [],
  select: async () => selectReturn,
  confirm: async () => confirmReturn,
  text: async () => groupReturn.targetRoot ?? "/tmp",
}));

class ExitCalled extends Error {
  code: number;
  constructor(code: number) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

function writeCursorHooks(root: string): void {
  const dir = join(root, ".cursor");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "hooks.json"),
    JSON.stringify({
      hooks: {
        afterFileEdit: [{ command: `bunx ${PKG} hook --provider cursor` }],
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

function writeAgentTraceConfig(
  root: string,
  config: Record<string, unknown> = {},
): void {
  const dir = join(root, ".agent-trace");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify(config));
}

describe("interactiveInit", () => {
  let tmpDir: string;
  let prevRoot: string | undefined;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-trace-interactive-"));
    prevRoot = process.env.AGENT_TRACE_WORKSPACE_ROOT;
    process.env.AGENT_TRACE_WORKSPACE_ROOT = tmpDir;
    exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new ExitCalled(code ?? 0);
    }) as any);

    groupReturn = {};
    selectReturn = "cancel";
    confirmReturn = true;
  });

  afterEach(() => {
    if (prevRoot !== undefined) {
      process.env.AGENT_TRACE_WORKSPACE_ROOT = prevRoot;
    } else {
      delete process.env.AGENT_TRACE_WORKSPACE_ROOT;
    }
    exitSpy.mockRestore();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("fresh install: creates config and provider hooks", async () => {
    groupReturn = {
      providers: ["cursor"],
      extensions: ["diffs"],
      rawCapture: false,
      version: VERSION,
      targetRoot: tmpDir,
      confirm: true,
    };

    const { interactiveInit } = await import("../interactive");
    await interactiveInit();

    expect(existsSync(join(tmpDir, ".cursor", "hooks.json"))).toBe(true);
    expect(existsSync(join(tmpDir, ".agent-trace", "config.json"))).toBe(true);

    const config = JSON.parse(
      readFileSync(join(tmpDir, ".agent-trace", "config.json"), "utf-8"),
    );
    expect(config.version).toBe(VERSION);
    expect(config.extensions).toContain("diffs");
  });

  test("fresh install with confirm=false calls process.exit", async () => {
    groupReturn = {
      providers: ["cursor"],
      extensions: [],
      rawCapture: false,
      version: VERSION,
      targetRoot: tmpDir,
      confirm: false,
    };

    const { interactiveInit } = await import("../interactive");
    try {
      await interactiveInit();
    } catch (e) {
      expect(e).toBeInstanceOf(ExitCalled);
      expect((e as ExitCalled).code).toBe(0);
    }

    expect(exitSpy).toHaveBeenCalled();
  });

  test("existing config + outdated version: upgrade path", async () => {
    writeAgentTraceConfig(tmpDir, { version: "0.0.1" });
    writeCursorHooks(tmpDir);

    selectReturn = "upgrade";
    confirmReturn = true;

    const { interactiveInit } = await import("../interactive");
    await interactiveInit();

    const config = JSON.parse(
      readFileSync(join(tmpDir, ".agent-trace", "config.json"), "utf-8"),
    );
    expect(config.version).toBe(VERSION);
  });

  test("existing config + select cancel: exits", async () => {
    writeAgentTraceConfig(tmpDir, { version: "0.0.1" });
    writeCursorHooks(tmpDir);

    selectReturn = "cancel";

    const { interactiveInit } = await import("../interactive");
    try {
      await interactiveInit();
    } catch (e) {
      expect(e).toBeInstanceOf(ExitCalled);
    }

    expect(exitSpy).toHaveBeenCalled();
  });

  test("existing config + reconfigure: runs fresh install", async () => {
    writeAgentTraceConfig(tmpDir, { version: VERSION });
    writeCursorHooks(tmpDir);

    selectReturn = "reconfigure";
    groupReturn = {
      providers: ["cursor", "claude"],
      extensions: ["diffs", "messages"],
      rawCapture: false,
      version: VERSION,
      targetRoot: tmpDir,
      confirm: true,
    };

    const { interactiveInit } = await import("../interactive");
    await interactiveInit();

    expect(existsSync(join(tmpDir, ".claude", "settings.json"))).toBe(true);
  });
});

describe("interactiveUninstall", () => {
  let tmpDir: string;
  let prevRoot: string | undefined;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-trace-int-uninst-"));
    prevRoot = process.env.AGENT_TRACE_WORKSPACE_ROOT;
    process.env.AGENT_TRACE_WORKSPACE_ROOT = tmpDir;
    exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new ExitCalled(code ?? 0);
    }) as any);

    groupReturn = {};
    selectReturn = "cancel";
    confirmReturn = true;
  });

  afterEach(() => {
    if (prevRoot !== undefined) {
      process.env.AGENT_TRACE_WORKSPACE_ROOT = prevRoot;
    } else {
      delete process.env.AGENT_TRACE_WORKSPACE_ROOT;
    }
    exitSpy.mockRestore();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("no providers installed: early return", async () => {
    const { interactiveUninstall } = await import("../interactive");
    await interactiveUninstall();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("all providers selected: removes hooks", async () => {
    writeCursorHooks(tmpDir);
    writeAgentTraceConfig(tmpDir);

    groupReturn = {
      providers: ["cursor"],
      purge: false,
      confirm: true,
    };

    const { interactiveUninstall } = await import("../interactive");
    await interactiveUninstall();

    const hooksPath = join(tmpDir, ".cursor", "hooks.json");
    expect(existsSync(hooksPath)).toBe(true);
    const content = JSON.parse(readFileSync(hooksPath, "utf-8"));
    expect(content.hooks).toBeUndefined();
  });

  test("confirm=false: calls process.exit", async () => {
    writeCursorHooks(tmpDir);

    groupReturn = {
      providers: ["cursor"],
      purge: false,
      confirm: false,
    };

    const { interactiveUninstall } = await import("../interactive");
    try {
      await interactiveUninstall();
    } catch (e) {
      expect(e).toBeInstanceOf(ExitCalled);
    }

    expect(exitSpy).toHaveBeenCalled();
  });

  test("with .agent-trace dir and purge=true removes directory", async () => {
    writeCursorHooks(tmpDir);
    writeAgentTraceConfig(tmpDir);

    groupReturn = {
      providers: ["cursor"],
      purge: true,
      confirm: true,
    };

    const { interactiveUninstall } = await import("../interactive");
    await interactiveUninstall();

    expect(existsSync(join(tmpDir, ".agent-trace"))).toBe(false);
  });
});

describe("detectInstalledProviders (via interactiveInit)", () => {
  let tmpDir: string;
  let prevRoot: string | undefined;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-trace-detect-"));
    prevRoot = process.env.AGENT_TRACE_WORKSPACE_ROOT;
    process.env.AGENT_TRACE_WORKSPACE_ROOT = tmpDir;
    exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new ExitCalled(code ?? 0);
    }) as any);

    groupReturn = {};
    selectReturn = "cancel";
    confirmReturn = true;
  });

  afterEach(() => {
    if (prevRoot !== undefined) {
      process.env.AGENT_TRACE_WORKSPACE_ROOT = prevRoot;
    } else {
      delete process.env.AGENT_TRACE_WORKSPACE_ROOT;
    }
    exitSpy.mockRestore();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("cursor hooks containing package name detected as installed", async () => {
    writeCursorHooks(tmpDir);
    writeAgentTraceConfig(tmpDir, { version: VERSION });

    selectReturn = "cancel";

    const { interactiveInit } = await import("../interactive");
    try {
      await interactiveInit();
    } catch {
      // Expected exit from cancel
    }

    // existingConfigFlow entered (not freshInstall) since cursor was detected.
    // cancel triggers exit in existingConfigFlow.
    expect(exitSpy).toHaveBeenCalled();
  });

  test("claude settings containing package name detected as installed", async () => {
    writeClaudeSettings(tmpDir);
    writeAgentTraceConfig(tmpDir, { version: VERSION });

    selectReturn = "cancel";

    const { interactiveInit } = await import("../interactive");
    try {
      await interactiveInit();
    } catch {
      // Expected exit from cancel
    }

    // existingConfigFlow entered, not freshInstall
    expect(exitSpy).toHaveBeenCalled();
    expect(existsSync(join(tmpDir, ".cursor", "hooks.json"))).toBe(false);
  });

  test("opencode plugin file detected as installed", async () => {
    writeOpenCodePlugin(tmpDir);
    writeAgentTraceConfig(tmpDir, { version: VERSION });

    selectReturn = "cancel";

    const { interactiveInit } = await import("../interactive");
    try {
      await interactiveInit();
    } catch {
      // Expected exit from cancel
    }

    // existingConfigFlow entered, not freshInstall
    expect(exitSpy).toHaveBeenCalled();
    expect(existsSync(join(tmpDir, ".cursor", "hooks.json"))).toBe(false);
  });

  test("no provider files: triggers fresh install path", async () => {
    groupReturn = {
      providers: ["cursor"],
      extensions: [],
      rawCapture: false,
      version: VERSION,
      targetRoot: tmpDir,
      confirm: true,
    };

    const { interactiveInit } = await import("../interactive");
    await interactiveInit();

    expect(existsSync(join(tmpDir, ".cursor", "hooks.json"))).toBe(true);
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
