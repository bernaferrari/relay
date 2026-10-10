#!/usr/bin/env node
/**
 * INTERNAL COMPATIBILITY HARNESS for the end-to-end proof loop against a
 * LIVE Relay server and device. This is acceptance proof, not a supported
 * authoring surface or an example for product users.
 *
 * Models docs/LANGUAGE_SWEEP_LOOP.md but for the PROOF loop:
 * health -> lease (if needed) -> `test run … --wait` -> `proof report`
 * -> proof-out artifacts -> signed share -> summary.
 *
 * Real execution drives the workspace CLI exactly the way AGENTS.md mandates:
 * direct `node node_modules/tsx/dist/cli.mjs packages/cli/src/index.ts`,
 * `--json`, first JSON object on stdout parsed as data, stderr read
 * separately. Pure pieces are exported for the colocated offline test.
 *
 * Do not retire it until `relay verify-change` preserves all four properties:
 * source/PR provenance, a waited product verdict, emitted report artifacts
 * plus an evidence share, and 0/9/8 pass/fail/unproven exit semantics. At that
 * point this file should become a tiny outcome-command invocation or disappear.
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TSX_CLI = join(REPO_ROOT, "node_modules/tsx/dist/cli.mjs");
const CLI_ENTRY = join(REPO_ROOT, "packages/cli/src/index.ts");

export const DEFAULT_RELAY_URL = "http://127.0.0.1:8787";
export const DEFAULT_ACTOR = "human:local-cli";
export const PROOF_OUT_DIR = join(REPO_ROOT, "proof-out");
/** CI must always watch: `--wait` makes the CLI exit code a real verdict. */
const TEST_RUN_TIMEOUT_MS = "240000";
const SHARE_EXPIRES_IN_HOURS = 24;

export const PROOF_EXIT_CODES = { pass: 0, fail: 9, unproven: 8 };
export const PROOF_LOOP_CLASSIFICATION = Object.freeze({
  kind: "internal-compatibility-harness",
  retiresAfter: "relay verify-change owns provenance, verdict, artifacts, sharing, and exit codes",
});

/** Script failure taxonomy. `fail` means the product regressed; `infra`
 * means Relay could not prove anything (deliberately distinct). */
export class DogfoodError extends Error {
  constructor(message, { code = "infra", cliExitCode, cause } = {}) {
    super(message, cause === undefined ? {} : { cause });
    this.name = "DogfoodError";
    this.code = code;
    this.cliExitCode = cliExitCode;
  }
}

/* ── Pure helpers ─────────────────────────────────────────────────────── */

export function verdictToExitCode(verdict) {
  if (verdict === "pass") return PROOF_EXIT_CODES.pass;
  if (verdict === "fail") return PROOF_EXIT_CODES.fail;
  return PROOF_EXIT_CODES.unproven;
}

export function usage() {
  return `Usage: node scripts/dogfood-proof-loop.mjs --map <appMapId> --test <testId> \\
  --serial <deviceSerial> [--commit <sha>] [--pr <n>] [--branch <name>]

Environment: RELAY_URL (default ${DEFAULT_RELAY_URL}), RELAY_ACTOR_ID (default ${DEFAULT_ACTOR}).`;
}

/**
 * Strict argument parse. `--map`, `--test`, and `--serial` are required;
 * `--pr` must be a positive integer when present.
 */
export function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new DogfoodError(`Malformed argument near "${String(flag)}"\n${usage()}`);
    }
    values.set(flag, value);
  }
  const map = values.get("--map")?.trim();
  const test = values.get("--test")?.trim();
  const serial = values.get("--serial")?.trim();
  if (!map || !test || !serial) {
    throw new DogfoodError(`--map, --test, and --serial are required\n${usage()}`);
  }
  const prRaw = values.get("--pr");
  let pr;
  if (prRaw !== undefined) {
    pr = Number(prRaw);
    if (!Number.isInteger(pr) || pr < 1) {
      throw new DogfoodError(`--pr must be a positive integer, got "${prRaw}"`);
    }
  }
  const commit = values.get("--commit")?.trim();
  const branch = values.get("--branch")?.trim();
  return {
    map,
    test,
    serial,
    ...(commit ? { commit } : {}),
    ...(pr !== undefined ? { pr } : {}),
    ...(branch ? { branch } : {}),
  };
}

