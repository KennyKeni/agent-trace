import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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
import { installClaude } from "../claude";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "agent-trace-install-claude-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("installClaude", () => {
  test("creates settings.json with all hook events", () => {
    const result = installClaude(tmpDir, false);
    expect(result.status).toBe("created");

    const config = JSON.parse(
      readFileSync(join(tmpDir, ".claude", "settings.json"), "utf-8"),
    );
    const hooks = config.hooks;
    expect(hooks.SessionStart).toBeDefined();
    expect(hooks.SessionEnd).toBeDefined();
    expect(hooks.UserPromptSubmit).toBeDefined();
    expect(hooks.PreToolUse).toBeDefined();
    expect(hooks.PostToolUse).toBeDefined();
    expect(hooks.PostToolUseFailure).toBeDefined();
  });

  test("PreToolUse has Bash matcher", () => {
    installClaude(tmpDir, false);

    const config = JSON.parse(
      readFileSync(join(tmpDir, ".claude", "settings.json"), "utf-8"),
    );
    const groups = config.hooks.PreToolUse as Array<{ matcher?: string }>;
    expect(groups).toBeDefined();
    expect(groups.some((g) => g.matcher === "Bash")).toBe(true);
  });

  test("PostToolUse has Write|Edit and Bash matchers", () => {
    installClaude(tmpDir, false);

    const config = JSON.parse(
      readFileSync(join(tmpDir, ".claude", "settings.json"), "utf-8"),
    );
    const groups = config.hooks.PostToolUse as Array<{ matcher?: string }>;
    const matchers = groups.map((g) => g.matcher);
    expect(matchers).toContain("Write|Edit");
    expect(matchers).toContain("Bash");
  });

  test("PostToolUseFailure has Write|Edit|Bash matcher", () => {
    installClaude(tmpDir, false);

    const config = JSON.parse(
      readFileSync(join(tmpDir, ".claude", "settings.json"), "utf-8"),
    );
    const groups = config.hooks.PostToolUseFailure as Array<{
      matcher?: string;
    }>;
    expect(groups.some((g) => g.matcher === "Write|Edit|Bash")).toBe(true);
  });

  test("hook entries use command type with agent-trace", () => {
    installClaude(tmpDir, false);

    const content = readFileSync(
      join(tmpDir, ".claude", "settings.json"),
      "utf-8",
    );
    expect(content).toContain("agent-trace");
    expect(content).toContain("hook --provider claude");
    expect(content).toContain('"type": "command"');
  });

  test("idempotent — second run reports unchanged", () => {
    installClaude(tmpDir, false);
    const first = readFileSync(
      join(tmpDir, ".claude", "settings.json"),
      "utf-8",
    );

    const result = installClaude(tmpDir, false);
    expect(result.status).toBe("unchanged");

    const second = readFileSync(
      join(tmpDir, ".claude", "settings.json"),
      "utf-8",
    );
    expect(second).toBe(first);
  });

  test("preserves existing config keys", () => {
    const settingsPath = join(tmpDir, ".claude", "settings.json");
    mkdirSync(join(tmpDir, ".claude"), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({ customKey: "value", hooks: {} }),
      "utf-8",
    );

    installClaude(tmpDir, false);

    const config = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(config.customKey).toBe("value");
  });

  test("dry run does not create file", () => {
    const result = installClaude(tmpDir, true);
    expect(result.status).toBe("created");
    expect(existsSync(join(tmpDir, ".claude", "settings.json"))).toBe(false);
  });
});
