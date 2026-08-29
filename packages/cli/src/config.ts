import {
  capturePolicyForLens,
  isCombineLensInput,
  type ActorKind,
  type ServerConnection,
} from "@relay/protocol";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { resolveCommand, resolveResourceCommand, type CommandBehavior } from "./commands.js";
import { UsageError } from "./errors.js";
import { parseInFlags, parseOutcomeCliIntent, type OutcomeCliIntent } from "./outcome-command.js";

export type OutputMode = "human" | "json" | "ndjson";
export type CredentialSource = { type: "none" } | { type: "env"; name: string };
export type ScreenshotOutput =
  | { kind: "default" }
  | { kind: "file"; path: string; force: boolean }
  | { kind: "binary" };

export type GlobalConfig = {
  connection: ServerConnection;
  credentialSource: CredentialSource;
  output: OutputMode;
  quiet: boolean;
  timeoutMs: number;
  wait: boolean;
  /** Outcome commands alone may act on this policy. */
  ensureLocalServer: boolean;
};

export type ParsedCli =
  | {
      config: GlobalConfig;
      command: "help";
      helpFamily?: string;
    }
  | {
      config: GlobalConfig;
      command: "invoke";
      operationId: string;
      input: Record<string, unknown>;
      commandPath?: string;
      behavior?: CommandBehavior;
      screenshotOutput: ScreenshotOutput;
      surveyForce?: boolean;
      currentTarget?: boolean;
      currentRevision?: boolean;
    }
  | {
      config: GlobalConfig;
      command: "resource";
      resourceId: string;
      resourcePath: string;
      commandPath: string;
    }
  | {
      config: GlobalConfig;
      command: "outcome";
      intent: OutcomeCliIntent;
    }
  | {
      config: GlobalConfig;
      command: "verify-change";
      base: string;
      configFile: string;
      confirm: boolean;
    };

type Environment = Record<string, string | undefined>;

const defaults = {
  server: "http://127.0.0.1:8787",
  organization: "local",
  project: "default",
  actor: "human:local-cli",
  credentialSource: "env:RELAY_AUTH_TOKEN",
  timeout: "180000",
  wait: true,
} as const;

type ParsedTokens = {
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
  "--lens",
  "--cell",
  "--target",
  "--revision",
  "--commit",
  "--pr",
  "--branch",
  "--device",
  "--map",
  "--base",
  "--config",
  "--config-file",
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
]);
const repeatableValueFlags = new Set(["--in", "--each"]);

const reviewedOriginConfirmationOperations = new Set([
  "app-map.scroll-surface.origin.review",
  "app-map.scroll-surface.origin.revoke",
]);

function requireReviewedOriginConfirmation(operationId: string, confirmed: boolean): void {
  if (reviewedOriginConfirmationOperations.has(operationId) && !confirmed) {
    throw new UsageError(`${operationId} requires --confirm and its fixed assertion literal`);
  }
}

/** The CLI's switch is intentionally not trusted as a presentation-only hint.
 * Once explicitly supplied, carry the canonical confirmation into the signed
 * server/core operation payload. */
function confirmedReviewedOriginInput(
  operationId: string,
  input: Record<string, unknown>,
  confirmed: boolean,
): Record<string, unknown> {
  requireReviewedOriginConfirmation(operationId, confirmed);
  return reviewedOriginConfirmationOperations.has(operationId)
    ? { ...input, confirmation: "confirm" }
    : input;
}

function tokenize(argv: readonly string[]): ParsedTokens {
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

function choose(cli: string | undefined, env: string | undefined, fallback: string): string {
  return cli ?? (env?.trim() || fallback);
}

function parseCredentialSource(value: string): CredentialSource {
  if (value === "none") return { type: "none" };
  if (value.startsWith("env:") && value.length > 4) return { type: "env", name: value.slice(4) };
  throw new UsageError("--credential-source must be 'none' or 'env:NAME'");
}

function actorKind(actorId: string): ActorKind {
  if (actorId.startsWith("agent:")) return "agent";
  if (actorId.startsWith("system:")) return "system";
  return "human";
}

function booleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  throw new UsageError("RELAY_WAIT must be true, false, 1, or 0");
}

