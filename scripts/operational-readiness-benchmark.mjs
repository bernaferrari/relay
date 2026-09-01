#!/usr/bin/env node
import { execFile as nodeExecFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(nodeExecFile);
const MAX_DIAGNOSTIC_CHARS = 8_000;

export class OperationalBenchmarkStageError extends Error {
  constructor(code, message, { command, nextAction, stdout, stderr, exitCode } = {}) {
    super(message);
    this.name = "OperationalBenchmarkStageError";
    this.code = code;
    this.command = command;
    this.nextAction = nextAction;
    this.stdout = stdout;
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

function boundedTail(value) {
  const text = String(value ?? "").trim();
  return text.length <= MAX_DIAGNOSTIC_CHARS
    ? text
    : `[truncated ${text.length - MAX_DIAGNOSTIC_CHARS} chars]\n${text.slice(-MAX_DIAGNOSTIC_CHARS)}`;
}

function diagnostic(error) {
  const known = error instanceof OperationalBenchmarkStageError;
  return {
    code: known ? error.code : "UNEXPECTED_STAGE_FAILURE",
    message: error instanceof Error ? error.message : String(error),
    ...(known && error.command ? { command: error.command } : {}),
    ...(known && error.nextAction ? { nextAction: error.nextAction } : {}),
    ...(known && Number.isInteger(error.exitCode) ? { exitCode: error.exitCode } : {}),
    ...(known && error.stdout ? { stdoutTail: boundedTail(error.stdout) } : {}),
    ...(known && error.stderr ? { stderrTail: boundedTail(error.stderr) } : {}),
  };
}

async function runStage(id, title, action, clock) {
  const startedAt = clock.now();
  try {
    const result = await action();
    const finishedAt = clock.now();
    return {
      id,
      title,
      status: result.status ?? "passed",
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      evidence: result.evidence ?? {},
      ...(result.reason ? { reason: result.reason } : {}),
    };
  } catch (error) {
    const finishedAt = clock.now();
    return {
      id,
      title,
      status: "failed",
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      evidence: {},
      diagnostic: diagnostic(error),
    };
  }
}

function skippedStage(id, title, reason, at) {
  return {
    id,
    title,
    status: "skipped",
    startedAt: at,
    finishedAt: at,
    durationMs: 0,
    evidence: {},
    reason,
  };
}

const EXTERNAL_ACCEPTANCE = [
  {
    id: "unfamiliar-users",
    status: "not-measured",
    requiredEvidence:
      "Five unfamiliar mobile developers complete the golden loop with observed timing and recovery notes.",
    reason:
      "This automated harness has no human participants and never fabricates comprehension or completion results.",
  },
  {
    id: "physical-ios-retained-history",
    status: "not-measured",
    requiredEvidence: "Reviewed retained iOS lane history from physical hardware.",
    reason: "No physical iOS device is controlled by the benchmark harness.",
  },
  {
    id: "physical-android-retained-history",
    status: "not-measured",
    requiredEvidence:
      "Reviewed retained Android lane history from physical hardware or the approved retained lane.",
    reason: "The first-Proof benchmark is device-free and cannot claim retained hardware health.",
  },
  {
    id: "ci-green",
    status: "not-measured",
    requiredEvidence: "The repository CI run for the benchmarked commit completes successfully.",
    reason: "Local execution cannot assert the external CI provider result.",
  },
];

export async function runOperationalReadinessBenchmark({
  clock = { now: () => performance.now() },
  environment,
  actions,
}) {
  const startedAt = clock.now();
  const stages = [];
  const clean = await runStage(
    "clean-install",
    "Install dependencies in a fresh Git worktree",
    actions.cleanInstall,
    clock,
  );
  stages.push(clean);
  if (clean.status !== "failed") {
    stages.push(
      await runStage(
        "first-proof",
        "Run the deterministic first-Proof golden loop",
        actions.firstProof,
        clock,
      ),
    );
    stages.push(
      await runStage(
        "watch-restart-lease-recovery",
        "Verify stale lease and watched-restart recovery policy",
        actions.leaseRecovery,
        clock,
      ),
    );
  } else {
    const at = clock.now();
    const reason = "Blocked because the clean-install stage did not pass.";
    stages.push(
      skippedStage("first-proof", "Run the deterministic first-Proof golden loop", reason, at),
    );
    stages.push(
      skippedStage(
        "watch-restart-lease-recovery",
        "Verify stale lease and watched-restart recovery policy",
        reason,
        at,
      ),
    );
  }
  const finishedAt = clock.now();
  if (
    ![
      startedAt,
      finishedAt,
      ...stages.flatMap((stage) => [stage.startedAt, stage.finishedAt]),
    ].every(Number.isFinite) ||
    finishedAt < startedAt ||
    stages.some((stage) => stage.finishedAt < stage.startedAt)
  ) {
    throw new Error("Operational benchmark clock must return finite, monotonic timestamps");
  }
  const hasFailure = stages.some(({ status }) => status === "failed");
  const incomplete = stages.some(({ status }) => status === "skipped");
  const automationStatus = hasFailure ? "failed" : incomplete ? "incomplete" : "passed";
  return {
    schemaVersion: 1,
    kind: "relay-operational-readiness-benchmark",
    status: hasFailure ? "failed" : "incomplete",
    automationStatus,
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    environment,
    stages,
    externalAcceptance: EXTERNAL_ACCEPTANCE,
    operatorSummary: {
      failedStageIds: stages.filter(({ status }) => status === "failed").map(({ id }) => id),
      nextActions: stages.flatMap((stage) =>
        stage.diagnostic?.nextAction ? [stage.diagnostic.nextAction] : [],
      ),
      reportIsMergeEvidence: false,
      explanation:
        "Local automation has its own status. Overall readiness remains incomplete until hardware history, unfamiliar-user outcomes, and CI are evidenced externally.",
    },
  };
}

async function command(executable, args, options, failure) {
  try {
    const result = await execFile(executable, args, {
      cwd: options.cwd,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      env: options.env ?? process.env,
    });
    return { stdout: String(result.stdout), stderr: String(result.stderr) };
  } catch (error) {
    throw new OperationalBenchmarkStageError(failure.code, failure.message, {
      command: [executable, ...args],
      nextAction: failure.nextAction,
      stdout: error.stdout,
      stderr: error.stderr,
      exitCode: error.code,
    });
  }
}

function parseArguments(argv) {
  let output;
  let reuseWorkspace = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--reuse-workspace") reuseWorkspace = true;
    else if (argument === "--output") {
      output = argv[++index];
      if (!output) throw new Error("--output requires a path");
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return { output, reuseWorkspace };
}

async function main(argv) {
  const options = parseArguments(argv);
  const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const git = await command(
    "git",
    ["rev-parse", "--show-toplevel"],
    { cwd: scriptRoot },
    {
      code: "WORKSPACE_NOT_GIT",
      message: "The benchmark must run from a Git repository.",
      nextAction: "Open the Relay repository and run the benchmark again.",
    },
  );
  const root = git.stdout.trim();
  const commitSha = (
    await command(
      "git",
      ["rev-parse", "HEAD"],
      { cwd: root },
      {
        code: "COMMIT_UNAVAILABLE",
        message: "The benchmark could not resolve the current commit.",
        nextAction: "Create a commit, then run the benchmark against that immutable revision.",
      },
    )
  ).stdout.trim();
  const dirty = Boolean(
    (
      await command(
        "git",
        ["status", "--porcelain"],
        { cwd: root },
        {
          code: "GIT_STATUS_FAILED",
          message: "The benchmark could not inspect repository status.",
          nextAction: "Repair Git status inspection, then rerun the benchmark.",
        },
      )
    ).stdout.trim(),
  );
  let benchmarkRoot = root;
  let temporaryParent;
  if (!options.reuseWorkspace) {
    temporaryParent = await mkdtemp(join(tmpdir(), "relay-operational-benchmark-"));
    benchmarkRoot = join(temporaryParent, "worktree");
  }
  const vp = process.env.RELAY_VP_BIN?.trim() || "vp";
  const actions = {
    cleanInstall: async () => {
      if (options.reuseWorkspace) {
        return {
          status: "skipped",
          reason: "--reuse-workspace was selected; this run does not claim a clean installation.",
          evidence: { kind: "existing-workspace", root: benchmarkRoot },
        };
      }
      await command(
        "git",
        ["worktree", "add", "--detach", benchmarkRoot, commitSha],
        { cwd: root },
        {
          code: "CLEAN_WORKTREE_FAILED",
          message: "Could not create the isolated clean-install worktree.",
          nextAction: "Run git worktree prune, verify disk space, and rerun the benchmark.",
        },
      );
      await command(
        vp,
        ["install", "--frozen-lockfile"],
        { cwd: benchmarkRoot },
        {
          code: "CLEAN_INSTALL_FAILED",
          message: "Dependency installation failed in the isolated worktree.",
          nextAction:
            "Run vp env doctor and vp install --frozen-lockfile in the reported worktree.",
        },
      );
      return {
        evidence: {
          kind: "fresh-git-worktree",
          commitSha,
          command: [vp, "install", "--frozen-lockfile"],
        },
      };
    },
    firstProof: async () => {
      const test = "packages/core/src/change-proof-golden-harness.test.ts";
      await command(
        process.execPath,
        ["node_modules/tsx/dist/cli.mjs", "--test", test],
        { cwd: benchmarkRoot },
        {
          code: "FIRST_PROOF_FAILED",
          message: "The deterministic first-Proof loop failed after clean installation.",
          nextAction:
            "Run the golden harness test in the benchmark worktree and inspect the first failed step.",
        },
      );
      return {
        evidence: {
          kind: "device-free-golden-proof-test",
          test,
          assertedOutcomes: {
            brokenHead: "rejected",
            repairedHead: "proved",
            failedGoldenSteps: 0,
          },
          runtimeScope: "test-process",
        },
      };
    },
    leaseRecovery: async () => {
      await command(
        process.execPath,
        [
          "--test",
          "scripts/ensure-server-lease-recovery.test.mjs",
          "scripts/ensure-server-bootstrap.test.mjs",
        ],
        { cwd: benchmarkRoot },
        {
          code: "LEASE_RECOVERY_ACCEPTANCE_FAILED",
          message: "Deterministic watched-restart and stale-lease acceptance failed.",
          nextAction:
            "Run the two named lease/bootstrap tests and inspect the refusal or reacquisition case before restarting Relay.",
        },
      );
      return {
        evidence: {
          kind: "deterministic-policy-tests",
          liveWatchRestartMeasured: false,
          tests: [
            "scripts/ensure-server-lease-recovery.test.mjs",
            "scripts/ensure-server-bootstrap.test.mjs",
          ],
        },
      };
    },
  };
  let report;
  try {
    report = await runOperationalReadinessBenchmark({
      environment: {
        commitSha,
        workingTreeDirty: dirty,
        mode: options.reuseWorkspace ? "reuse-workspace" : "fresh-worktree",
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
      },
      actions,
    });
  } finally {
    if (temporaryParent) {
      await command(
        "git",
        ["worktree", "remove", "--force", benchmarkRoot],
        { cwd: root },
        {
          code: "WORKTREE_CLEANUP_FAILED",
          message: "The benchmark worktree could not be removed.",
          nextAction: `Run git worktree remove --force ${benchmarkRoot}, then git worktree prune.`,
        },
      ).catch((error) => process.stderr.write(`${error.message}\n`));
      await rm(temporaryParent, { recursive: true, force: true });
    }
  }
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) {
    const output = resolve(root, options.output);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, serialized, "utf8");
  }
  process.stdout.write(serialized);
  process.exitCode = report.status === "failed" ? 1 : 0;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
