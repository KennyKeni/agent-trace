import { describe, expect, test } from "bun:test";
import { InstallError, parseArgs } from "../args";

describe("parseArgs", () => {
  test("defaults to all providers", () => {
    const opts = parseArgs(["--target-root", "/tmp/fake-repo"]);
    expect(opts.providers).toEqual(["cursor", "claude", "opencode"]);
  });

  test("throws InstallError when any provider is invalid", () => {
    expect(() =>
      parseArgs([
        "--providers",
        "cursor,invalid",
        "--target-root",
        "/tmp/fake-repo",
      ]),
    ).toThrow(InstallError);
  });

  test("throws InstallError when all providers are invalid", () => {
    expect(() =>
      parseArgs(["--providers", "cursr", "--target-root", "/tmp/fake-repo"]),
    ).toThrow(InstallError);
  });

  test("--target-root skips git detection", () => {
    const opts = parseArgs(["--target-root", "/tmp/fake-repo"]);
    expect(opts.targetRoots).toEqual(["/tmp/fake-repo"]);
  });

  test("defaults to cwd without --target-root outside a git repo", () => {
    const origDir = process.cwd();
    try {
      process.chdir("/tmp");
      const opts = parseArgs([]);
      const root = opts.targetRoots[0];
      expect(root === "/tmp" || root === "/private/tmp").toBe(true);
    } finally {
      process.chdir(origDir);
    }
  });
});
