import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerProvider } from "../registry";
import {
  claudeEdit,
  cleanupSnapshotState,
  createTempGitRepo,
  initAgentTrace,
  initRegistries,
  readArtifact,
  readTraces,
  runInProcess,
} from "./helpers";

beforeAll(() => {
  initRegistries();
});

describe("processHookInput", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-trace-pipeline-"));
    initAgentTrace(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("unknown provider throws with registered provider list", async () => {
    await expect(
      runInProcess("nonexistent", { hook_event_name: "test" }, tmpDir),
    ).rejects.toThrow(/Unknown provider "nonexistent".*Registered providers:/);
  });

  test("isInitialized=false returns zero counts", async () => {
    const noConfigDir = mkdtempSync(join(tmpdir(), "agent-trace-no-init-"));
    try {
      const result = await runInProcess(
        "claude",
        claudeEdit(join(noConfigDir, "f.ts"), "a", "b"),
        noConfigDir,
      );
      expect(result.preHandled).toBe(false);
      expect(result.adapterEventCount).toBe(0);
      expect(result.snapshotEventCount).toBe(0);
    } finally {
      rmSync(noConfigDir, { recursive: true, force: true });
    }
  });

  test("adapter returning undefined yields zero adapter events", async () => {
    const result = await runInProcess(
      "claude",
      { hook_event_name: "PreToolUse", tool_name: "Read", session_id: "s1" },
      tmpDir,
    );
    expect(result.adapterEventCount).toBe(0);
  });
});

