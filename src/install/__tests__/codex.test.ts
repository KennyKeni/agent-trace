import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { installCodex } from "../codex";

const TEST_ROOT = join(
  import.meta.dir,
  "../../..",
  "tmp",
  "codex-install-test",
);
const CODEX_HOME = join(TEST_ROOT, ".codex");

beforeEach(() => {
  mkdirSync(TEST_ROOT, { recursive: true });
  process.env.CODEX_HOME = CODEX_HOME;
});

afterEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  delete process.env.CODEX_HOME;
});

describe("installCodex", () => {
  it("creates config.toml when missing", () => {
    const result = installCodex(false);
    expect(result.status).toBe("created");
    expect(result.file).toBe(join(CODEX_HOME, "config.toml"));

    const content = readFileSync(result.file, "utf-8");
    expect(content).toContain("notify =");
    expect(content).toContain("agent-trace");
    expect(content).toContain("codex");
    expect(content).toContain("notify");
  });

  it("updates existing config.toml without notify", () => {
    mkdirSync(CODEX_HOME, { recursive: true });
    writeFileSync(join(CODEX_HOME, "config.toml"), 'model = "o3"\n', "utf-8");

    const result = installCodex(false);
    expect(result.status).toBe("updated");

    const content = readFileSync(result.file, "utf-8");
    expect(content).toContain('model = "o3"');
    expect(content).toContain("notify =");
    expect(content).toContain("agent-trace");
  });

  it("replaces existing notify line", () => {
    mkdirSync(CODEX_HOME, { recursive: true });
    writeFileSync(
      join(CODEX_HOME, "config.toml"),
      'notify = ["echo", "hello"]\n',
      "utf-8",
    );

    const result = installCodex(false);
    expect(result.status).toBe("updated");

    const content = readFileSync(result.file, "utf-8");
    expect(content).not.toContain("echo");
    expect(content).toContain("agent-trace");
  });

  it("is idempotent", () => {
    installCodex(false);
    const result = installCodex(false);
    expect(result.status).toBe("unchanged");
  });

  it("respects dry-run", () => {
    const result = installCodex(true);
    expect(result.status).toBe("created");
    expect(existsSync(join(CODEX_HOME, "config.toml"))).toBe(false);
  });

  it("uses unpinned version when pinVersion is false", () => {
    const result = installCodex(false, false);
    expect(result.status).toBe("created");

    const content = readFileSync(result.file, "utf-8");
    expect(content).toContain("@kennykeni/agent-trace");
    expect(content).not.toMatch(/@kennykeni\/agent-trace@\d/);
  });

  it("does not false-positive on agent-trace in project paths", () => {
    mkdirSync(CODEX_HOME, { recursive: true });
    writeFileSync(
      join(CODEX_HOME, "config.toml"),
      '[projects."/home/user/agent-trace-kenny"]\ntrust_level = "trusted"\n',
      "utf-8",
    );

    const result = installCodex(false);
    expect(result.status).toBe("updated");

    const content = readFileSync(result.file, "utf-8");
    expect(content).toContain("notify =");
  });

  it("inserts notify before first section header", () => {
    mkdirSync(CODEX_HOME, { recursive: true });
    writeFileSync(
      join(CODEX_HOME, "config.toml"),
      'model = "o3"\n\n[projects."/tmp/test"]\ntrust_level = "trusted"\n',
      "utf-8",
    );

    const result = installCodex(false);
    const content = readFileSync(result.file, "utf-8");
    const notifyIdx = content.indexOf("notify =");
    const sectionIdx = content.indexOf("[projects");
    expect(notifyIdx).toBeLessThan(sectionIdx);
  });
});
