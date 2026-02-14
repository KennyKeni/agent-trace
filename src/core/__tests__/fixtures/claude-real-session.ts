// Real Claude Code hook payloads extracted from .agent-trace/raw/claude/.
// Structure and field presence matches production; content is scrubbed.
// __ROOT__ = workspace root, __TRANSCRIPT__ = transcript path.
// Prompts replaced with placeholders. File content is generic git template.

export const ROOT_TOKEN = "__ROOT__";
export const TRANSCRIPT_TOKEN = "__TRANSCRIPT__";

// --- Edit-focused session ---
// SessionStart -> UserPromptSubmit -> PostToolUse/Edit -> UserPromptSubmit -> PostToolUse/Edit -> SessionEnd
//
// Key real-world properties preserved:
//   - model only on SessionStart (absent on PostToolUse, UserPromptSubmit, SessionEnd)
//   - permission_mode on tool and prompt events
//   - tool_response with structuredPatch/originalFile/userModified/replaceAll
//   - tool_input.replace_all (boolean, not in stub type)
//   - source: "startup" (not "cli" as stubs use)
//   - reason: "prompt_input_exit" (not "user_exit" as stubs use)

export const claudeEditSession: Record<string, unknown>[] = [
  {
    session_id: "b7508f0a-5e6e-4ff6-b6e2-7069e7043b89",
    transcript_path: "__TRANSCRIPT__",
    cwd: "__ROOT__",
    hook_event_name: "SessionStart",
    source: "startup",
    model: "claude-opus-4-6",
  },
  {
    session_id: "b7508f0a-5e6e-4ff6-b6e2-7069e7043b89",
    transcript_path: "__TRANSCRIPT__",
    cwd: "__ROOT__",
    permission_mode: "default",
    hook_event_name: "UserPromptSubmit",
    prompt: "Edit the config file",
  },
  {
    session_id: "b7508f0a-5e6e-4ff6-b6e2-7069e7043b89",
    transcript_path: "__TRANSCRIPT__",
    cwd: "__ROOT__",
    permission_mode: "default",
    hook_event_name: "PostToolUse",
    tool_name: "Edit",
    tool_input: {
      file_path: "__ROOT__/.git/info/exclude",
      old_string: "# *~",
      new_string: "# *~\nPLAN.md",
      replace_all: false,
    },
    tool_response: {
      filePath: "__ROOT__/.git/info/exclude",
      oldString: "# *~",
      newString: "# *~\nPLAN.md",
      originalFile:
        "# git ls-files --others --exclude-from=.git/info/exclude\n" +
        "# Lines that start with '#' are comments.\n" +
        "# For a project mostly in C, the following would be a good set of\n" +
        "# exclude patterns (uncomment them if you want to use them):\n" +
        "# *.[oa]\n" +
        "# *~\n",
      structuredPatch: [
        {
          oldStart: 4,
          oldLines: 3,
          newStart: 4,
          newLines: 4,
          lines: [
            " # exclude patterns (uncomment them if you want to use them):",
            " # *.[oa]",
            " # *~",
            "+PLAN.md",
          ],
        },
      ],
      userModified: false,
      replaceAll: false,
    },
    tool_use_id: "toolu_01TcQxxfSgQ4uHQCo89ZLvsK",
  },
  {
    session_id: "b7508f0a-5e6e-4ff6-b6e2-7069e7043b89",
    transcript_path: "__TRANSCRIPT__",
    cwd: "__ROOT__",
    permission_mode: "default",
    hook_event_name: "UserPromptSubmit",
    prompt: "Make another edit",
  },
  {
    session_id: "b7508f0a-5e6e-4ff6-b6e2-7069e7043b89",
    transcript_path: "__TRANSCRIPT__",
    cwd: "__ROOT__",
    permission_mode: "default",
    hook_event_name: "PostToolUse",
    tool_name: "Edit",
    tool_input: {
      file_path: "__ROOT__/.git/info/exclude",
      old_string: "PLAN.md",
      new_string: "PLAN.md\nSCRATCH.md",
      replace_all: false,
    },
    tool_response: {
      filePath: "__ROOT__/.git/info/exclude",
      oldString: "PLAN.md",
      newString: "PLAN.md\nSCRATCH.md",
      originalFile:
        "# git ls-files --others --exclude-from=.git/info/exclude\n" +
        "# Lines that start with '#' are comments.\n" +
        "# For a project mostly in C, the following would be a good set of\n" +
        "# exclude patterns (uncomment them if you want to use them):\n" +
        "# *.[oa]\n" +
        "# *~\n" +
        "PLAN.md\n",
      structuredPatch: [
        {
          oldStart: 5,
          oldLines: 3,
          newStart: 5,
          newLines: 4,
          lines: [" # *.[oa]", " # *~", " PLAN.md", "+SCRATCH.md"],
        },
      ],
      userModified: false,
      replaceAll: false,
    },
    tool_use_id: "toolu_016Kd6RgPDpbLye7XxNqgRox",
  },
  {
    session_id: "b7508f0a-5e6e-4ff6-b6e2-7069e7043b89",
    transcript_path: "__TRANSCRIPT__",
    cwd: "__ROOT__",
    hook_event_name: "SessionEnd",
    reason: "prompt_input_exit",
  },
];