describe("env var cleanup", () => {
  test("AGENT_TRACE_WORKSPACE_ROOT and AGENT_TRACE_PROVIDER restored after successful call", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "agent-trace-env-"));
    initAgentTrace(tmpDir);

    const prevRoot = process.env.AGENT_TRACE_WORKSPACE_ROOT;
    const prevProvider = process.env.AGENT_TRACE_PROVIDER;
    process.env.AGENT_TRACE_WORKSPACE_ROOT = "/original/root";
    process.env.AGENT_TRACE_PROVIDER = "/original/provider";

    try {
      await runInProcess(
        "claude",
        claudeEdit(join(tmpDir, "f.ts"), "a", "b"),
        tmpDir,
      );
      expect(process.env.AGENT_TRACE_WORKSPACE_ROOT).toBe("/original/root");
      expect(process.env.AGENT_TRACE_PROVIDER).toBe("/original/provider");
    } finally {
      if (prevRoot !== undefined) {
        process.env.AGENT_TRACE_WORKSPACE_ROOT = prevRoot;
      } else {
        delete process.env.AGENT_TRACE_WORKSPACE_ROOT;
      }
      if (prevProvider !== undefined) {
        process.env.AGENT_TRACE_PROVIDER = prevProvider;
      } else {
        delete process.env.AGENT_TRACE_PROVIDER;
      }
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("env vars restored after error inside try block", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "agent-trace-env-err-"));
    initAgentTrace(tmpDir);

    // Register a provider whose adapt() throws
    registerProvider("throwing-adapter", {
      adapt() {
        throw new Error("adapter exploded");
      },
      sessionIdFor() {
        return "sess";
      },
    });

    const prevRoot = process.env.AGENT_TRACE_WORKSPACE_ROOT;
    const prevProvider = process.env.AGENT_TRACE_PROVIDER;
    process.env.AGENT_TRACE_WORKSPACE_ROOT = "/before-error";
    process.env.AGENT_TRACE_PROVIDER = "/before-error-provider";

    try {
      await expect(
        runInProcess(
          "throwing-adapter",
          { hook_event_name: "PostToolUse" },
          tmpDir,
        ),
      ).rejects.toThrow("adapter exploded");

      expect(process.env.AGENT_TRACE_WORKSPACE_ROOT).toBe("/before-error");
      expect(process.env.AGENT_TRACE_PROVIDER).toBe("/before-error-provider");
    } finally {
      if (prevRoot !== undefined) {
        process.env.AGENT_TRACE_WORKSPACE_ROOT = prevRoot;
      } else {
        delete process.env.AGENT_TRACE_WORKSPACE_ROOT;
      }
      if (prevProvider !== undefined) {
        process.env.AGENT_TRACE_PROVIDER = prevProvider;
      } else {
        delete process.env.AGENT_TRACE_PROVIDER;
      }
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("raw capture", () => {
  let tmpDir: string;
  let errSpy: ReturnType<typeof spyOn> | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-trace-rawcap-"));
    initAgentTrace(tmpDir);
  });

  afterEach(() => {
    errSpy?.mockRestore();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("disabled by default: no raw artifact", async () => {
    await runInProcess(
      "claude",
      claudeEdit(join(tmpDir, "f.ts"), "a", "b", { session_id: "raw-off" }),
      tmpDir,
    );

    const raw = readArtifact(tmpDir, "raw", "claude", "raw-off");
    expect(raw).toBeUndefined();
  });

  test("enabled + unfiltered: raw event written", async () => {
    writeFileSync(
      join(tmpDir, ".agent-trace", "config.json"),
      JSON.stringify({ rawCapture: true }),
    );

    await runInProcess(
      "claude",
      claudeEdit(join(tmpDir, "f.ts"), "a", "b", { session_id: "raw-on" }),
      tmpDir,
    );

    const raw = readArtifact(tmpDir, "raw", "claude", "raw-on");
    expect(raw).toBeDefined();
    expect(raw).toHaveLength(1);
    expect((raw as any[])[0].event.hook_event_name).toBe("PostToolUse");
  });

  test("enabled + filtered (sensitive path) + redact: scrubbed raw written", async () => {
    writeFileSync(
      join(tmpDir, ".agent-trace", "config.json"),
      JSON.stringify({
        rawCapture: true,
        ignoreMode: "redact",
      }),
    );

    await runInProcess(
      "claude",
      claudeEdit(join(tmpDir, ".env"), "SECRET=a", "SECRET=b", {
        session_id: "raw-redact",
      }),
      tmpDir,
    );

    const raw = readArtifact(tmpDir, "raw", "claude", "raw-redact");
    expect(raw).toBeDefined();
    expect(raw).toHaveLength(1);
    const entry = (raw as any[])[0];
    expect(JSON.stringify(entry.event)).not.toContain("SECRET=a");
    expect(JSON.stringify(entry.event)).not.toContain("SECRET=b");
  });

  test("enabled + filtered + skip: no raw written", async () => {
    writeFileSync(
      join(tmpDir, ".agent-trace", "config.json"),
      JSON.stringify({
        rawCapture: true,
        ignoreMode: "skip",
      }),
    );

    await runInProcess(
      "claude",
      claudeEdit(join(tmpDir, ".env"), "SECRET=a", "SECRET=b", {
        session_id: "raw-skip",
      }),
      tmpDir,
    );

    const raw = readArtifact(tmpDir, "raw", "claude", "raw-skip");
    expect(raw).toBeUndefined();
  });

  test("raw capture exception logged and pipeline continues", async () => {
    writeFileSync(
      join(tmpDir, ".agent-trace", "config.json"),
      JSON.stringify({ rawCapture: true }),
    );

    const rawDir = join(tmpDir, ".agent-trace", "raw");
    mkdirSync(rawDir, { recursive: true });
    // Create a file where a directory is expected to force an I/O error
    writeFileSync(join(rawDir, "claude"), "block");

    errSpy = spyOn(console, "error").mockImplementation(() => {});

    const result = await runInProcess(
      "claude",
      claudeEdit(join(tmpDir, "f.ts"), "a", "b", {
        session_id: "raw-err",
      }),
      tmpDir,
    );

    expect(
      errSpy.mock.calls.some((c: unknown[]) =>
        String(c[0]).includes("Raw capture failed"),
      ),
    ).toBe(true);
    expect(result.adapterEventCount).toBe(1);
  });
});

describe("deleted paths filtering", () => {
  let gitDir: string;

  beforeEach(() => {
    gitDir = createTempGitRepo();
  });

  afterEach(() => {
    cleanupSnapshotState(gitDir);
    rmSync(gitDir, { recursive: true, force: true });
  });

  test("ignored path in redact mode replaced with <redacted>", async () => {
    writeFileSync(
      join(gitDir, ".agent-trace", "config.json"),
      JSON.stringify({ ignoreMode: "redact" }),
    );

    const envFile = join(gitDir, ".env");
    writeFileSync(envFile, "SECRET=abc\n");

    const { execGit } = await import("./helpers");
    execGit(["add", "-A"], gitDir);
    execGit(["commit", "-m", "add env"], gitDir);

    rmSync(envFile);

    await runInProcess(
      "claude",
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        session_id: "del-redact",
        model: "claude-sonnet-4-5-20250929",
        tool_use_id: "tu-del-1",
      },
      gitDir,
    );

    await runInProcess(
      "claude",
      {
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "rm .env" },
        session_id: "del-redact",
        model: "claude-sonnet-4-5-20250929",
        tool_use_id: "tu-del-2",
      },
      gitDir,
    );

    const traces = readTraces(gitDir);
    const shellTrace = traces.find(
      (t) => t.files?.[0]?.path === ".shell-history",
    );
    expect(shellTrace).toBeDefined();
    const deletedPaths = shellTrace?.metadata?.[
      "dev.agent-trace.deleted_paths"
    ] as string[] | undefined;
    if (deletedPaths) {
      expect(deletedPaths).toContain("<redacted>");
      expect(deletedPaths).not.toContain(".env");
    }
  });
});

describe("adapter event dispatch", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-trace-dispatch-p-"));
    initAgentTrace(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("adapter returning single event dispatches it", async () => {
    const result = await runInProcess(
      "claude",
      claudeEdit(join(tmpDir, "f.ts"), "a", "b", { session_id: "single" }),
      tmpDir,
    );
    expect(result.adapterEventCount).toBe(1);
    const traces = readTraces(tmpDir);
    expect(traces).toHaveLength(1);
  });

  test("session_start event dispatched", async () => {
    const result = await runInProcess(
      "claude",
      {
        hook_event_name: "SessionStart",
        session_id: "sess-start",
        model: "claude-sonnet-4-5-20250929",
      },
      tmpDir,
    );
    expect(result.adapterEventCount).toBe(1);
    const traces = readTraces(tmpDir);
    expect(traces).toHaveLength(1);
    expect(traces[0].files[0].path).toBe(".sessions");
    expect(traces[0].metadata.event).toBe("session_start");
  });
});
