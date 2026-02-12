import "../extensions";
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

async function runCodexExecWithTracing(args: string[]): Promise<number> {
  const proc = Bun.spawn(["codex", "exec", "--json", ...args], {
    stdin: "inherit",
    stderr: "inherit",
    stdout: "pipe",
  });

  const ingestor = new CodexTraceIngestor();

  await streamLines(proc.stdout, (line) => {
    process.stdout.write(`${line}\n`);
    ingestor.processLine(line);
  });

  const exitCode = await proc.exited;
  return exitCode;
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

    case "exec":
      return runCodexExecWithTracing(args.slice(1));

    default:
      console.error(`Unknown codex subcommand: ${sub ?? "(none)"}`);
      console.error("Available: notify, ingest, exec");
      return 1;
  }
}