// --- Bash-focused session ---
// SessionStart -> UserPromptSubmit x2 -> PreToolUse/Bash -> PostToolUse/Bash
//
// Key real-world properties preserved:
//   - tool_input.description (undocumented field on Bash)
//   - tool_response with stdout/stderr/interrupted/isImage/noOutputExpected

export const claudeBashSession: Record<string, unknown>[] = [
  {
    session_id: "6063ddb3-2768-493c-87ae-d95d7d3a8edc",
    transcript_path: "__TRANSCRIPT__",
    cwd: "__ROOT__",
    hook_event_name: "SessionStart",
    source: "startup",
    model: "claude-opus-4-6",
  },
  {
    session_id: "6063ddb3-2768-493c-87ae-d95d7d3a8edc",
    transcript_path: "__TRANSCRIPT__",
    cwd: "__ROOT__",
    permission_mode: "default",
    hook_event_name: "UserPromptSubmit",
    prompt: "Run a shell command",
  },
  {
    session_id: "6063ddb3-2768-493c-87ae-d95d7d3a8edc",
    transcript_path: "__TRANSCRIPT__",
    cwd: "__ROOT__",
    permission_mode: "default",
    hook_event_name: "UserPromptSubmit",
    prompt: "Use the CLI instead",
  },
  {
    session_id: "6063ddb3-2768-493c-87ae-d95d7d3a8edc",
    transcript_path: "__TRANSCRIPT__",
    cwd: "__ROOT__",
    permission_mode: "default",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: {
      command: "gh release list --repo openai/codex --limit 5",
      description: "List latest releases from GitHub",
    },
    tool_use_id: "toolu_01LVE37pnjkTBkPYLstUbvtr",
  },
  {
    session_id: "6063ddb3-2768-493c-87ae-d95d7d3a8edc",
    transcript_path: "__TRANSCRIPT__",
    cwd: "__ROOT__",
    permission_mode: "default",
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: {
      command: "gh release list --repo openai/codex --limit 5",
      description: "List latest releases from GitHub",
    },
    tool_response: {
      stdout: "0.101.0\tLatest\trust-v0.101.0\t2026-02-12T20:05:52Z\n",
      stderr: "",
      interrupted: false,
      isImage: false,
      noOutputExpected: false,
    },
    tool_use_id: "toolu_01LVE37pnjkTBkPYLstUbvtr",
  },
];

// --- Token replacement utility ---

export function hydrateEvents(
  events: Record<string, unknown>[],
  root: string,
  transcriptPath?: string,
): Record<string, unknown>[] {
  const transcript = transcriptPath ?? `${root}/transcript.jsonl`;
  return events.map((e) => hydrate(e, root, transcript));
}

function hydrate(obj: unknown, root: string, transcript: string): any {
  if (typeof obj === "string") {
    return obj
      .replaceAll(ROOT_TOKEN, root)
      .replaceAll(TRANSCRIPT_TOKEN, transcript);
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => hydrate(item, root, transcript));
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = hydrate(val, root, transcript);
    }
    return result;
  }
  return obj;
}
