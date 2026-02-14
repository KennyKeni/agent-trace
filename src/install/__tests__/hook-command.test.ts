import { describe, expect, test } from "bun:test";
import { hookCommand } from "../utils";

describe("hookCommand", () => {
  test("starts with bunx", () => {
    const cmd = hookCommand("cursor", "1.0.0");
    expect(cmd).toMatch(/^bunx /);
  });

  test("pins version by default", () => {
    const cmd = hookCommand("cursor", "1.0.0");
    expect(cmd).toContain("@kennykeni/agent-trace@");
  });

  test("omits version when pinVersion is false", () => {
    const cmd = hookCommand("cursor", "latest");
    expect(cmd).toBe("bunx @kennykeni/agent-trace hook --provider cursor");
    expect(cmd).not.toMatch(/@\d+\.\d+/);
  });

  test("includes hook --provider for each provider", () => {
    for (const provider of ["cursor", "claude", "opencode"] as const) {
      const cmd = hookCommand(provider, "1.0.0");
      expect(cmd).toContain(`hook --provider ${provider}`);
    }
  });

  test("does not contain absolute paths", () => {
    const cmd = hookCommand("claude", "1.0.0");
    expect(cmd).not.toContain("/.agent-trace/");
    expect(cmd).not.toContain("$HOME");
  });
});