function applyCombineRunFlags(
  operationId: string,
  input: Record<string, unknown>,
  tokens: ParsedTokens,
): Record<string, unknown> {
  const worlds = parseInFlags(tokens.values.get("--in"));
  const lens = tokens.values.get("--lens");
  const cell = tokens.values.get("--cell");
  const all = tokens.switches.has("--all");
  const usesWorlds = Object.keys(worlds).length > 0;
  const inputIn =
    input.in && typeof input.in === "object" && !Array.isArray(input.in)
      ? (input.in as Record<string, unknown>)
      : undefined;
  const hasIn = usesWorlds || Boolean(inputIn && Object.keys(inputIn).length);
  if (lens && operationId !== "app-map.test.run" && operationId !== "job.combine.start") {
    throw new UsageError("--lens is only valid on test run or combine run");
  }
  if (usesWorlds && operationId !== "app-map.test.run") {
    throw new UsageError("--in is only valid on test run");
  }
  if (cell && operationId !== "app-map.test.run" && operationId !== "job.combine.start") {
    throw new UsageError("--cell is only valid on test run or combine run");
  }
  if (all && operationId !== "app-map.test.run" && operationId !== "job.combine.start") {
    throw new UsageError("--all is only valid on test run or combine run");
  }
  if (operationId === "app-map.test.run" && !hasIn) {
    if (lens) throw new UsageError("--lens requires --in variableId=value[,value]");
    if (cell) throw new UsageError("--cell requires --in variableId=value[,value]");
    if (all) throw new UsageError("--all requires --in variableId=value[,value]");
  }
  if (!usesWorlds && !lens && !cell && !all) return input;
  const next = { ...input };
  if (usesWorlds) next.in = worlds;
  if (lens) {
    if (!isCombineLensInput(lens)) {
      throw new UsageError(
        "--lens must be visual, smoke, every-screen, failures-only, final-screen, or none",
      );
    }
    if (operationId === "job.combine.start") next.capture = capturePolicyForLens(lens);
    else next.lens = lens;
  }
  if (cell) next.cell = cell;
  if (all) next.executionMode = "all";
  return next;
}

const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/;

/**
 * Freeze the proof-layer provenance into `app-map.test.run` input. Flags win
 * over ambient CI environment so an agent can always pin an exact revision;
 * absent both, no binding is claimed rather than guessed.
 */
function applySourceRevisionFlags(
  operationId: string,
  input: Record<string, unknown>,
  tokens: ParsedTokens,
  env: Environment,
): Record<string, unknown> {
  const commitFlag = tokens.values.get("--commit");
  const prFlag = tokens.values.get("--pr");
  const branchFlag = tokens.values.get("--branch");
  if (
    (commitFlag !== undefined || prFlag !== undefined || branchFlag !== undefined) &&
    operationId !== "app-map.test.run"
  ) {
    throw new UsageError("--commit, --pr, and --branch are only valid on test run");
  }
  const sha = commitFlag?.trim() || env.GITHUB_SHA?.trim() || env.CI_COMMIT_SHA?.trim();
  const branch =
    branchFlag?.trim() || env.GITHUB_REF_NAME?.trim() || env.CI_COMMIT_REF_NAME?.trim();
  const prRaw = prFlag?.trim() || env.CI_PR_NUMBER?.trim();
  let prNumber: number | undefined;
  if (prRaw) {
    const parsed = Number(prRaw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new UsageError("--pr must be a positive integer");
    }
    prNumber = parsed;
  }
  if (!sha && !branch && prNumber === undefined) return input;
  if (sha && !COMMIT_SHA_PATTERN.test(sha)) {
    throw new UsageError("--commit must be a 7-40 character lowercase git SHA");
  }
  const sourceRevision = {
    vcs: "git" as const,
    ...(sha ? { sha } : {}),
    ...(prNumber !== undefined ? { prNumber } : {}),
    ...(branch ? { branch } : {}),
  };
  if (input.sourceRevision !== undefined) {
    throw new UsageError(
      "Use either --commit/--pr/--branch or sourceRevision in --input, not both",
    );
  }
  return { ...input, sourceRevision };
}

function parseInput(rawInput: string | undefined): Record<string, unknown> {
  if (rawInput === undefined) return {};
  let input: unknown;
  try {
    input = JSON.parse(rawInput) as unknown;
  } catch {
    throw new UsageError("--input must be valid JSON");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new UsageError("--input must be a JSON object");
  }
  return input as Record<string, unknown>;
}

