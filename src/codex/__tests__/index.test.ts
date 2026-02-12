import { describe, expect, it } from "bun:test";
import { runCodexSubcommand } from "../index";

describe("runCodexSubcommand", () => {
  it("returns 1 for unknown subcommand", async () => {
    const code = await runCodexSubcommand(["unknown"]);
    expect(code).toBe(1);
  });

  it("returns 1 for no subcommand", async () => {
    const code = await runCodexSubcommand([]);
    expect(code).toBe(1);
  });

  it("returns 1 for notify without json arg", async () => {
    const code = await runCodexSubcommand(["notify"]);
    expect(code).toBe(1);
  });

  it("returns 1 for notify with invalid json", async () => {
    const code = await runCodexSubcommand(["notify", "not-json"]);
    expect(code).toBe(1);
  });
});
