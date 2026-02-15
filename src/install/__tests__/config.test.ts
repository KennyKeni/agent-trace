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
import { installConfig } from "../config";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "agent-trace-install-config-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("installConfig", () => {
  test("creates config.json with default values", () => {
    const result = installConfig(tmpDir, false, "1.0.0");
    expect(result.status).toBe("created");

    const config = JSON.parse(
      readFileSync(join(tmpDir, ".agent-trace", "config.json"), "utf-8"),
    );
    expect(config.version).toBe("1.0.0");
    expect(config.extensions).toEqual([]);
    expect(config.rawCapture).toBe(false);
    expect(config.useGitignore).toBe(true);
    expect(config.useBuiltinSensitive).toBe(true);
    expect(config.ignore).toEqual([]);
    expect(config.ignoreMode).toBe("redact");
  });

  test("does not overwrite existing config", () => {
    const configDir = join(tmpDir, ".agent-trace");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ extensions: ["diffs"], ignore: ["*.secret"] }),
    );

    const result = installConfig(tmpDir, false, "1.0.0");
    expect(result.status).toBe("unchanged");
    expect(result.note).toBe("already exists");

    const config = JSON.parse(
      readFileSync(join(configDir, "config.json"), "utf-8"),
    );
    expect(config.extensions).toEqual(["diffs"]);
    expect(config.ignore).toEqual(["*.secret"]);
  });

  test("dry run does not create file", () => {
    const result = installConfig(tmpDir, true, "1.0.0");
    expect(result.status).toBe("created");
    expect(existsSync(join(tmpDir, ".agent-trace", "config.json"))).toBe(false);
  });
});