const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/;

/**
 * Commit precedence: `--commit` flag wins over GITHUB_SHA over the live git
 * HEAD (via the injected `runCommand`). Absent every source, nothing is
 * claimed rather than guessed — mirroring applySourceRevisionFlags.
 */
export function resolveCommit({ commit, env = {}, runCommand } = {}) {
  const sha = commit?.trim() || env.GITHUB_SHA?.trim();
  if (sha) {
    if (!COMMIT_SHA_PATTERN.test(sha)) {
      throw new DogfoodError(`--commit must be a 7-40 character lowercase git SHA, got "${sha}"`);
    }
    return sha;
  }
  if (!runCommand) return undefined;
  const head = runCommand(["git", "rev-parse", "HEAD"])?.trim();
  if (!head || !COMMIT_SHA_PATTERN.test(head)) return undefined;
  return head;
}

export function buildTestRunArgs({ map, test, commit, pr, branch }) {
  const args = [
    "test",
    "run",
    map,
    test,
    "--target",
    "current",
    "--revision",
    "current",
    "--timeout",
    TEST_RUN_TIMEOUT_MS,
  ];
  if (commit) args.push("--commit", commit);
  if (pr !== undefined) args.push("--pr", String(pr));
  if (branch) args.push("--branch", branch);
  args.push("--wait", "--json");
  return args;
}

/** First terminal CLI envelope on stdout: `{type:"result",ok:true,result}`
 * carries data; `{type:"error",…}` is a structured failure. Progress and
 * snapshot events on the same stream are skipped. */
export function cliResultEnvelope(stdout) {
  let terminal;
  for (const line of String(stdout).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (
        parsed &&
        typeof parsed === "object" &&
        (parsed.type === "result" || parsed.type === "error")
      ) {
        terminal ??= parsed;
      }
    } catch {
      // Not the data line yet.
    }
  }
  return terminal;
}

/** Unwrap a `{type:"result", ok:true, result}` envelope into its payload. */
export function unwrapCliResult(parsed) {
  if (!parsed || typeof parsed !== "object") return undefined;
  if (parsed.type === "result" && parsed.ok === true) return parsed.result;
  if (parsed.type === "error") {
    throw new DogfoodError(
      typeof parsed.error?.message === "string"
        ? parsed.error.message
        : "Relay CLI reported an error",
      { cliExitCode: parsed.error?.exitCode },
    );
  }
  return parsed;
}

/** The persisted run id equals the watched job id (runs.ts freezes job.id). */
export function extractRunId(payload) {
  const candidates = [
    payload?.job?.id,
    payload?.jobs?.find((job) => typeof job?.id === "string")?.id,
  ];
  const runId = candidates.find((id) => typeof id === "string" && id);
  if (!runId) throw new DogfoodError("Could not find a job/run id in the test run response");
  return runId;
}

/** `proof report --json` prints the bare ProofReport (no envelope). */
export function parseProofReport(stdout) {
  for (const line of String(stdout).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && typeof parsed.verdict === "string") return parsed;
    } catch {
      // Not the report line yet.
    }
  }
  throw new DogfoodError("No ProofReport found on proof report stdout");
}

/* ── Live side effects ────────────────────────────────────────────────── */

/** Direct tsx CLI invocation per AGENTS.md; stdout and stderr never merge. */
export function defaultCliRunner(args, { env = process.env } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [TSX_CLI, CLI_ENTRY, ...args], {
      cwd: REPO_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => resolvePromise({ code: code ?? -1, stdout, stderr }));
  });
}

async function invokeCli(cli, args, label) {
  const outcome = await cli(args);
  if (outcome.code !== 0) {
    const detail = outcome.stderr.trim().split("\n").at(-1) ?? "";
    throw new DogfoodError(`\`${label}\` exited ${outcome.code}${detail ? `: ${detail}` : ""}`, {
      cliExitCode: outcome.code,
    });
  }
  return unwrapCliResult(cliResultEnvelope(outcome.stdout));
}

