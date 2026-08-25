import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildProofReport, readPersistedRun, renderProofReportMarkdown, runsRoot } from "@relay/core";
import type { ProofReport } from "@relay/protocol";
import type { OutputStreams } from "./output.js";
import { ExitCode, UsageError } from "./errors.js";

const REPORT_VALUE_FLAGS = ["--run"] as const;
const REPORT_SWITCH_FLAGS = ["--json", "--ndjson", "--quiet", "-h", "--help"] as const;

type ReportArgs = {
  positionals: string[];
  values: Map<string, string>;
  switches: Set<string>;
};

/** Strict token parse: unknown flags are a UsageError, never a silent positional. */
function parseReportArgs(argv: readonly string[]): ReportArgs {
  const valueFlags = new Set<string>(REPORT_VALUE_FLAGS);
  const switchFlags = new Set<string>(REPORT_SWITCH_FLAGS);
  const positionals: string[] = [];
  const values = new Map<string, string>();
  const switches = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("-") || token === "-") {
      positionals.push(token);
      continue;
    }
    const equals = token.indexOf("=");
    const name = equals >= 0 ? token.slice(0, equals) : token;
    if (switchFlags.has(name)) {
      if (equals >= 0) throw new UsageError(`${name} does not take a value`);
      switches.add(name);
      continue;
    }
    if (!valueFlags.has(name)) throw new UsageError(`Unknown option: ${name}`);
    if (equals >= 0) {
      values.set(name, token.slice(equals + 1));
      continue;
    }
    index += 1;
    const next = argv[index];
    if (next === undefined) throw new UsageError(`${name} requires a value`);
    values.set(name, next);
  }
  return { positionals, values, switches };
}

function reportHelp(): string {
  return `Relay report commands

Turn a completed run into a proof report for a pull request: a machine
verdict (pass / fail / unproven), per-flow results, and a compact markdown
summary suitable for GitHub check-run output. \`unproven\` means Relay could
not execute (no device, no build); it is deliberately distinct from fail.

Usage:
  relay report emit --run <runId> [--format github-check] [--json]

Options:
  --run <runId>            Persisted run identifier to project (required)
  --format <format>        Output format; only "github-check" is defined
  --json                   Print the full ProofReport JSON instead of markdown

Exit codes follow operation semantics: 0 pass, 9 fail, 8 unproven
(the run could not execute).

Examples:
  pnpm relay report emit --run <run-id>
  pnpm relay report emit --run <run-id> --json
`;
}


/**
 * Local, disk-backed projection of a persisted run into a ProofReport.
 * Like `relay db`, this never goes through the HTTP server: the proof layer
 * must work in CI where no Relay process is running.
 */
export async function runReportCommand(
  argv: readonly string[],
  streams: OutputStreams,
  env: Record<string, string | undefined> = process.env,
): Promise<number> {
  const { positionals, values, switches } = parseReportArgs(argv);
  const args = positionals.slice(1);
  const action = args[0] ?? "help";

  if (action === "help" || switches.has("-h") || switches.has("--help")) {
    streams.stdout.write(reportHelp());
    return ExitCode.success;
  }
  if (action !== "emit") {
    throw new UsageError("Expected: relay report emit --run <runId>");
  }
  const format = values.get("--format");
  if (format !== undefined && format !== "github-check") {
    throw new UsageError('--format currently accepts only "github-check"');
  }
  const runId = values.get("--run")?.trim();
  if (!runId) throw new UsageError("report emit requires --run <runId>");

  const root = runsRoot();
  const run = await readPersistedRun(runId);
  if (!run) {
    throw new UsageError(
      `No completed run found for ${runId} under ${root}. Run \`relay run list\` to see persisted runs.`,
    );
  }
  const serverUrl = env.RELAY_URL?.trim() || env.RELAY_PUBLIC_BASE_URL?.trim() || undefined;
  const sharesStore = join(root, ".run-shares.json");
  const sharePath = existsSync(sharesStore) ? `/shared/runs/${encodeURIComponent(run.id)}` : undefined;
  const report: ProofReport = buildProofReport({
    run,
    ...(sharePath ? { sharePath } : {}),
    ...(serverUrl ? { relayServerUrl: serverUrl } : {}),
  });

  const machine = switches.has("--json") || switches.has("--ndjson");
  if (switches.has("--quiet")) {
    // Exit codes follow operation semantics: 0 pass, 9 fail, 8 unproven.
    return report.verdict === "pass"
      ? ExitCode.success
      : report.verdict === "fail"
        ? ExitCode.operationFailure
        : ExitCode.server;
  }
  if (machine) {
    streams.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    streams.stdout.write(renderProofReportMarkdown(report));
  }
  return report.verdict === "pass"
    ? ExitCode.success
    : report.verdict === "fail"
      ? ExitCode.operationFailure
      : ExitCode.server;
}
