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
import { installCursor } from "../cursor";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "agent-trace-install-cursor-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("installCursor", () => {
  test("creates hooks.json with correct events", () => {
    const result = installCursor(tmpDir, false);
    expect(result.status).toBe("created");

    const config = JSON.parse(
      readFileSync(join(tmpDir, ".cursor", "hooks.json"), "utf-8"),
    );
    const hooks = config.hooks;
    expect(hooks.sessionStart).toBeDefined();
    expect(hooks.sessionEnd).toBeDefined();
    expect(hooks.beforeSubmitPrompt).toBeDefined();
    expect(hooks.afterFileEdit).toBeDefined();
    expect(hooks.afterTabFileEdit).toBeDefined();
    expect(hooks.afterShellExecution).toBeDefined();
  });

  test("does not include removed hooks", () => {
    installCursor(tmpDir, false);

    const config = JSON.parse(
      readFileSync(join(tmpDir, ".cursor", "hooks.json"), "utf-8"),
    );
    expect(config.hooks.afterAgentResponse).toBeUndefined();
    expect(config.hooks.beforeShellExecution).toBeUndefined();
  });

  test("sets version to 1 by default", () => {
    installCursor(tmpDir, false);

    const config = JSON.parse(
      readFileSync(join(tmpDir, ".cursor", "hooks.json"), "utf-8"),
    );
    expect(config.version).toBe(1);
  });

  test("preserves existing version", () => {
    const hooksPath = join(tmpDir, ".cursor", "hooks.json");
    mkdirSync(join(tmpDir, ".cursor"), { recursive: true });
    writeFileSync(
      hooksPath,
      JSON.stringify({ version: 3, hooks: {} }),
      "utf-8",
    );

    installCursor(tmpDir, false);

    const config = JSON.parse(readFileSync(hooksPath, "utf-8"));
    expect(config.version).toBe(3);
  });

  test("preserves existing config keys", () => {
    const hooksPath = join(tmpDir, ".cursor", "hooks.json");
    mkdirSync(join(tmpDir, ".cursor"), { recursive: true });
    writeFileSync(
      hooksPath,
      JSON.stringify({ version: 2, customKey: "data", hooks: {} }),
      "utf-8",
    );

    installCursor(tmpDir, false);

    const config = JSON.parse(readFileSync(hooksPath, "utf-8"));
    expect(config.customKey).toBe("data");
    expect(config.version).toBe(2);
  });

  test("idempotent — second run reports unchanged", () => {
    installCursor(tmpDir, false);
    const first = readFileSync(join(tmpDir, ".cursor", "hooks.json"), "utf-8");

    const result = installCursor(tmpDir, false);
    expect(result.status).toBe("unchanged");

    const second = readFileSync(join(tmpDir, ".cursor", "hooks.json"), "utf-8");
    expect(second).toBe(first);
  });

  test("dry run does not create file", () => {
    const result = installCursor(tmpDir, true);
    expect(result.status).toBe("created");
    expect(existsSync(join(tmpDir, ".cursor", "hooks.json"))).toBe(false);
  });

  test("hooks contain agent-trace command", () => {
    installCursor(tmpDir, false);

    const content = readFileSync(
      join(tmpDir, ".cursor", "hooks.json"),
      "utf-8",
    );
    expect(content).toContain("agent-trace");
    expect(content).toContain("hook --provider cursor");
  });
});