function readInput(tokens: ParsedTokens, env: Environment): Record<string, unknown> {
  const inline = tokens.values.get("--input");
  const file = tokens.values.get("--input-file");
  if (inline !== undefined && file !== undefined) {
    throw new UsageError("Use only one of --input or --input-file");
  }
  if (!file) return parseInput(inline);
  const path = isAbsolute(file) ? file : resolve(env.INIT_CWD?.trim() || process.cwd(), file);
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(`Could not read --input-file ${file}: ${message}`);
  }
  return parseInput(contents);
}

function applySnapshotPresentation(
  operationId: string,
  input: Record<string, unknown>,
  tokens: ParsedTokens,
  output: OutputMode,
): Record<string, unknown> {
  const wantsFull = tokens.switches.has("--full");
  const wantsFile = tokens.values.has("--file");
  if (wantsFull && operationId !== "target.snapshot.capture") {
    throw new UsageError("--full is only valid on snapshot commands");
  }
  if (operationId !== "target.snapshot.capture") return input;
  // The CLI is what an agent types first: machine output keeps the raw tree
  // (nodes), matching HTTP GET /snapshot?visual=1. Human stdout stays the
  // compact digest unless --full explicitly widens it.
  if (!wantsFull && !wantsFile && output === "human") return input;
  return { ...input, full: true };
}

function applySurveyDir(
  operationId: string,
  input: Record<string, unknown>,
  tokens: ParsedTokens,
): Record<string, unknown> {
  const dir = tokens.values.get("--dir");
  if (dir === undefined) return input;
  if (operationId !== "target.scroll-survey.capture") {
    throw new UsageError("--dir is only valid on device survey");
  }
  return { ...input, dir };
}

function applySurveyMaxScrolls(
  operationId: string,
  input: Record<string, unknown>,
  tokens: ParsedTokens,
): Record<string, unknown> {
  const raw = tokens.values.get("--max-scrolls");
  if (raw === undefined) return input;
  if (operationId !== "target.scroll-survey.capture") {
    throw new UsageError("--max-scrolls is only valid on device survey");
  }
  const maxScrolls = Number(raw);
  if (!Number.isInteger(maxScrolls) || maxScrolls < 1 || maxScrolls > 12) {
    throw new UsageError("--max-scrolls must be an integer between 1 and 12");
  }
  return { ...input, maxScrolls };
}

function applySurveyRestore(
  operationId: string,
  input: Record<string, unknown>,
  tokens: ParsedTokens,
): Record<string, unknown> {
  if (!tokens.switches.has("--no-restore")) return input;
  if (operationId !== "target.scroll-survey.capture") {
    throw new UsageError("--no-restore is only valid on device survey");
  }
  return { ...input, restore: false };
}

function applyProofFlags(
  operationId: string,
  input: Record<string, unknown>,
  tokens: ParsedTokens,
): Record<string, unknown> {
  const history = tokens.switches.has("--history");
  if (history && operationId !== "proof.inspect") {
    throw new UsageError("--history is only valid on proof inspect");
  }

  const requiresConfirmation =
    operationId === "proof.plan.approve" || operationId === "proof.cancel";
  if (requiresConfirmation && !tokens.switches.has("--confirm")) {
    throw new UsageError(`${operationId} requires --confirm`);
  }

  return {
    ...input,
    ...(history ? { includeHistory: true } : {}),
    ...(requiresConfirmation ? { confirm: true } : {}),
  };
}

function surveyDirForce(operationId: string, tokens: ParsedTokens): boolean {
  return (
    operationId === "target.scroll-survey.capture" &&
    tokens.values.has("--dir") &&
    tokens.switches.has("--force")
  );
}

const forceTargets = "screenshot, snapshot, --preview, or survey --dir";

function screenshotOutput(
  tokens: ParsedTokens,
  output: OutputMode,
  allowed: { file?: boolean; binary?: boolean },
  operationId = "",
): ScreenshotOutput {
  const file = tokens.values.get("--file");
  const binary = tokens.switches.has("--binary");
  const force = tokens.switches.has("--force");
  const dir = tokens.values.get("--dir");
  if (!file && !binary && !force) return { kind: "default" };
  if (binary && !allowed.binary) {
    throw new UsageError("--binary is only valid on screenshot or --preview commands");
  }
  if (file && !allowed.file) {
    throw new UsageError(`--file and --force are only valid on ${forceTargets}`);
  }
  if (file && binary) throw new UsageError("Use only one of --file or --binary");
  if (force && !file && !dir) {
    if (operationId === "target.scroll-survey.capture") {
      throw new UsageError("--force requires --dir <path>");
    }
    if (!allowed.file) {
      throw new UsageError(`--file and --force are only valid on ${forceTargets}`);
    }
    throw new UsageError("--force requires --file <path>");
  }
  if (force && !file && dir) return { kind: "default" };
  if (binary && output !== "human") {
    throw new UsageError("--binary cannot be combined with --json or --ndjson");
  }
  if (file) return { kind: "file", path: file, force };
  if (binary) return { kind: "binary" };
  return { kind: "default" };
}