export async function assertServerReachable({ relayUrl, fetchImpl }) {
  const healthUrl = new URL("/health", relayUrl);
  let response;
  try {
    response = await fetchImpl(healthUrl);
  } catch (cause) {
    throw new DogfoodError(
      `Relay server at ${relayUrl} is unreachable (${cause?.message ?? cause})`,
      {
        cause,
      },
    );
  }
  if (!response.ok) {
    throw new DogfoodError(`Relay health check returned HTTP ${response.status}`);
  }
  const body = await response.json().catch(() => undefined);
  if (body?.ok !== true) {
    throw new DogfoodError(`Relay health payload is not healthy at ${relayUrl}`);
  }
  return body;
}

/** Reuse an active lease we own; otherwise mint one with the same actor. */
export async function ensureLease({ serial, actor, cli }) {
  const listed = await invokeCli(cli, ["device", "lease", "list", "--json"], "lease list");
  const leases = Array.isArray(listed?.leases) ? listed.leases : [];
  const existing = leases.find(
    (lease) =>
      lease &&
      lease.deviceSerial === serial &&
      lease.ownerId === actor &&
      (lease.status === "leased" || lease.status === undefined),
  );
  if (existing && typeof existing.id === "string") {
    return { leaseId: existing.id, created: false };
  }
  const created = await invokeCli(
    cli,
    ["device", "lease", "create", serial, "--actor", actor, "--json"],
    "lease create",
  );
  const lease = created?.lease ?? created;
  if (!lease || typeof lease.id !== "string") {
    throw new DogfoodError("lease create did not return a lease id");
  }
  return { leaseId: lease.id, created: true };
}

export async function emitProofReportArtifacts({ runId, cli, outDir }) {
  const reportOutcome = await cli([
    "proof",
    "report",
    "--run",
    runId,
    "--format",
    "github-check",
    "--json",
  ]);
  if (reportOutcome.code !== 0) {
    const detail = reportOutcome.stderr.trim().split("\n").at(-1) ?? "";
    throw new DogfoodError(
      `proof report exited ${reportOutcome.code}${detail ? `: ${detail}` : ""}`,
      {
        cliExitCode: reportOutcome.code,
      },
    );
  }
  const report = parseProofReport(reportOutcome.stdout);
  const reportJsonPath = join(outDir, "proof-report.json");
  await writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);

  const markdownOutcome = await cli([
    "proof",
    "report",
    "--run",
    runId,
    "--format",
    "github-check",
  ]);
  const markdown =
    markdownOutcome.code === 0 && markdownOutcome.stdout.trim()
      ? markdownOutcome.stdout
      : `# Proof report ${runId}\n\nVerdict: ${report.verdict}\n`;
  const reportMarkdownPath = join(outDir, "proof-report.md");
  await writeFile(reportMarkdownPath, markdown);

  return {
    verdict: report.verdict,
    report,
    evidencePaths: [reportJsonPath, reportMarkdownPath],
    /** Relative share-report projection path, when the host published one. */
    sharePath: report.flows?.find((flow) => typeof flow?.sharePath === "string")?.sharePath,
  };
}

export async function createShareLink({ runId, cli }) {
  try {
    const payload = await invokeCli(
      cli,
      [
        "run",
        "share",
        "create",
        runId,
        "--input",
        JSON.stringify({ expiresInHours: SHARE_EXPIRES_IN_HOURS }),
        "--json",
      ],
      "run share create",
    );
    if (!payload || (typeof payload.path !== "string" && typeof payload.url !== "string")) {
      return { error: "run share create returned neither a path nor a url" };
    }
    return { path: payload.path, ...(typeof payload.url === "string" ? { url: payload.url } : {}) };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "run share create failed",
    };
  }
}

