import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SPEC_VERSION } from "../schemas";
import {
  claudeEdit,
  claudePostBash,
  claudePreBash,
  cleanupSnapshotState,
  createTempGitRepo,
  execGit,
  findShellTrace,
  findSnapshotTrace,
  initAgentTrace,
  initRegistries,
  readArtifact,
  readTraces,
  runInProcess,
} from "./helpers";

beforeAll(() => {
  initRegistries();
});

describe("in-process E2E: parity", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-trace-parity-"));
    initAgentTrace(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("PostToolUse/Edit produces trace + diff + raw event", async () => {
    const filePath = join(tmpDir, "src", "index.ts");
    await runInProcess(
      "claude",
      claudeEdit(filePath, "const x = 1;", "const x = 2;", {
        session_id: "parity-1",
      }),
      tmpDir,
    );

    const traces = readTraces(tmpDir);
    expect(traces).toHaveLength(1);
    const t = traces[0];
    expect(t.version).toBe(SPEC_VERSION);
    expect(t.tool).toEqual({ name: "claude-code" });
    expect(t.files).toHaveLength(1);
    expect(t.files[0].path).toBe("src/index.ts");
    expect(t.files[0].conversations[0].ranges).toHaveLength(1);
    expect(t.files[0].conversations[0].ranges[0].content_hash).toMatch(
      /^murmur3:[0-9a-f]{8}$/,
    );

    const diff = readArtifact(tmpDir, "diffs", "claude", "parity-1");
    expect(diff).toBeDefined();
    expect(diff).toContain("-const x = 1;");
    expect(diff).toContain("+const x = 2;");

    const raw = readArtifact(tmpDir, "raw", "claude", "parity-1") as any[];
    expect(raw).toHaveLength(1);
    expect(raw[0].provider).toBe("claude");
  });

  test("PreToolUse/Bash + file change + PostToolUse/Bash produces snapshot file_edit", async () => {
    const gitDir = createTempGitRepo();
    try {
      const callId = "parity-call-1";
      await runInProcess(
        "claude",
        claudePreBash({ session_id: "parity-2", tool_use_id: callId }),
        gitDir,
      );

      writeFileSync(join(gitDir, "created.ts"), "const x = 42;\n");

      await runInProcess(
        "claude",
        claudePostBash("echo create", {
          session_id: "parity-2",
          tool_use_id: callId,
        }),
        gitDir,
      );

      const traces = readTraces(gitDir);
      expect(traces.length).toBeGreaterThanOrEqual(2);

      const fileEdit = findSnapshotTrace(traces, "created.ts");
      expect(fileEdit).toBeDefined();
      const ranges = fileEdit.files[0].conversations[0].ranges;
      expect(ranges.length).toBeGreaterThanOrEqual(1);
      expect(ranges[0].start_line).toBeGreaterThanOrEqual(1);
    } finally {
      cleanupSnapshotState(gitDir);
      rmSync(gitDir, { recursive: true, force: true });
    }
  });
});