export function parseCli(argv: readonly string[], env: Environment = process.env): ParsedCli {
  const tokens = tokenize(argv);
  if (tokens.switches.has("--json") && tokens.switches.has("--ndjson")) {
    throw new UsageError("Use only one of --json or --ndjson");
  }
  if (tokens.switches.has("--wait") && tokens.switches.has("--no-wait")) {
    throw new UsageError("Use only one of --wait or --no-wait");
  }

  const explicitCredentialSource =
    tokens.values.get("--credential-source") ?? env.RELAY_CREDENTIAL_SOURCE?.trim();
  const credentialSource = parseCredentialSource(
    explicitCredentialSource || defaults.credentialSource,
  );
  const credential = credentialSource.type === "env" ? env[credentialSource.name] : undefined;
  if (credentialSource.type === "env" && explicitCredentialSource && !credential) {
    throw new UsageError(`Credential environment variable ${credentialSource.name} is not set`);
  }
  const actor = choose(tokens.values.get("--actor"), env.RELAY_ACTOR_ID, defaults.actor);
  const timeoutRaw = choose(tokens.values.get("--timeout"), env.RELAY_TIMEOUT_MS, defaults.timeout);
  const timeoutMs = Number(timeoutRaw);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new UsageError("--timeout must be a positive integer in milliseconds");
  }
  const wait = tokens.switches.has("--wait")
    ? true
    : tokens.switches.has("--no-wait")
      ? false
      : booleanEnv(env.RELAY_WAIT, defaults.wait);
  const output: OutputMode = tokens.switches.has("--ndjson")
    ? "ndjson"
    : tokens.switches.has("--json")
      ? "json"
      : "human";

  const connection: ServerConnection = {
    url: choose(tokens.values.get("--server"), env.RELAY_URL, defaults.server),
    organizationId: choose(
      tokens.values.get("--organization"),
      env.RELAY_ORGANIZATION_ID,
      defaults.organization,
    ),
    projectId: choose(tokens.values.get("--project"), env.RELAY_PROJECT_ID, defaults.project),
    actorId: actor,
    actorKind: actorKind(actor),
    auth: credential ? { type: "bearer", token: credential } : { type: "none" },
  };
  const ensureLocalServer =
    !tokens.values.has("--server") && !env.RELAY_URL?.trim() && connection.url === defaults.server;

  const [group, action, operationId, ...extra] = tokens.positionals;
  const helpSwitch = tokens.switches.has("-h") || tokens.switches.has("--help");
  if (group === undefined || helpSwitch || group === "help") {
    if (group === "help" && operationId !== undefined) {
      throw new UsageError("Expected: relay help [family]");
    }
    return {
      config: {
        connection,
        credentialSource,
        output,
        quiet: tokens.switches.has("--quiet"),
        timeoutMs,
        wait,
        ensureLocalServer,
      },
      command: "help",
      ...(group === "help"
        ? action
          ? { helpFamily: action }
          : {}
        : group
          ? { helpFamily: group }
          : {}),
    };
  }

  const rawInput = tokens.values.get("--input");
  const inputFile = tokens.values.get("--input-file");
  if (group === "operation") {
    if (action !== "invoke" || !operationId || extra.length > 0) {
      throw new UsageError("Expected: relay operation invoke <operationId> --input <json>");
    }
    // These flags only exist on friendly commands; dropping them silently here
    // would make an agent believe a Combine lens/cell was applied when it was not.
    for (const friendlyOnly of [
      "--in",
      "--each",
      "--strategy",
      "--pilot",
      "--resume",
      "--lens",
      "--cell",
      "--all",
    ] as const) {
      if (tokens.values.has(friendlyOnly) || tokens.switches.has(friendlyOnly)) {
        throw new UsageError(
          `${friendlyOnly} is only supported by friendly commands, not 'operation invoke'. Put it in the operation --input JSON.`,
        );
      }
    }
    if (rawInput === undefined && inputFile === undefined) {
      throw new UsageError("operation invoke requires --input <json> or --input-file <path>");
    }
    const input = applySurveyRestore(
      operationId,
      applyProofFlags(
        operationId,
        applySurveyDir(
          operationId,
          applySurveyMaxScrolls(
            operationId,
            applySnapshotPresentation(
              operationId,
              confirmedReviewedOriginInput(
                operationId,
                readInput(tokens, env),
                tokens.switches.has("--confirm"),
              ),
              tokens,
              output,
            ),
            tokens,
          ),
          tokens,
        ),
        tokens,
      ),
      tokens,
    );

    return {
      config: {
        connection,
        credentialSource,
        output,
        quiet: tokens.switches.has("--quiet"),
        timeoutMs,
        wait,
        ensureLocalServer,
      },
      command: "invoke",
      operationId,
      input,
      ...(operationId === "target.screenshot.capture" ? { behavior: "screenshot" as const } : {}),
      screenshotOutput: screenshotOutput(
        tokens,
        output,
        {
          file:
            operationId === "target.screenshot.capture" ||
            operationId === "target.snapshot.capture",
          binary: operationId === "target.screenshot.capture",
        },
        operationId,
      ),
      ...(surveyDirForce(operationId, tokens) ? { surveyForce: true } : {}),
    };
  }

  // `verify-change --base` is the local source-to-Proof workflow. Keep it as
  // a CLI-native command: unlike the historical `verify-change run|test|revision`
  // outcome, it must inspect local Git and a reviewed config before it can
  // optionally call proof.start. This branch intentionally comes before the
  // generic input reader so --input cannot smuggle an unreviewed config in.
  if (group === "verify-change" && tokens.values.has("--base")) {
    if (action !== undefined || operationId !== undefined || extra.length > 0) {
      throw new UsageError("Expected: relay verify-change --base <ref> [--config-file <path>]");
    }
    if (rawInput !== undefined || inputFile !== undefined) {
      throw new UsageError(
        "verify-change --base reads a reviewed config file; use --config-file instead of --input",
      );
    }
    const base = tokens.values.get("--base")!.trim();
    if (!base || base.includes("\0") || base.length > 512) {
      throw new UsageError("--base must be a bounded local Git ref");
    }
    const config = tokens.values.get("--config");
    const configFile = tokens.values.get("--config-file");
    if (config && configFile) {
      throw new UsageError("Use only one of --config or --config-file");
    }
    return {
      config: {
        connection,
        credentialSource,
        output,
        quiet: tokens.switches.has("--quiet"),
        timeoutMs,
        wait,
        ensureLocalServer,
      },
      command: "verify-change",
      base,
      configFile: config ?? configFile ?? ".relay/change-proof.json",
      confirm: tokens.switches.has("--confirm"),
    };
  }

  for (const verifyChangeOnly of ["--base", "--config", "--config-file"] as const) {
    if (tokens.values.has(verifyChangeOnly)) {
      throw new UsageError(`${verifyChangeOnly} is only valid on verify-change --base`);
    }
  }

  const input = readInput(tokens, env);
  const resource = resolveResourceCommand(tokens.positionals, input);
  if (resource) {
    screenshotOutput(tokens, output, {});
    applySurveyDir("", {}, tokens);
    applySurveyMaxScrolls("", {}, tokens);
    applySurveyRestore("", {}, tokens);
    applySnapshotPresentation("", {}, tokens, output);

    return {
      config: {
        connection,
        credentialSource,
        output,
        quiet: tokens.switches.has("--quiet"),
        timeoutMs,
        wait,
        ensureLocalServer,
      },
      command: "resource",
      resourceId: resource.resourceId,
      resourcePath: resource.resourcePath,
      commandPath: resource.commandPath,
    };
  }

  let resolved: ReturnType<typeof resolveCommand>;
  try {
    resolved = resolveCommand(tokens.positionals, input);
  } catch (error) {
    const intent = parseOutcomeCliIntent(tokens);
    if (!intent) throw error;
    if (rawInput !== undefined || inputFile !== undefined) {
      throw new UsageError(
        "Outcome commands use named arguments and do not accept --input or --input-file",
      );
    }
    return {
      config: {
        connection,
        credentialSource,
        output,
        quiet: tokens.switches.has("--quiet"),
        timeoutMs,
        wait,
        ensureLocalServer,
      },
      command: "outcome",
      intent,
    };
  }
  if (tokens.values.has("--device") || tokens.values.has("--map")) {
    throw new UsageError("--device and --map are only valid on outcome commands");
  }
  for (const outcomeOnly of ["--each", "--strategy", "--pilot", "--resume"] as const) {
    if (tokens.values.has(outcomeOnly)) {
      throw new UsageError(`${outcomeOnly} is only valid on the outcome repeat command`);
    }
  }

  const mark = tokens.values.get("--mark");
  if (mark) {
    const matched = mark.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (!matched) throw new UsageError("--mark requires <x>,<y> in the same units as a tap");
  }
  const targetShortcut = tokens.values.get("--target");
  const revisionShortcut = tokens.values.get("--revision");
  if (targetShortcut !== undefined && targetShortcut !== "current") {
    throw new UsageError("--target currently accepts only 'current'");
  }
  if (revisionShortcut !== undefined && revisionShortcut !== "current") {
    throw new UsageError("--revision currently accepts only 'current'");
  }
  if (
    (targetShortcut !== undefined || revisionShortcut !== undefined) &&
    resolved.operationId !== "app-map.test.run"
  ) {
    throw new UsageError("--target current and --revision current are only valid on test run");
  }
  resolved.input = applySurveyRestore(
    resolved.operationId,
    applyProofFlags(
      resolved.operationId,
      applySurveyDir(
        resolved.operationId,
        applySurveyMaxScrolls(
          resolved.operationId,
          applySnapshotPresentation(
            resolved.operationId,
            applyCombineRunFlags(
              resolved.operationId,
              confirmedReviewedOriginInput(
                resolved.operationId,
                resolved.input,
                tokens.switches.has("--confirm"),
              ),
              tokens,
            ),
            tokens,
            output,
          ),
          tokens,
        ),
        tokens,
      ),
      tokens,
    ),
    tokens,
  );

  resolved.input = applySourceRevisionFlags(resolved.operationId, resolved.input, tokens, env);
  const preview = tokens.switches.has("--preview");
  if (mark) {
    if (resolved.operationId !== "target.screenshot.capture") {
      throw new UsageError("--mark is only valid on screenshot commands");
    }
    const matched = mark.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/)!;
    Object.assign(resolved.input, {
      previewX: Number(matched[1]),
      previewY: Number(matched[2]),
    });
  }
  if (preview) {
    if (resolved.operationId !== "target.interact") {
      throw new UsageError(
        "--preview is only valid on device interact (use --mark on screenshots)",
      );
    }
    Object.assign(resolved.input, { preview: true });
  }
  if (resolved.behavior === "event-stream" && output === "json") {
    throw new UsageError(
      `${resolved.commandPath} is a stream; use --ndjson (or human output) instead of --json`,
    );
  }
  return {
    config: {
      connection,
      credentialSource,
      output,
      quiet: tokens.switches.has("--quiet"),
      timeoutMs,
      wait,
      ensureLocalServer,
    },
    command: "invoke",
    operationId: resolved.operationId,
    input: resolved.input,
    commandPath: resolved.commandPath,
    ...(resolved.behavior ? { behavior: resolved.behavior } : {}),
    screenshotOutput: screenshotOutput(
      tokens,
      output,
      {
        file:
          resolved.operationId === "target.screenshot.capture" ||
          resolved.operationId === "target.snapshot.capture" ||
          (resolved.operationId === "target.interact" && preview),
        binary:
          resolved.operationId === "target.screenshot.capture" ||
          (resolved.operationId === "target.interact" && preview),
      },
      resolved.operationId,
    ),
    ...(resolved.operationId === "target.interact" && preview
      ? { behavior: "screenshot" as const }
      : {}),
    ...(surveyDirForce(resolved.operationId, tokens) ? { surveyForce: true } : {}),
    ...(targetShortcut === "current" ? { currentTarget: true } : {}),
    ...(revisionShortcut === "current" ? { currentRevision: true } : {}),
  };
}

export function redactedConfig(config: GlobalConfig): Record<string, unknown> {
  return {
    server: config.connection.url,
    organization: config.connection.organizationId,
    project: config.connection.projectId,
    actor: config.connection.actorId,
    credentialSource:
      config.credentialSource.type === "none" ? "none" : `env:${config.credentialSource.name}`,
    credential: config.connection.auth.type === "none" ? "none" : "configured",
    output: config.output,
    quiet: config.quiet,
    timeoutMs: config.timeoutMs,
    wait: config.wait,
    localServer: config.ensureLocalServer ? "ensure-for-outcomes" : "caller-managed",
  };
}
