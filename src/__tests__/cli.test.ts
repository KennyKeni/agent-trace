import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getPackageName } from "../install/utils";

const CLI = resolve(import.meta.dir, "../cli.ts");
const PKG = getPackageName();

function run(
  args: string[],
  opts?: { root?: string; stdin?: string },
): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("bun", [CLI, ...args], {
    input: opts?.stdin,
    env: {
      ...process.env,
      AGENT_TRACE_WORKSPACE_ROOT: opts?.root ?? "/tmp/cli-test-fallback",
    },
    timeout: 15_000,
    encoding: "utf-8",
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("CLI command routing", () => {
  test("--version prints version string", () => {
    const { exitCode, stdout } = run(["--version"]);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("-v prints version string", () => {
    const { exitCode, stdout } = run(["-v"]);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("help prints usage text", () => {
    const { exitCode, stdout } = run(["help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("agent-trace");
    expect(stdout).toContain("Commands:");
  });

  test("--help prints usage text", () => {
    const { exitCode, stdout } = run(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Commands:");
  });

  test("-h prints usage text", () => {
    const { exitCode, stdout } = run(["-h"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Commands:");
  });

  test("no command prints help", () => {
    const { exitCode, stdout } = run([]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Commands:");
  });

  test("unknown command prints error and help, exits 1", () => {
    const { exitCode, stderr, stdout } = run(["foobar"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown command: foobar");
    expect(stdout).toContain("Commands:");
  });
});

describe("CLI status command", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-trace-cli-status-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("config without version shows 'not configured'", () => {
    mkdirSync(join(tmpDir, ".agent-trace"), { recursive: true });
    writeFileSync(join(tmpDir, ".agent-trace", "config.json"), "{}");

    const { exitCode, stdout } = run(["status"], { root: tmpDir });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("not configured");
  });

  test("config with matching version shows 'up to date'", () => {
    const { stdout: versionOut } = run(["--version"]);
    const cliVersion = versionOut.trim();

    mkdirSync(join(tmpDir, ".agent-trace"), { recursive: true });
    writeFileSync(
      join(tmpDir, ".agent-trace", "config.json"),
      JSON.stringify({ version: cliVersion }),
    );

    const { exitCode, stdout } = run(["status"], { root: tmpDir });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("up to date");
  });

  test("config with old version shows 'outdated'", () => {
    mkdirSync(join(tmpDir, ".agent-trace"), { recursive: true });
    writeFileSync(
      join(tmpDir, ".agent-trace", "config.json"),
      JSON.stringify({ version: "0.0.1" }),
    );

    const { exitCode, stdout } = run(["status"], { root: tmpDir });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("outdated");
  });

  test("config with 'latest' shows 'latest (unpinned)'", () => {
    mkdirSync(join(tmpDir, ".agent-trace"), { recursive: true });
    writeFileSync(
      join(tmpDir, ".agent-trace", "config.json"),
      JSON.stringify({ version: "latest" }),
    );

    const { exitCode, stdout } = run(["status"], { root: tmpDir });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("latest (unpinned)");
  });

  test("cursor provider hooks present shows installed", () => {
    mkdirSync(join(tmpDir, ".agent-trace"), { recursive: true });
    writeFileSync(join(tmpDir, ".agent-trace", "config.json"), "{}");

    mkdirSync(join(tmpDir, ".cursor"), { recursive: true });
    writeFileSync(
      join(tmpDir, ".cursor", "hooks.json"),
      "agent-trace hook --provider cursor",
    );

    const { exitCode, stdout } = run(["status"], { root: tmpDir });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Cursor:     installed");
  });

  test("claude provider hooks present shows installed", () => {
    mkdirSync(join(tmpDir, ".agent-trace"), { recursive: true });
    writeFileSync(join(tmpDir, ".agent-trace", "config.json"), "{}");

    mkdirSync(join(tmpDir, ".claude"), { recursive: true });
    writeFileSync(
      join(tmpDir, ".claude", "settings.json"),
      `bunx ${PKG} hook --provider claude`,
    );

    const { exitCode, stdout } = run(["status"], { root: tmpDir });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Claude:     installed");
  });

  test("opencode provider plugin present shows installed", () => {
    mkdirSync(join(tmpDir, ".agent-trace"), { recursive: true });
    writeFileSync(join(tmpDir, ".agent-trace", "config.json"), "{}");

    mkdirSync(join(tmpDir, ".opencode", "plugins"), { recursive: true });
    writeFileSync(
      join(tmpDir, ".opencode", "plugins", "agent-trace.ts"),
      "// agent-trace plugin",
    );

    const { exitCode, stdout } = run(["status"], { root: tmpDir });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("OpenCode:   installed");
  });

  test("missing provider hook files show not installed", () => {
    mkdirSync(join(tmpDir, ".agent-trace"), { recursive: true });
    writeFileSync(join(tmpDir, ".agent-trace", "config.json"), "{}");

    const { exitCode, stdout } = run(["status"], { root: tmpDir });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Cursor:     not installed");
    expect(stdout).toContain("Claude:     not installed");
    expect(stdout).toContain("OpenCode:   not installed");
  });

  test("traces.jsonl present shows 'Traces: present'", () => {
    mkdirSync(join(tmpDir, ".agent-trace"), { recursive: true });
    writeFileSync(join(tmpDir, ".agent-trace", "config.json"), "{}");
    writeFileSync(join(tmpDir, ".agent-trace", "traces.jsonl"), "{}\n");

    const { exitCode, stdout } = run(["status"], { root: tmpDir });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Traces:     present");
  });

  test("no traces.jsonl shows 'Traces: none'", () => {
    mkdirSync(join(tmpDir, ".agent-trace"), { recursive: true });
    writeFileSync(join(tmpDir, ".agent-trace", "config.json"), "{}");

    const { exitCode, stdout } = run(["status"], { root: tmpDir });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Traces:     none");
  });

  test("hook file with wrong content shows not installed", () => {
    mkdirSync(join(tmpDir, ".agent-trace"), { recursive: true });
    writeFileSync(join(tmpDir, ".agent-trace", "config.json"), "{}");

    mkdirSync(join(tmpDir, ".cursor"), { recursive: true });
    writeFileSync(
      join(tmpDir, ".cursor", "hooks.json"),
      "some-other-tool hook --provider cursor",
    );

    const { exitCode, stdout } = run(["status"], { root: tmpDir });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Cursor:     not installed");
  });
});

describe("CLI hook command", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-trace-cli-hook-"));
    mkdirSync(join(tmpDir, ".agent-trace"), { recursive: true });
    writeFileSync(join(tmpDir, ".agent-trace", "config.json"), "{}");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("missing --provider flag exits 1", () => {
    const { exitCode, stderr } = run(["hook"], {
      root: tmpDir,
      stdin: JSON.stringify({ hook_event_name: "test" }),
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Missing --provider");
  });

  test("--provider=cursor inline form works", () => {
    const { exitCode } = run(["hook", "--provider=cursor"], {
      root: tmpDir,
      stdin: JSON.stringify({
        hook_event_name: "afterFileEdit",
        file_path: join(tmpDir, "test.ts"),
        edits: [{ old_string: "a", new_string: "b" }],
        session_id: "s1",
      }),
    });
    expect(exitCode).toBe(0);
  });

  test("--provider claude split form with valid stdin exits 0", () => {
    const { exitCode } = run(["hook", "--provider", "claude"], {
      root: tmpDir,
      stdin: JSON.stringify({
        hook_event_name: "PostToolUse",
        tool_name: "Write",
        tool_input: {
          file_path: join(tmpDir, "test.ts"),
          content: "hello",
        },
        session_id: "s1",
      }),
    });
    expect(exitCode).toBe(0);
  });

  test("empty stdin exits 0", () => {
    const { exitCode } = run(["hook", "--provider", "claude"], {
      root: tmpDir,
      stdin: "",
    });
    expect(exitCode).toBe(0);
  });
});

describe("CLI init command (non-interactive)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-trace-cli-init-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("--dry-run does not create provider files and exits 0", () => {
    const { exitCode, stdout } = run(
      ["init", "--providers", "cursor", "--target-root", tmpDir, "--dry-run"],
      { root: tmpDir },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Targets:");
    expect(existsSync(join(tmpDir, ".cursor", "hooks.json"))).toBe(false);
  });

  test("invalid provider exits 1", () => {
    const { exitCode, stderr } = run(
      ["init", "--providers", "invalid", "--target-root", tmpDir],
      { root: tmpDir },
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid");
  });
});

describe("CLI uninstall command (non-interactive)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-trace-cli-uninst-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("--dry-run with --providers previews", () => {
    const { exitCode } = run(
      [
        "uninstall",
        "--providers",
        "cursor",
        "--target-root",
        tmpDir,
        "--dry-run",
      ],
      { root: tmpDir },
    );
    expect(exitCode).toBe(0);
  });

  test("invalid provider exits 1", () => {
    const { exitCode, stderr } = run(
      ["uninstall", "--providers", "invalid", "--target-root", tmpDir],
      { root: tmpDir },
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid");
  });
});