function shareDisplayLink(share, relayUrl) {
  if (!share) return "(not created)";
  if (share.url) return share.url;
  if (share.path)
    return /^https?:\/\//u.test(share.path) ? share.path : new URL(share.path, relayUrl).href;
  return `(unavailable: ${share.error ?? "unknown reason"})`;
}

function printSummary(summary) {
  const lines = [
    "== Relay proof loop ==",
    `verdict:    ${summary.verdict}`,
    `duration:   ${(summary.durationMs / 1000).toFixed(1)}s`,
    `run:        ${summary.runId}`,
    `lease:      ${summary.leaseId}${summary.leaseCreated ? " (created)" : " (reused)"}`,
    `evidence:   ${summary.evidencePaths.join(", ")}`,
    `share:      ${summary.shareLink}`,
    `exit code:  ${summary.exitCode}`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

/**
 * Run the whole proof loop against injected seams (`cli`, `fetchImpl`).
 * Returns `{ exitCode, summary }`; throws DogfoodError for infra problems.
 */
export async function runProofLoop({
  inputs,
  relayUrl = process.env.RELAY_URL?.trim() || DEFAULT_RELAY_URL,
  actor = process.env.RELAY_ACTOR_ID?.trim() || DEFAULT_ACTOR,
  fetchImpl = fetch,
  cli = defaultCliRunner,
  runCommand,
  outDir = PROOF_OUT_DIR,
}) {
  const startedAt = Date.now();
  const health = await assertServerReachable({ relayUrl, fetchImpl });
  const commit = resolveCommit({ commit: inputs.commit, env: process.env, runCommand });
  if (inputs.commit && !commit) {
    throw new DogfoodError("the provided commit failed validation");
  }

  const lease = await ensureLease({ serial: inputs.serial, actor, cli });

  let runId;
  let runFailure;
  try {
    const payload = await invokeCli(
      cli,
      buildTestRunArgs({ ...inputs, commit }),
      `test run ${inputs.map} ${inputs.test}`,
    );
    runId = extractRunId(payload);
  } catch (error) {
    runFailure = error;
  }

  if (!runId) {
    // Nothing executed to a verdict: map the CLI exit code (9 = ran and
    // failed before producing a run, anything else = unproven).
    const exitCode =
      runFailure?.cliExitCode === PROOF_EXIT_CODES.fail
        ? PROOF_EXIT_CODES.fail
        : PROOF_EXIT_CODES.unproven;
    return {
      exitCode,
      summary: {
        verdict: exitCode === PROOF_EXIT_CODES.fail ? "fail" : "unproven",
        durationMs: Date.now() - startedAt,
        runId: "(none)",
        leaseId: lease.leaseId,
        leaseCreated: lease.created,
        serverVersion: health.version,
        evidencePaths: [],
        shareLink: "(none)",
        detail: runFailure instanceof Error ? runFailure.message : "test run produced no run id",
      },
    };
  }

  await mkdir(outDir, { recursive: true });
  const emitted = await emitProofReportArtifacts({ runId, cli, outDir });
  const share = await createShareLink({ runId, cli });

  const summary = {
    verdict: emitted.verdict,
    durationMs: Date.now() - startedAt,
    runId,
    leaseId: lease.leaseId,
    leaseCreated: lease.created,
    serverVersion: health.version,
    evidencePaths: emitted.evidencePaths,
    shareLink: shareDisplayLink(share, relayUrl),
    ...(emitted.sharePath ? { reportSharePath: emitted.sharePath } : {}),
    ...(share?.error ? { shareError: share.error } : {}),
  };
  return { exitCode: verdictToExitCode(emitted.verdict), summary };
}

export async function main(argv = process.argv.slice(2)) {
  let inputs;
  try {
    inputs = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return PROOF_EXIT_CODES.unproven;
  }
  try {
    const { exitCode, summary } = await runProofLoop({ inputs });
    printSummary(summary);
    return exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`dogfood-proof-loop: ${message}\n`);
    return error instanceof DogfoodError && error.cliExitCode === PROOF_EXIT_CODES.fail
      ? PROOF_EXIT_CODES.fail
      : PROOF_EXIT_CODES.unproven;
  }
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) process.exitCode = await main();