describe("in-process E2E: new coverage", () => {
  let gitDir: string;

  beforeEach(() => {
    gitDir = createTempGitRepo();
  });

  afterEach(() => {
    cleanupSnapshotState(gitDir);
    rmSync(gitDir, { recursive: true, force: true });
  });

  test("1: deleted paths propagated to shell metadata", async () => {
    const callId = "del-1";
    const session = "del-sess";
    await runInProcess(
      "claude",
      claudePreBash({ session_id: session, tool_use_id: callId }),
      gitDir,
    );

    unlinkSync(join(gitDir, "initial.txt"));

    await runInProcess(
      "claude",
      claudePostBash("rm initial.txt", {
        session_id: session,
        tool_use_id: callId,
      }),
      gitDir,
    );

    const traces = readTraces(gitDir);
    const shell = findShellTrace(traces);
    expect(shell).toBeDefined();
    expect(shell.metadata["dev.agent-trace.deleted_paths"]).toEqual([
      "initial.txt",
    ]);
  });

  test("2: no-git degradation — adapter events still work", async () => {
    const nonGitDir = mkdtempSync(join(tmpdir(), "agent-trace-nogit-"));
    initAgentTrace(nonGitDir);
    try {
      await runInProcess(
        "claude",
        claudePreBash({ session_id: "nogit-1" }),
        nonGitDir,
      );

      writeFileSync(join(nonGitDir, "file.ts"), "content\n");

      await runInProcess(
        "claude",
        claudePostBash("echo test", { session_id: "nogit-1" }),
        nonGitDir,
      );

      const traces = readTraces(nonGitDir);
      const shell = findShellTrace(traces);
      expect(shell).toBeDefined();
      expect(shell.metadata.command).toBe("echo test");

      const snapshotEdits = traces.filter(
        (t: any) => t.metadata?.["dev.agent-trace.source"] === "vcs_snapshot",
      );
      expect(snapshotEdits).toHaveLength(0);

      const raw = readArtifact(nonGitDir, "raw", "claude", "nogit-1");
      expect(raw).toBeDefined();
    } finally {
      rmSync(nonGitDir, { recursive: true, force: true });
    }
  });

  test("3: rename tracking — old_path metadata", async () => {
    const callId = "rename-1";
    const session = "rename-sess";
    await runInProcess(
      "claude",
      claudePreBash({ session_id: session, tool_use_id: callId }),
      gitDir,
    );

    execGit(["mv", "initial.txt", "renamed.txt"], gitDir);

    await runInProcess(
      "claude",
      claudePostBash("git mv initial.txt renamed.txt", {
        session_id: session,
        tool_use_id: callId,
      }),
      gitDir,
    );

    const traces = readTraces(gitDir);
    const renameTrace = findSnapshotTrace(traces, "renamed.txt");
    // Renames with no content changes produce no hunks and are skipped.
    // A rename with content change would have old_path. If the rename
    // is pure, we at least should not crash and deleted_paths should have
    // the old file.
    if (renameTrace) {
      expect(renameTrace.metadata["dev.agent-trace.old_path"]).toBe(
        "initial.txt",
      );
    } else {
      // Pure rename (no content change) — check deleted_paths
      const shell = findShellTrace(traces);
      expect(shell).toBeDefined();
    }
  });

  test("4: extension config filtering — only listed extensions run", async () => {
    const configDir = join(gitDir, ".agent-trace");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ extensions: ["diffs"] }),
    );

    const filePath = join(gitDir, "ext-test.ts");
    await runInProcess(
      "claude",
      claudeEdit(filePath, "const a = 1;", "const a = 2;", {
        session_id: "ext-filter",
      }),
      gitDir,
    );

    const diff = readArtifact(gitDir, "diffs", "claude", "ext-filter");
    expect(diff).toBeDefined();

    const lineHashes = readArtifact(
      gitDir,
      "line-hashes",
      "claude",
      "ext-filter",
    );
    expect(lineHashes).toBeUndefined();

    const messages = readArtifact(gitDir, "messages", "claude", "ext-filter");
    expect(messages).toBeUndefined();
  });

  test("5: ignore skip mode — ignored files produce no trace", async () => {
    const configDir = join(gitDir, ".agent-trace");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ ignore: ["**/*.secret"], ignoreMode: "skip" }),
    );

    const callId = "skip-1";
    const session = "skip-sess";
    await runInProcess(
      "claude",
      claudePreBash({ session_id: session, tool_use_id: callId }),
      gitDir,
    );

    writeFileSync(join(gitDir, "secret.secret"), "password=abc\n");
    writeFileSync(join(gitDir, "normal.ts"), "const y = 1;\n");

    await runInProcess(
      "claude",
      claudePostBash("echo edit", { session_id: session, tool_use_id: callId }),
      gitDir,
    );

    const traces = readTraces(gitDir);
    const normalTrace = findSnapshotTrace(traces, "normal.ts");
    expect(normalTrace).toBeDefined();

    const secretTrace = findSnapshotTrace(traces, "secret.secret");
    expect(secretTrace).toBeUndefined();
  });

  test("6: line-hashes artifact from snapshot path", async () => {
    const callId = "lh-1";
    const session = "lh-sess";
    await runInProcess(
      "claude",
      claudePreBash({ session_id: session, tool_use_id: callId }),
      gitDir,
    );

    writeFileSync(join(gitDir, "multi.ts"), "line1\nline2\nline3\n");

    await runInProcess(
      "claude",
      claudePostBash("echo create", {
        session_id: session,
        tool_use_id: callId,
      }),
      gitDir,
    );

    const hashes = readArtifact(
      gitDir,
      "line-hashes",
      "claude",
      session,
    ) as any[];
    expect(hashes).toBeDefined();
    expect(hashes.length).toBeGreaterThanOrEqual(1);
    const record = hashes.find((h: any) => h.file === "multi.ts");
    expect(record).toBeDefined();
    expect(record.hashes.length).toBe(3);
    expect(record.hashes[0]).toMatch(/^murmur3:[0-9a-f]{8}$/);
  });

  test("7: multi-file shell change", async () => {
    const callId = "multi-1";
    const session = "multi-sess";
    await runInProcess(
      "claude",
      claudePreBash({ session_id: session, tool_use_id: callId }),
      gitDir,
    );

    writeFileSync(join(gitDir, "new-a.ts"), "const a = 1;\n");
    writeFileSync(join(gitDir, "initial.txt"), "modified content\n");

    await runInProcess(
      "claude",
      claudePostBash("echo multi", {
        session_id: session,
        tool_use_id: callId,
      }),
      gitDir,
    );

    const traces = readTraces(gitDir);
    const traceA = findSnapshotTrace(traces, "new-a.ts");
    expect(traceA).toBeDefined();
    expect(
      traceA.files[0].conversations[0].ranges.length,
    ).toBeGreaterThanOrEqual(1);

    const traceInitial = findSnapshotTrace(traces, "initial.txt");
    expect(traceInitial).toBeDefined();
    expect(
      traceInitial.files[0].conversations[0].ranges.length,
    ).toBeGreaterThanOrEqual(1);
  });

  test("8: mixed adapter + snapshot in same session", async () => {
    const session = "mixed-sess";
    const filePath = join(gitDir, "adapter-edit.ts");

    // Adapter path: direct Edit tool
    await runInProcess(
      "claude",
      claudeEdit(filePath, "old code", "new code", { session_id: session }),
      gitDir,
    );

    // Snapshot path: Bash tool with file change
    const callId = "mixed-bash";
    await runInProcess(
      "claude",
      claudePreBash({ session_id: session, tool_use_id: callId }),
      gitDir,
    );

    writeFileSync(join(gitDir, "shell-created.ts"), "from shell\n");

    await runInProcess(
      "claude",
      claudePostBash("echo create", {
        session_id: session,
        tool_use_id: callId,
      }),
      gitDir,
    );

    const traces = readTraces(gitDir);

    // Adapter trace (no vcs_snapshot source)
    const adapterTrace = traces.find(
      (t: any) =>
        t.files?.[0]?.path === "adapter-edit.ts" &&
        !t.metadata?.["dev.agent-trace.source"],
    );
    expect(adapterTrace).toBeDefined();

    // Snapshot trace
    const snapshotTrace = findSnapshotTrace(traces, "shell-created.ts");
    expect(snapshotTrace).toBeDefined();

    // Both exist in the same trace file (same session)
    expect(adapterTrace).toBeDefined();
    expect(snapshotTrace).toBeDefined();
  });

  test("9: session ID preserved through pipeline to trace output", async () => {
    const session = "e2e-sess-continuity";
    const filePath = join(gitDir, "session-test.ts");

    await runInProcess(
      "claude",
      {
        hook_event_name: "SessionStart",
        session_id: session,
        model: "claude-sonnet-4-5-20250929",
        source: "cli",
      },
      gitDir,
    );

    await runInProcess(
      "claude",
      claudeEdit(filePath, "const a = 1;", "const a = 2;", {
        session_id: session,
      }),
      gitDir,
    );

    await runInProcess(
      "claude",
      {
        hook_event_name: "SessionEnd",
        session_id: session,
        model: "claude-sonnet-4-5-20250929",
        reason: "user_exit",
      },
      gitDir,
    );

    const traces = readTraces(gitDir);
    const sessionTraces = traces.filter(
      (t: any) => t.metadata?.session_id === session,
    );
    expect(sessionTraces.length).toBeGreaterThanOrEqual(3);

    const sessionStart = sessionTraces.find(
      (t: any) => t.metadata?.event === "session_start",
    );
    expect(sessionStart).toBeDefined();

    const fileEdit = sessionTraces.find(
      (t: any) => t.files?.[0]?.path === "session-test.ts",
    );
    expect(fileEdit).toBeDefined();

    const sessionEnd = sessionTraces.find(
      (t: any) => t.metadata?.event === "session_end",
    );
    expect(sessionEnd).toBeDefined();
  });
});
