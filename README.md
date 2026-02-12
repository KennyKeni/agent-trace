# agent-trace

A TypeScript implementation of the [Agent Trace specification](https://agent-trace.org) ([GitHub](https://github.com/cursor/agent-trace)) for capturing AI code contributions from local coding tools.

## Overview

agent-trace hooks into AI coding tools and records trace data as they edit files. Each trace captures what was changed, which model was used, and links back to the conversation that produced the code. Traces are written as JSONL to `.agent-trace/traces.jsonl` in the project root.

Supported providers:

- Cursor
- Claude Code
- OpenCode

## Setup

Requires [Bun](https://bun.sh).

Install hooks in the current git repository:

```bash
bunx @kennykeni/agent-trace init
```

Install for specific providers:

```bash
bunx @kennykeni/agent-trace init --providers cursor
bunx @kennykeni/agent-trace init --providers claude,opencode
```

Install for a specific project:

```bash
bunx @kennykeni/agent-trace init --target-root ~/my-project
```

Preview what would be written:

```bash
bunx @kennykeni/agent-trace init --dry-run
```

Check installation status:

```bash
bunx @kennykeni/agent-trace status
```

## What `init` does

Creates `.agent-trace/config.json` with default settings and configures the target repo's provider hooks:

| File                                    | Purpose                          |
| --------------------------------------- | -------------------------------- |
| `.agent-trace/config.json`              | Extensions and ignore settings   |
| `.cursor/hooks.json`                    | Cursor hook registration         |
| `.claude/settings.json`                 | Claude Code hook registration    |
| `.opencode/plugins/agent-trace.ts`      | OpenCode plugin registration     |

Existing `config.json` files are never overwritten — only created when absent.

## How it works

1. Provider hooks fire on tool events (file edits, shell commands, session lifecycle).
2. The hook receives event JSON on stdin and routes it through a provider adapter.
3. The adapter normalizes provider-specific payloads into internal trace events.
4. The trace pipeline converts events into spec-compliant trace records.
5. Records are appended to `.agent-trace/traces.jsonl`.

Additional artifacts are written by extensions under `.agent-trace/`:

- `raw/<provider>/<session>.jsonl` -- raw hook events (`raw-events` extension)
- `messages/<provider>/<session>.jsonl` -- captured chat messages (`messages` extension)
- `diffs/<provider>/<session>.patch` -- diff artifacts when available (`diffs` extension)
- `line-hashes/<provider>/<session>.jsonl` -- per-line content hashes (`line-hashes` extension)

## Configuration

`init` generates `.agent-trace/config.json` with these defaults:

```json
{
  "extensions": ["diffs", "line-hashes", "raw-events", "messages"],
  "useGitignore": true,
  "useBuiltinSensitive": true,
  "ignore": [],
  "ignoreMode": "redact"
}
```

### Extensions

Extensions are pluggable modules that run alongside the core trace pipeline. Four are built in: `raw-events`, `diffs`, `messages`, and `line-hashes`.

- **`"extensions": ["diffs", "messages"]`** -- only listed extensions run
- **`"extensions": []`** -- no extensions run (only `traces.jsonl` is written)

### Sensitive file filtering

By default, agent-trace filters sensitive files to prevent secrets from leaking into trace artifacts. Filtering applies to `traces.jsonl`, diffs, line-hashes, and raw events.

| Field | Default | Description |
|-------|---------|-------------|
| `useGitignore` | `true` | Respect `.gitignore` patterns via `git check-ignore` |
| `useBuiltinSensitive` | `true` | Apply built-in sensitive file patterns |
| `ignore` | `[]` | Additional glob patterns to filter |
| `ignoreMode` | `"redact"` | `"redact"` keeps the trace entry with path but no content; `"skip"` drops the event entirely |

Built-in sensitive patterns match at any depth:

```
.env  .env.*  *.pem  *.key  *.p12  *.pfx
id_rsa  id_dsa  id_ecdsa  id_ed25519
*.kubeconfig  credentials.*
```

When a file is **redacted**, the trace records the file path with empty ranges and `metadata.redacted: true`. Extensions see empty edits and produce no diff/hash artifacts. Raw events have sensitive fields (`old_string`, `new_string`, `content`, `before`, `after`, `originalFile`) replaced with `"[REDACTED]"`.

When a file is **skipped**, no trace entry, diff, hash, or raw event is written.

## Trace format

Traces follow the [Agent Trace spec](https://agent-trace.org). Each JSONL line contains:

- `version` -- spec version
- `id` -- unique trace ID (UUID)
- `timestamp` -- ISO 8601
- `vcs` -- version control info (type, revision)
- `tool` -- tool name and version
- `files[]` -- files with conversation and range attribution
- `metadata` -- optional implementation-specific data

Schema source: [`schemas.ts`](./src/core/schemas.ts)

## Known limitations

- **indexOf-based range attribution**: When the same text appears multiple times in a file, line-range attribution may point to the first occurrence rather than the actual edit location. Providers don't always supply line numbers, so `indexOf` is the best-effort fallback.
- **Bun-only**: The hook runtime and CLI require Bun. Node.js is not supported.
- **No VCS requirement**: Works without git. When git is available, traces include the current commit SHA. Without git, VCS info is omitted. `useGitignore` silently becomes a no-op in non-git repos.
- **Multi-file OpenCode events**: If any file in a `hook:tool.execute.after` payload is ignored, the entire raw event is redacted/skipped (conservative approach).
- **`.env.*` matches broadly**: `**/.env.*` matches `.env.example` and `.env.template` intentionally — these files sometimes contain real values.

## Provider quirks

### Cursor

- **Tab edits lack file content**: `afterTabFileEdit` events do not set `readContent`, so line-hashes for tab completions have no file context for position resolution.
- **Duration field ambiguity**: Shell events accept both `duration` and `duration_ms`. When both are present, `duration_ms` takes precedence.

### Claude Code

- **Model tracking limited to session start**: Claude Code only includes the `model` field in `SessionStart` hook payloads. Switching models mid-session via `/model` does not fire a hook event, so traces after a switch may reflect the original model. This is a Claude Code hook API limitation.
- **Only Write, Edit, and Bash traced**: Other tool uses (Read, Search, etc.) are not hooked and produce no trace events.
- **Write tool fallback**: When the `Write` tool payload has no `new_string`, falls back to `content`. When neither is present, an empty-edits trace is recorded.

### OpenCode

- **Two file-edit code paths**: `file.edited` events carry no diff data (`edits: []`, `diffs: false`). Only `hook:tool.execute.after` events include before/after content for diffs and line-hashes.
- **Flexible session ID extraction**: Session IDs can appear in five different payload locations depending on the event type. The adapter tries them all in priority order.

### Codex

- **Only `apply_patch` tool calls traced**: File changes from shell commands or other mechanisms are not detected. Same contract as other providers — only explicit tool-reported edits are traced.
- **Patch format stability**: `parsePatchInput` depends on Codex's `*** <Action> File:` patch grammar. If Codex changes the format, parsing fails silently.
- **`*** Move to:` (rename) blocks not parsed**: Rename operations in apply_patch are not traced. This is a rare edge case.

## Development

```bash
bun install
bun test
bun run check
```

## Spec reference

This project implements the [Agent Trace specification](https://agent-trace.org) authored by [Cursor](https://github.com/cursor/agent-trace). The spec defines a vendor-neutral format for recording AI contributions alongside human authorship in version-controlled codebases.

## License

See the [Agent Trace spec](https://github.com/cursor/agent-trace) for specification licensing (CC BY 4.0).
