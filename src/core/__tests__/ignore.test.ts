import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  extractFilePathsFromRaw,
  type IgnoreConfig,
  isIgnored,
  loadConfig,
  loadIgnoreConfig,
  scrubRawInput,
} from "../ignore";
import type { HookInput } from "../types";

function tmpRoot(): string {
  const dir = join(
    tmpdir(),
    `ignore-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeConfig(root: string, config: Record<string, unknown>): void {
  const dir = join(root, ".agent-trace");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify(config));
}

function defaultIgnoreConfig(overrides?: Partial<IgnoreConfig>): IgnoreConfig {
  return {
    useGitignore: true,
    useBuiltinSensitive: true,
    patterns: [],
    mode: "redact",
    ...overrides,
  };
}

describe("loadConfig", () => {
  test("returns defaults when config.json does not exist", () => {
    const root = tmpRoot();
    const config = loadConfig(root);
    expect(config.extensions).toBeNull();
    expect(config.ignore.useGitignore).toBe(true);
    expect(config.ignore.useBuiltinSensitive).toBe(true);
    expect(config.ignore.patterns).toEqual([]);
    expect(config.ignore.mode).toBe("redact");
    rmSync(root, { recursive: true, force: true });
  });

  test("parses extensions array from config", () => {
    const root = tmpRoot();
    writeConfig(root, { extensions: ["diffs", "messages"] });
    const config = loadConfig(root);
    expect(config.extensions).toEqual(["diffs", "messages"]);
    rmSync(root, { recursive: true, force: true });
  });

  test("returns null extensions when extensions field is missing", () => {
    const root = tmpRoot();
    writeConfig(root, { useGitignore: false });
    const config = loadConfig(root);
    expect(config.extensions).toBeNull();
    rmSync(root, { recursive: true, force: true });
  });

  test("parses ignore fields", () => {
    const root = tmpRoot();
    writeConfig(root, {
      useGitignore: false,
      useBuiltinSensitive: false,
      ignore: ["*.secret"],
      ignoreMode: "skip",
    });
    const config = loadConfig(root);
    expect(config.ignore.useGitignore).toBe(false);
    expect(config.ignore.useBuiltinSensitive).toBe(false);
    expect(config.ignore.patterns).toEqual(["*.secret"]);
    expect(config.ignore.mode).toBe("skip");
    rmSync(root, { recursive: true, force: true });
  });

  test("invalid ignoreMode defaults to redact", () => {
    const root = tmpRoot();
    writeConfig(root, { ignoreMode: "unknown" });
    const config = loadConfig(root);
    expect(config.ignore.mode).toBe("redact");
    rmSync(root, { recursive: true, force: true });
  });

  test("rawCapture defaults to false when missing", () => {
    const root = tmpRoot();
    writeConfig(root, {});
    const config = loadConfig(root);
    expect(config.rawCapture).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  test("rawCapture defaults to false when no config file", () => {
    const root = tmpRoot();
    const config = loadConfig(root);
    expect(config.rawCapture).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  test("rawCapture explicit false", () => {
    const root = tmpRoot();
    writeConfig(root, { rawCapture: false });
    const config = loadConfig(root);
    expect(config.rawCapture).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  test("rawCapture explicit true", () => {
    const root = tmpRoot();
    writeConfig(root, { rawCapture: true });
    const config = loadConfig(root);
    expect(config.rawCapture).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  test("malformed JSON logs error and returns defaults", () => {
    const root = tmpRoot();
    const dir = join(root, ".agent-trace");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), "{bad json");
    const config = loadConfig(root);
    expect(config.extensions).toBeNull();
    expect(config.ignore.mode).toBe("redact");
    expect(config.rawCapture).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("loadIgnoreConfig", () => {
  test("returns IgnoreConfig directly", () => {
    const root = tmpRoot();
    writeConfig(root, { ignore: ["*.custom"], ignoreMode: "skip" });
    const ic = loadIgnoreConfig(root);
    expect(ic.patterns).toEqual(["*.custom"]);
    expect(ic.mode).toBe("skip");
    rmSync(root, { recursive: true, force: true });
  });
});

describe("isIgnored", () => {
  const root = "/project";

  describe("builtin sensitive patterns", () => {
    const config = defaultIgnoreConfig();

    test("matches .env at root", () => {
      expect(isIgnored("/project/.env", root, config)).toBe(true);
    });

    test("matches .env.local", () => {
      expect(isIgnored("/project/.env.local", root, config)).toBe(true);
    });

    test("matches .env.production", () => {
      expect(isIgnored("/project/.env.production", root, config)).toBe(true);
    });

    test("matches nested .env", () => {
      expect(isIgnored("/project/config/.env", root, config)).toBe(true);
    });

    test("matches nested .env.production", () => {
      expect(isIgnored("/project/config/.env.production", root, config)).toBe(
        true,
      );
    });

    test("matches .pem file", () => {
      expect(isIgnored("/project/cert.pem", root, config)).toBe(true);
    });

    test("matches nested .pem file", () => {
      expect(isIgnored("/project/secrets/cert.pem", root, config)).toBe(true);
    });

    test("matches .key file", () => {
      expect(isIgnored("/project/server.key", root, config)).toBe(true);
    });

    test("matches .p12 file", () => {
      expect(isIgnored("/project/cert.p12", root, config)).toBe(true);
    });

    test("matches .pfx file", () => {
      expect(isIgnored("/project/cert.pfx", root, config)).toBe(true);
    });

    test("matches id_rsa", () => {
      expect(isIgnored("/project/.ssh/id_rsa", root, config)).toBe(true);
    });

    test("matches id_ed25519", () => {
      expect(isIgnored("/project/.ssh/id_ed25519", root, config)).toBe(true);
    });

    test("matches .kubeconfig", () => {
      expect(isIgnored("/project/config.kubeconfig", root, config)).toBe(true);
    });

    test("matches credentials.json", () => {
      expect(isIgnored("/project/credentials.json", root, config)).toBe(true);
    });

    test("does NOT match src/app.ts", () => {
      expect(isIgnored("/project/src/app.ts", root, config)).toBe(false);
    });

    test("does NOT match README.md", () => {
      expect(isIgnored("/project/README.md", root, config)).toBe(false);
    });

    test("does NOT match package.json", () => {
      expect(isIgnored("/project/package.json", root, config)).toBe(false);
    });
  });

  describe("useBuiltinSensitive toggle", () => {
    test("disabled: .env is not ignored", () => {
      const config = defaultIgnoreConfig({ useBuiltinSensitive: false });
      expect(isIgnored("/project/.env", root, config)).toBe(false);
    });

    test("disabled: .pem is not ignored", () => {
      const config = defaultIgnoreConfig({ useBuiltinSensitive: false });
      expect(isIgnored("/project/cert.pem", root, config)).toBe(false);
    });
  });

  describe("custom patterns", () => {
    test("matches user-defined glob", () => {
      const config = defaultIgnoreConfig({ patterns: ["**/*.secret"] });
      expect(isIgnored("/project/data/api.secret", root, config)).toBe(true);
    });

    test("does not match unrelated files", () => {
      const config = defaultIgnoreConfig({ patterns: ["**/*.secret"] });
      expect(isIgnored("/project/data/api.json", root, config)).toBe(false);
    });
  });

  describe("useGitignore toggle", () => {
    test("disabled: skips git check-ignore", () => {
      const config = defaultIgnoreConfig({
        useGitignore: false,
        useBuiltinSensitive: false,
      });
      expect(isIgnored("/project/src/app.ts", root, config)).toBe(false);
    });
  });

  describe("relative paths", () => {
    test("handles relative file path", () => {
      const config = defaultIgnoreConfig();
      expect(isIgnored(".env", root, config)).toBe(true);
    });

    test("handles nested relative path", () => {
      const config = defaultIgnoreConfig();
      expect(isIgnored("config/.env.production", root, config)).toBe(true);
    });
  });
});

describe("extractFilePathsFromRaw", () => {
  describe("claude provider", () => {
    test("extracts file_path from tool_input", () => {
      const input = {
        hook_event_name: "PostToolUse",
        tool_input: { file_path: "/project/src/app.ts" },
      } as HookInput;
      expect(extractFilePathsFromRaw("claude", input)).toEqual([
        "/project/src/app.ts",
      ]);
    });

    test("returns null when no tool_input", () => {
      const input = { hook_event_name: "SessionStart" } as HookInput;
      expect(extractFilePathsFromRaw("claude", input)).toBeNull();
    });

    test("returns empty array (fail-closed) when tool_input has no file_path", () => {
      const input = {
        hook_event_name: "PostToolUse",
        tool_input: { command: "ls" },
      } as HookInput;
      expect(extractFilePathsFromRaw("claude", input)).toEqual([]);
    });
  });

  describe("cursor provider", () => {
    test("extracts file_path", () => {
      const input = {
        hook_event_name: "afterFileEdit",
        file_path: "/project/src/app.ts",
        edits: [],
      } as unknown as HookInput;
      expect(extractFilePathsFromRaw("cursor", input)).toEqual([
        "/project/src/app.ts",
      ]);
    });

    test("returns null for non-file-edit events", () => {
      const input = {
        hook_event_name: "sessionStart",
      } as HookInput;
      expect(extractFilePathsFromRaw("cursor", input)).toBeNull();
    });

    test("returns empty array when edits exist but no file_path", () => {
      const input = {
        hook_event_name: "afterFileEdit",
        edits: [{ old_string: "a", new_string: "b" }],
      } as unknown as HookInput;
      expect(extractFilePathsFromRaw("cursor", input)).toEqual([]);
    });
  });

  describe("opencode provider", () => {
    test("extracts paths from files array", () => {
      const input = {
        hook_event_name: "hook:tool.execute.after",
        files: [{ file: "a.ts" }, { file: "b.ts" }],
      } as unknown as HookInput;
      expect(extractFilePathsFromRaw("opencode", input)).toEqual([
        "a.ts",
        "b.ts",
      ]);
    });

    test("extracts file_path for file.edited", () => {
      const input = {
        hook_event_name: "file.edited",
        file_path: "src/app.ts",
      } as unknown as HookInput;
      expect(extractFilePathsFromRaw("opencode", input)).toEqual([
        "src/app.ts",
      ]);
    });

    test("fail-closed for file.edited with no path", () => {
      const input = {
        hook_event_name: "file.edited",
      } as HookInput;
      expect(extractFilePathsFromRaw("opencode", input)).toEqual([]);
    });

    test("returns null for non-file events", () => {
      const input = {
        hook_event_name: "session.created",
      } as HookInput;
      expect(extractFilePathsFromRaw("opencode", input)).toBeNull();
    });
  });

  describe("unknown provider", () => {
    test("returns null", () => {
      const input = { hook_event_name: "test" } as HookInput;
      expect(extractFilePathsFromRaw("unknown", input)).toBeNull();
    });
  });
});

describe("scrubRawInput", () => {
  test("replaces known sensitive string fields", () => {
    const input = {
      hook_event_name: "PostToolUse",
      tool_input: {
        file_path: "/project/.env",
        old_string: "SECRET_KEY=abc123",
        new_string: "SECRET_KEY=xyz789",
        content: "full file content",
      },
      tool_response: {
        originalFile: "original secret content",
      },
    } as unknown as HookInput;

    const scrubbed = scrubRawInput(input) as unknown as Record<string, unknown>;
    const toolInput = scrubbed.tool_input as Record<string, unknown>;
    const toolResponse = scrubbed.tool_response as Record<string, unknown>;

    expect(toolInput.file_path).toBe("/project/.env");
    expect(toolInput.old_string).toBe("[REDACTED]");
    expect(toolInput.new_string).toBe("[REDACTED]");
    expect(toolInput.content).toBe("[REDACTED]");
    expect(toolResponse.originalFile).toBe("[REDACTED]");
  });

  test("scrubs nested fields in arrays", () => {
    const input = {
      hook_event_name: "afterFileEdit",
      edits: [
        { old_string: "old", new_string: "new" },
        { old_string: "old2", new_string: "new2" },
      ],
    } as unknown as HookInput;

    const scrubbed = scrubRawInput(input) as unknown as Record<string, unknown>;
    const edits = scrubbed.edits as Array<Record<string, unknown>>;

    expect(edits[0]?.old_string).toBe("[REDACTED]");
    expect(edits[0]?.new_string).toBe("[REDACTED]");
    expect(edits[1]?.old_string).toBe("[REDACTED]");
    expect(edits[1]?.new_string).toBe("[REDACTED]");
  });

  test("scrubs opencode files array", () => {
    const input = {
      hook_event_name: "hook:tool.execute.after",
      files: [{ file: ".env", before: "KEY=old", after: "KEY=new" }],
    } as unknown as HookInput;

    const scrubbed = scrubRawInput(input) as unknown as Record<string, unknown>;
    const files = scrubbed.files as Array<Record<string, unknown>>;

    expect(files[0]?.file).toBe(".env");
    expect(files[0]?.before).toBe("[REDACTED]");
    expect(files[0]?.after).toBe("[REDACTED]");
  });

  test("does not mutate original input", () => {
    const input = {
      hook_event_name: "PostToolUse",
      tool_input: {
        old_string: "secret",
        new_string: "secret2",
      },
    } as unknown as HookInput;

    scrubRawInput(input);
    const raw = input as unknown as Record<string, unknown>;
    const toolInput = raw.tool_input as Record<string, unknown>;
    expect(toolInput.old_string).toBe("secret");
    expect(toolInput.new_string).toBe("secret2");
  });

  test("preserves non-sensitive fields", () => {
    const input = {
      hook_event_name: "PostToolUse",
      model: "claude-4",
      session_id: "sess-123",
      tool_input: {
        file_path: "/project/.env",
        old_string: "secret",
      },
    } as unknown as HookInput;

    const scrubbed = scrubRawInput(input) as unknown as Record<string, unknown>;
    expect(scrubbed.hook_event_name).toBe("PostToolUse");
    expect(scrubbed.model).toBe("claude-4");
    expect(scrubbed.session_id).toBe("sess-123");
  });
});
