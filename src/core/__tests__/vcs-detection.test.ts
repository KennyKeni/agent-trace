import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";

let execResponses: Map<string, string>;

mock.module("node:child_process", () => ({
  execFileSync: (cmd: string, args: string[]) => {
    const key = `${cmd} ${args.join(" ")}`;
    const response = execResponses.get(key);
    if (response === undefined) {
      throw new Error(`Command not found: ${key}`);
    }
    return response;
  },
}));

const { detectVcsContext, getWorkspaceRoot } = await import("../trace-store");

beforeEach(() => {
  execResponses = new Map();
});

const savedEnv: Record<string, string | undefined> = {};

function saveEnv(...keys: string[]) {
  for (const k of keys) savedEnv[k] = process.env[k];
}

function restoreEnv() {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe("detectVcsContext", () => {
  test("detects git repo", () => {
    execResponses.set(
      "git rev-parse --show-toplevel",
      "/home/user/project\n",
    );
    execResponses.set("git rev-parse HEAD", "abc123def\n");

    const ctx = detectVcsContext("/home/user/project");
    expect(ctx.root).toBe("/home/user/project");
    expect(ctx.vcs).toEqual({ type: "git", revision: "abc123def" });
  });

  test("detects jj repo", () => {
    execResponses.set("jj root", "/home/user/project\n");
    execResponses.set(
      "jj log -r @ --no-graph -T change_id",
      "kkmpptxn1234\n",
    );

    const ctx = detectVcsContext("/home/user/project");
    expect(ctx.root).toBe("/home/user/project");
    expect(ctx.vcs).toEqual({ type: "jj", revision: "kkmpptxn1234" });
  });

  test("detects hg repo", () => {
    execResponses.set("hg root", "/home/user/project\n");
    execResponses.set("hg id -i", "a1b2c3d4e5f6\n");

    const ctx = detectVcsContext("/home/user/project");
    expect(ctx.root).toBe("/home/user/project");
    expect(ctx.vcs).toEqual({ type: "hg", revision: "a1b2c3d4e5f6" });
  });

  test("strips hg dirty suffix", () => {
    execResponses.set("hg root", "/home/user/project\n");
    execResponses.set("hg id -i", "a1b2c3d4e5f6+\n");

    const ctx = detectVcsContext("/home/user/project");
    expect(ctx.vcs?.revision).toBe("a1b2c3d4e5f6");
  });

  test("detects svn repo", () => {
    execResponses.set("svn info --show-item wc-root", "/home/user/project\n");
    execResponses.set("svn info --show-item revision", "42\n");

    const ctx = detectVcsContext("/home/user/project");
    expect(ctx.root).toBe("/home/user/project");
    expect(ctx.vcs).toEqual({ type: "svn", revision: "42" });
  });

  test("jj takes priority over git when both present", () => {
    execResponses.set("jj root", "/home/user/project\n");
    execResponses.set(
      "jj log -r @ --no-graph -T change_id",
      "kkmpptxn1234\n",
    );
    execResponses.set(
      "git rev-parse --show-toplevel",
      "/home/user/project\n",
    );
    execResponses.set("git rev-parse HEAD", "abc123def\n");

    const ctx = detectVcsContext("/home/user/project");
    expect(ctx.vcs?.type).toBe("jj");
  });

  test("falls back to cwd when no VCS detected", () => {
    const ctx = detectVcsContext("/some/random/dir");
    expect(ctx.root).toBe("/some/random/dir");
    expect(ctx.vcs).toBeUndefined();
  });

  test("returns root without vcs when root succeeds but revision fails", () => {
    execResponses.set(
      "git rev-parse --show-toplevel",
      "/home/user/project\n",
    );
    // git rev-parse HEAD not set -> will throw -> no revision

    const ctx = detectVcsContext("/home/user/project");
    expect(ctx.root).toBe("/home/user/project");
    expect(ctx.vcs).toBeUndefined();
  });
});

describe("getWorkspaceRoot", () => {
  beforeEach(() => {
    saveEnv(
      "AGENT_TRACE_WORKSPACE_ROOT",
      "CURSOR_PROJECT_DIR",
      "CLAUDE_PROJECT_DIR",
    );
    delete process.env.AGENT_TRACE_WORKSPACE_ROOT;
    delete process.env.CURSOR_PROJECT_DIR;
    delete process.env.CLAUDE_PROJECT_DIR;
  });

  afterEach(() => {
    restoreEnv();
  });

  test("AGENT_TRACE_WORKSPACE_ROOT takes priority", () => {
    process.env.AGENT_TRACE_WORKSPACE_ROOT = "/override/root";
    process.env.CURSOR_PROJECT_DIR = "/cursor/root";
    expect(getWorkspaceRoot()).toBe("/override/root");
  });

  test("CURSOR_PROJECT_DIR is second priority", () => {
    process.env.CURSOR_PROJECT_DIR = "/cursor/root";
    process.env.CLAUDE_PROJECT_DIR = "/claude/root";
    expect(getWorkspaceRoot()).toBe("/cursor/root");
  });

  test("CLAUDE_PROJECT_DIR is third priority", () => {
    process.env.CLAUDE_PROJECT_DIR = "/claude/root";
    expect(getWorkspaceRoot()).toBe("/claude/root");
  });
});
