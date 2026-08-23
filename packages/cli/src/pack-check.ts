import { isAbsolute, resolve } from "node:path";
import { checkLocalePack, type LocalePackCheckReport } from "@relay/protocol";
import { ExitCode, UsageError } from "./errors.js";
import type { OutputStreams } from "./output.js";

export function packHelp(): string {
  return `Relay pack commands

Compare a Combine evidence folder of accessibility trees against one baseline locale.
This does not go through the HTTP server.

Usage:
  relay pack check <dir> --against <locale>
  relay pack check <dir> --baseline <locale>

Examples:
  relay pack check runs/2026-08-22_grok-data-controls-supported-locales --against en
  relay pack check runs/2026-08-22_grok-data-controls-supported-locales --baseline en --json

Reads accessibility/*.json (strings / slots / nodes). Missing baseline slots fail the command.
Grok, X, and Imagine left in English are not leftover copy.
`;
}

function positionals(argv: readonly string[]): string[] {
  const values = new Set(["--against", "--baseline"]);
  const args: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("-") || token === "-") {
      args.push(token);
      continue;
    }
    const name = token.split("=")[0]!;
    if (values.has(name) && !token.includes("=")) index += 1;
  }
  return args;
}

function flagValue(argv: readonly string[], name: string): string | undefined {
  const prefix = `${name}=`;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token.startsWith(prefix)) return token.slice(prefix.length);
    if (token === name) return argv[index + 1];
  }
  return undefined;
}

function writeJson(streams: OutputStreams, value: unknown): void {
  streams.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function formatDigest(report: LocalePackCheckReport): string {
  const lines = [
    `Pack check ${report.dir} against ${report.baseline}`,
    ...report.digest.map((row) => {
      const parts = [row.complete ? "complete" : "incomplete"];
      if (row.missingSlots.length) parts.push(`missing ${row.missingSlots.join(", ")}`);
      if (row.leftoverEnglish.length) {
        parts.push(
          `leftover ${row.leftoverEnglish.map((text) => JSON.stringify(text)).join(", ")}`,
        );
      }
      return `  ${row.locale.padEnd(8)} ${parts.join("  ")}`;
    }),
  ];
  const missing = report.digest.filter((row) => row.missingSlots.length).length;
  lines.push("");
  lines.push(
    report.ok
      ? "ok: every locale has the baseline slots"
      : `ok: false (${missing} locale${missing === 1 ? "" : "s"} missing a baseline slot)`,
  );
  return `${lines.join("\n")}\n`;
}

export async function runPackCommand(
  argv: readonly string[],
  streams: OutputStreams,
  cwd = process.cwd(),
): Promise<number> {
  const json = argv.includes("--json");
  const args = positionals(argv).slice(1);
  const action = args[0];
  if (!action || action === "help" || argv.includes("-h") || argv.includes("--help")) {
    streams.stdout.write(packHelp());
    return ExitCode.success;
  }
  if (action !== "check") {
    throw new UsageError("Expected: relay pack check <dir> --against <locale>");
  }

  const dirArg = args[1];
  const against = flagValue(argv, "--against") ?? flagValue(argv, "--baseline");
  if (!dirArg?.trim()) throw new UsageError("Expected: relay pack check <dir> --against <locale>");
  if (!against?.trim()) {
    throw new UsageError("pack check requires --against <locale> or --baseline <locale>");
  }
  if (flagValue(argv, "--against") && flagValue(argv, "--baseline")) {
    throw new UsageError("Use only one of --against or --baseline");
  }

  const dir = isAbsolute(dirArg) ? dirArg : resolve(cwd, dirArg);
  let report: LocalePackCheckReport;
  try {
    report = await checkLocalePack(dir, against);
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }

  if (json) writeJson(streams, report);
  else streams.stdout.write(formatDigest(report));
  return report.ok ? ExitCode.success : ExitCode.validation;
}
