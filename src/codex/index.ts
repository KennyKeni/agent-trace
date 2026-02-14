import { CodexTraceIngestor } from "./ingestor";
import { handleNotify } from "./notify";
import { streamLines } from "./stream";

async function ingestCodexJsonFromStdin(): Promise<number> {
  const ingestor = new CodexTraceIngestor();

  await streamLines(Bun.stdin.stream(), (line) => {
    ingestor.processLine(line);
  });

  return 0;
}

export async function runCodexSubcommand(args: string[]): Promise<number> {
  const sub = args[0];

  switch (sub) {
    case "notify":
      if (!args[1]) {
        console.error("Usage: agent-trace codex notify '<json>'");
        return 1;
      }
      return handleNotify(args[1]);

    case "ingest":
      return ingestCodexJsonFromStdin();

    default:
      console.error(`Unknown codex subcommand: ${sub ?? "(none)"}`);
      console.error("Available: notify, ingest");
      return 1;
  }
}
