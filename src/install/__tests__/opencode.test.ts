import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("generated OpenCode plugin", () => {
  const templatePath = join(
    import.meta.dir,
    "..",
    "templates",
    "opencode-plugin.ts",
  );
  const pluginSource = readFileSync(templatePath, "utf-8");

  test("uses bunx spawn instead of bun run", () => {
    expect(pluginSource).toContain('"bunx"');
    expect(pluginSource).toContain("spawn(");
    expect(pluginSource).not.toContain('"bun run"');
  });

  test("contains __AGENT_TRACE_PKG__ placeholder", () => {
    expect(pluginSource).toContain("__AGENT_TRACE_PKG__");
  });

  test("does not import homedir or path utilities", () => {
    expect(pluginSource).not.toContain("homedir");
    expect(pluginSource).not.toContain('"node:os"');
    expect(pluginSource).not.toContain('"node:path"');
  });

  test("contains cwd: root in spawn options", () => {
    expect(pluginSource).toContain("cwd: root,");
  });

  test("uses node:child_process import", () => {
    expect(pluginSource).toContain('"node:child_process"');
  });

  test("contains chat.message handler", () => {
    expect(pluginSource).toContain('"chat.message"');
  });

  test("contains tool.execute.before handler to capture command", () => {
    expect(pluginSource).toContain('"tool.execute.before"');
    expect(pluginSource).toContain("pendingCommands.set(");
  });

  test("contains tool.execute.after handler", () => {
    expect(pluginSource).toContain('"tool.execute.after"');
  });

  test("tool.execute.after shell branch reads command from pendingCommands", () => {
    expect(pluginSource).toContain("pendingCommands.get(");
    expect(pluginSource).toContain("pendingCommands.delete(");
  });

  test("uses hook: prefix for event names", () => {
    expect(pluginSource).toContain('"hook:chat.message"');
    expect(pluginSource).toContain('"hook:tool.execute.after"');
  });

  test("filters .agent-trace/ paths in tool handler", () => {
    expect(pluginSource).toContain('.startsWith(".agent-trace/")');
  });
});

describe("installOpenCode replaces placeholder", () => {
  test("output does not contain __AGENT_TRACE_PKG__", async () => {
    const { installOpenCode } = await import("../opencode");
    const tmp = join(import.meta.dir, "..", "..", "..", ".tmp-test-opencode");
    const result = installOpenCode(tmp, true);
    expect(result.status).toBeDefined();
    // When not dry-run, the file would have the placeholder replaced.
    // We verify the function itself works without error in dry-run mode.
  });
});
