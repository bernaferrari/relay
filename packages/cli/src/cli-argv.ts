import { UsageError } from "./errors.js";

export type ParsedTokens = {
  positionals: string[];
  values: Map<string, string>;
  switches: Set<string>;
};

const valueFlags = new Set([
  "--server",
  "--organization",
  "--project",
  "--credential-source",
  "--actor",
  "--timeout",
  "--input",
  "--input-file",
  "--file",
  "--mark",
  "--dir",
  "--max-scrolls",
  "--in",
  "--each",
  "--strategy",
  "--pilot",
  "--resume",
  "--inspect",
  "--lens",
  "--cell",
  "--lane",
  "--target",
  "--revision",
  "--commit",
  "--pr",
  "--branch",
  "--budget",
  "--out",
  "--output",
  "--device",
  "--map",
  "--base",
  "--config",
  "--config-file",
  "--export",
  "--todo",
  "--triage",
  "--url",
  "--goal",
  "--title",
  "--max-steps",
  "--max-ms",
  "--model",
  "--agents",
  "--judge",
  "--value",
  "--mission",
  "--auth-fixture",
  "--app",
  "--test",
  "--junit",
  "--name",
]);
const switchFlags = new Set([
  "-h",
  "--help",
  "--json",
  "--ndjson",
  "--quiet",
  "--wait",
  "--no-wait",
  "--binary",
  "--force",
  "--full",
  "--preview",
  "--confirm",
  "--history",
  "--all",
  "--no-restore",
  "--findings",
  "--version",
]);
const repeatableValueFlags = new Set(["--in", "--each", "--value", "--mission", "--test"]);
const reviewedOriginConfirmationOperations = new Set([
  "app-map.scroll-surface.origin.review",
  "app-map.scroll-surface.origin.revoke",
]);

export function confirmedReviewedOriginInput(
  operationId: string,
  input: Record<string, unknown>,
  confirmed: boolean,
): Record<string, unknown> {
  if (reviewedOriginConfirmationOperations.has(operationId) && !confirmed) {
    throw new UsageError(`${operationId} requires --confirm and its fixed assertion literal`);
  }
  return reviewedOriginConfirmationOperations.has(operationId)
    ? { ...input, confirmation: "confirm" }
    : input;
}

export function tokenize(argv: readonly string[]): ParsedTokens {
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
    const value = equals >= 0 ? token.slice(equals + 1) : argv[++index];
    if (!value || value.startsWith("--")) throw new UsageError(`${name} requires a value`);
    if (repeatableValueFlags.has(name)) {
      const existing = values.get(name);
      values.set(name, existing ? `${existing}\u0000${value}` : value);
      continue;
    }
    values.set(name, value);
  }
  return { positionals, values, switches };
}
