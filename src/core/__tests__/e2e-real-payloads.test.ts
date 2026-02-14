// Contract tests: real Claude Code payload shapes don't regress through the pipeline.
// These use fixtures extracted from production sessions — not synthetic stubs.
// They catch issues like missing model on PostToolUse and extra unknown fields.

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claudeBashSession,
  claudeEditSession,
  hydrateEvents,
} from "./fixtures/claude-real-session";
import {
  cleanupSnapshotState,
  createTempGitRepo,
  initAgentTrace,
  initRegistries,
  readTraces,
  runInProcess,
} from "./helpers";

beforeAll(() => {
  initRegistries();
});

describe("real payload contract: edit session", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-trace-real-edit-"));
    const gitDir = join(tmpDir, ".git", "info");
    mkdirSync(gitDir, { recursive: true });
    writeFileSync(
      join(gitDir, "exclude"),
      "# git ls-files --others --exclude-from=.git/info/exclude\n" +
        "# Lines that start with '#' are comments.\n" +
        "# For a project mostly in C, the following would be a good set of\n" +
        "# exclude patterns (uncomment them if you want to use them):\n" +
        "# *.[oa]\n" +
        "# *~\n",
    );
    initAgentTrace(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("full edit session replays without errors and model is only on session_start", async () => {
    const events = hydrateEvents(claudeEditSession, tmpDir);
    for (const event of events) {
      await runInProcess("claude", event, tmpDir);
    }

    const traces = readTraces(tmpDir);
    expect(traces.length).toBeGreaterThanOrEqual(4);

    const sessionStart = traces.find(
      (t: any) => t.metadata?.event === "session_start",
    );
    expect(sessionStart).toBeDefined();
    expect(sessionStart.files[0].conversations[0].contributor.model_id).toBe(
      "anthropic/claude-opus-4-6",
    );
    expect(sessionStart.metadata.source).toBe("startup");

    // Real PostToolUse events have no model field
    const fileEdits = traces.filter(
      (t: any) => t.files?.[0]?.path === ".git/info/exclude",
    );
    expect(fileEdits.length).toBe(2);
    for (const edit of fileEdits) {
      expect(
        edit.files[0].conversations[0].contributor.model_id,
      ).toBeUndefined();
    }
  });
});

describe("real payload contract: bash session", () => {
  let gitDir: string;

  beforeEach(() => {
    gitDir = createTempGitRepo();
  });

  afterEach(() => {
    cleanupSnapshotState(gitDir);
    rmSync(gitDir, { recursive: true, force: true });
  });

  test("bash session with extra fields (description, tool_response.*) replays without errors", async () => {
    const events = hydrateEvents(claudeBashSession, gitDir);
    for (const event of events) {
      await runInProcess("claude", event, gitDir);
    }

    const traces = readTraces(gitDir);
    expect(traces.length).toBeGreaterThanOrEqual(2);

    const shell = traces.find(
      (t: any) => t.files?.[0]?.path === ".shell-history",
    );
    expect(shell).toBeDefined();
    expect(shell.metadata.command).toBe(
      "gh release list --repo openai/codex --limit 5",
    );
    // Real PostToolUse/Bash has no model
    expect(
      shell.files[0].conversations[0].contributor.model_id,
    ).toBeUndefined();
  });
});
