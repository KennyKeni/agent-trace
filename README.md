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

Configures the target repo's provider settings:

| Provider   | Config written                            |
| ---------- | ----------------------------------------- |
| Cursor     | `.cursor/hooks.json`                      |
| Claude Code| `.claude/settings.json`                   |
| OpenCode   | `.opencode/plugins/agent-trace.ts`        |

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

## Extensions

Extensions are pluggable modules that run alongside the core trace pipeline. Four are built in: `raw-events`, `diffs`, `messages`, and `line-hashes`. All extensions are enabled by default.

To control which extensions run, create `.agent-trace/config.json` in your project root:

```json
{ "extensions": ["diffs", "messages"] }
```

- **File absent** -- all registered extensions run (default)
- **`"extensions": ["diffs", "messages"]`** -- only listed extensions run
- **`"extensions": []`** -- no extensions run (only `traces.jsonl` is written)
- **Malformed JSON** -- warning logged, all extensions run

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

- **Path normalization edge cases**: Relative path conversion is string-prefix based today; some sibling-path cases can produce `..` segments.
- **Bun-only**: The hook runtime and CLI require Bun. Node.js is not supported.
- **No VCS requirement**: Works without git. When git is available, traces include the current commit SHA. Without git, VCS info is omitted.

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
