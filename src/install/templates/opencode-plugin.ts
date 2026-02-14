import { spawn } from "node:child_process";

async function emitToAgentTrace(root: string, payload: unknown): Promise<void> {
  await new Promise<void>((resolve) => {
    const child = spawn(
      "bunx",
      ["__AGENT_TRACE_PKG__", "hook", "--provider", "opencode"],
      {
        cwd: root,
        stdio: ["pipe", "ignore", "ignore"],
      },
    );
    child.on("error", () => resolve());
    child.on("exit", () => resolve());
    child.stdin.end(JSON.stringify(payload));
  });
}

export const AgentTracePlugin = async ({
  worktree,
  directory,
}: {
  worktree?: string;
  directory?: string;
}) => {
  const root = worktree || directory || process.cwd();
  const pendingCommands = new Map<string, string>();
  return {
    event: async ({
      event,
    }: {
      event: { type: string; properties: Record<string, unknown> };
    }) => {
      const props = event.properties ?? {};
      const nested = (key: string) => {
        const v = props[key];
        return typeof v === "object" && v !== null
          ? (v as Record<string, unknown>)
          : undefined;
      };
      const info = nested("info");
      const part = nested("part");

      const str = (v: unknown): string | undefined =>
        typeof v === "string" && v ? v : undefined;

      const session =
        str(props.sessionID) ??
        str(info?.sessionID) ??
        str(info?.id) ??
        str(part?.sessionID);

      const filterDiffs = (arr: unknown[]) =>
        arr.filter((d: unknown) => {
          if (!d || typeof d !== "object") return true;
          const file = (d as Record<string, unknown>).file;
          return typeof file !== "string" || !file.startsWith(".agent-trace/");
        });

      let filtered = props;
      if (Array.isArray(props.diff)) {
        filtered = { ...filtered, diff: filterDiffs(props.diff) };
      }
      if (info?.summary && typeof info.summary === "object") {
        const summary = info.summary as Record<string, unknown>;
        if (Array.isArray(summary.diffs)) {
          filtered = {
            ...filtered,
            info: {
              ...info,
              summary: { ...summary, diffs: filterDiffs(summary.diffs) },
            },
          };
        }
      }

      await emitToAgentTrace(root, {
        hook_event_name: event.type ?? "event",
        provider: "opencode",
        session_id: session,
        cwd: root,
        event: filtered,
      });
    },

    "chat.message": async (
      input: {
        sessionID: string;
        agent?: string;
        model?: { providerID: string; modelID: string };
        messageID?: string;
      },
      output: {
        parts?: Array<{ type?: string; text?: string; synthetic?: boolean }>;
      },
    ) => {
      const parts = output?.parts ?? [];
      const content = parts
        .filter(
          (p) =>
            !p.synthetic && p.type === "text" && typeof p.text === "string",
        )
        .map((p) => p.text as string)
        .join("\n");
      if (!content) return;

      const model =
        input.model?.providerID && input.model?.modelID
          ? `${input.model.providerID}/${input.model.modelID}`
          : input.model?.modelID;

      await emitToAgentTrace(root, {
        hook_event_name: "hook:chat.message",
        provider: "opencode",
        session_id: input.sessionID,
        cwd: root,
        content,
        role: "user",
        model,
        message_id: input.messageID,
        agent: input.agent,
      });
    },

    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> },
    ) => {
      const shellTools = ["bash", "shell"];
      if (shellTools.includes(input.tool)) {
        if (typeof output?.args?.command === "string") {
          pendingCommands.set(input.callID, output.args.command);
        }
        await emitToAgentTrace(root, {
          hook_event_name: "hook:tool.execute.before",
          provider: "opencode",
          session_id: input.sessionID,
          cwd: root,
          tool_name: input.tool,
          call_id: input.callID,
        });
      }
    },

    "tool.execute.after": async (
      input: {
        tool: string;
        sessionID: string;
        callID: string;
      },
      output: {
        title?: string;
        output?: string;
        metadata?: {
          files?: Array<{
            filePath?: string;
            before?: string;
            after?: string;
            additions?: number;
            deletions?: number;
          }>;
        };
      },
    ) => {
      const toolName = input?.tool ?? "";
      const shellTools = ["bash", "shell"];

      if (shellTools.includes(toolName)) {
        const command = pendingCommands.get(input.callID);
        pendingCommands.delete(input.callID);
        await emitToAgentTrace(root, {
          hook_event_name: "hook:tool.execute.after",
          provider: "opencode",
          session_id: input.sessionID,
          cwd: root,
          tool_name: toolName,
          call_id: input.callID,
          command,
        });
        return;
      }

      const editTools = ["edit", "apply_patch", "write", "patch"];
      if (!editTools.includes(toolName)) return;

      const metadata = output?.metadata;
      const files: Array<{ file: string; before?: string; after?: string }> =
        [];

      if (metadata?.files) {
        for (const f of metadata.files) {
          const fp = f.filePath ?? "";
          if (!fp || fp.startsWith(".agent-trace/")) continue;
          files.push({
            file: fp,
            before: f.before,
            after: f.after,
          });
        }
      }

      if (files.length === 0) return;

      await emitToAgentTrace(root, {
        hook_event_name: "hook:tool.execute.after",
        provider: "opencode",
        session_id: input.sessionID,
        cwd: root,
        tool_name: toolName,
        call_id: input.callID,
        files,
      });
    },
  };
};
