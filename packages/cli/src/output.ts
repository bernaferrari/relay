import type { Writable } from "node:stream";
import type { OutputMode } from "./config.js";
import type { CliError } from "./errors.js";
import type { EventEnvelope } from "@relay/protocol";
import { formatVerifyChangeResult } from "./verify-change-output.js";
import { formatWalkthroughPackResult } from "./walkthrough-output.js";
import { LiveRunView } from "./live-run-view.js";

export type OutputStreams = {
  stdout: Writable;
  stderr: Writable;
};

const SLOW_OPERATIONS = new Set([
  "target.snapshot.capture",
  "target.screenshot.capture",
  "target.interact",
  "target.ground",
  "target.do",
  "target.app.launch",
  "authoring.session.begin",
  "authoring.session.start",
  "authoring.session.stop",
  "authoring.session.interact",
  "authoring.take.replay",
  "app-map.connection.run",
  "app-map.flow.run",
  "app-map.teach",
  "job.combine.start",
  "job.get",
]);

function isSlowOperation(operationId: string): boolean {
  return SLOW_OPERATIONS.has(operationId);
}

function progressMessage(
  operationId: string,
  phase: "invoking" | "following" | "watching",
): string {
  if (phase === "following") return `Following ${operationId}…`;
  if (phase === "watching") return `Waiting on ${operationId}…`;
  if (operationId === "target.snapshot.capture") return "Waiting on accessibility tree…";
  if (operationId === "target.screenshot.capture") return "Waiting on screenshot…";
  if (operationId.startsWith("authoring.")) return "Waiting on device recording…";
  if (operationId === "target.interact" || operationId === "target.app.launch") {
    return "Waiting on device…";
  }
  if (operationId.includes("run") || operationId.includes("matrix")) return "Waiting on run…";
  return `Invoking ${operationId}…`;
}

function line(stream: Writable, value: unknown): void {
  stream.write(`${JSON.stringify(value)}\n`);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function shellArgument(value: string): string {
  return /^[A-Za-z0-9_./:@-]+$/u.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

function recoveryDetails(details: unknown): { message?: string; command?: string } {
  const body = record(details);
  const message = typeof body?.recovery === "string" ? body.recovery : undefined;
  const action = record(body?.recoveryAction);
  const cli = record(action?.cli);
  const argv = Array.isArray(cli?.argv)
    ? cli.argv.filter((value): value is string => typeof value === "string")
    : [];
  return {
    ...(message ? { message } : {}),
    ...(argv.length ? { command: ["relay", ...argv].map(shellArgument).join(" ") } : {}),
  };
}

function isAccountNeedsRelogin(details: unknown): boolean {
  return record(details)?.code === "ACCOUNT_NEEDS_RELOGIN";
}

export class CliOutput {
  /** Last machine envelope written (result or error). Used by `--out`. */
  terminal: unknown;

  constructor(
    private readonly mode: OutputMode,
    private readonly quiet: boolean,
    private readonly streams: OutputStreams,
  ) {}

  progress(operationId: string, phase: "invoking" | "following" | "watching"): void {
    const message = progressMessage(operationId, phase);
    if (this.mode === "ndjson") {
      line(this.streams.stdout, { type: "progress", operationId, phase });
    } else if (!this.quiet && this.mode === "human") {
      this.streams.stderr.write(`${message}\n`);
    } else if (!this.quiet && this.mode === "json" && isSlowOperation(operationId)) {
      this.streams.stderr.write(
        `${JSON.stringify({ type: "progress", operationId, phase, message })}\n`,
      );
    }
  }

  /** A live Test/Plan view for people at a terminal; undefined for machines. */
  liveView(header: { title: string; target?: string }): LiveRunView | undefined {
    if (this.mode !== "human" || this.quiet) return undefined;
    return new LiveRunView(this.streams.stderr as Writable & { isTTY?: boolean }, header);
  }

  heartbeat(message: string): void {
    if (this.quiet) return;
    if (this.mode === "ndjson") {
      line(this.streams.stdout, { type: "progress", phase: "watching", message });
      return;
    }
    this.streams.stderr.write(`${message}\n`);
  }

  /** Compatibility notices stay on stderr so machine-readable result
   * envelopes on stdout remain parseable. */
  deprecation(message: string): void {
    if (!this.quiet) this.streams.stderr.write(`relay: deprecation: ${message}\n`);
  }

  /** One-time notice that a watched job is paused and who can unblock it.
   * JSON/ndjson get it as a stderr progress event; humans get plain text. */
  pausedHint(jobId: string): void {
    if (this.quiet) return;
    const hint = `Job ${jobId} is paused. Resume with: relay job resume ${jobId} (MCP: relay_job_resume)`;
    if (this.mode === "human") {
      this.streams.stderr.write(`${hint}\n`);
      return;
    }
    this.streams.stderr.write(
      `${JSON.stringify({ type: "progress", phase: "paused", message: hint })}\n`,
    );
  }

  snapshot(operationId: string, snapshot: unknown): void {
    if (this.mode === "ndjson") {
      line(this.streams.stdout, { type: "snapshot", operationId, snapshot });
    } else if (!this.quiet && this.mode === "human") {
      const job =
        snapshot && typeof snapshot === "object" && "job" in snapshot
          ? (snapshot as { job?: unknown }).job
          : undefined;
      const id = job && typeof job === "object" && "id" in job ? String(job.id) : "job";
      const status =
        job && typeof job === "object" && "status" in job ? String(job.status) : "unknown";
      let sha: string | undefined;
      if (job && typeof job === "object" && "sourceRevision" in job) {
        const revision = job.sourceRevision;
        if (
          revision &&
          typeof revision === "object" &&
          !Array.isArray(revision) &&
          typeof (revision as Record<string, unknown>).sha === "string"
        ) {
          sha = (revision as Record<string, unknown>).sha as string;
        }
      }
      this.streams.stderr.write(`${id}: ${status}${sha ? ` @ ${sha}` : ""}\n`);
    }
  }

  event(event: EventEnvelope): void {
    if (this.mode === "ndjson") line(this.streams.stdout, { type: "event", event });
    else if (this.mode === "human") line(this.streams.stdout, event);
  }

  binary(value: Uint8Array): void {
    this.streams.stdout.write(value);
  }

  result(operationId: string, result: unknown, ok = true, humanReadable?: string): void {
    const terminal = { type: "result" as const, ok, operationId, result };
    this.terminal = terminal;
    if (this.mode === "json" || this.mode === "ndjson") line(this.streams.stdout, terminal);
    else {
      const readable =
        humanReadable ??
        formatVerifyChangeResult(result) ??
        formatWalkthroughPackResult(result) ??
        formatDoctorResult(result) ??
        formatRunTestSnapshot(result);
      this.streams.stdout.write(`${readable ?? JSON.stringify(result, null, 2)}\n`);
    }
  }

  error(error: CliError, operationId?: string): void {
    const terminal = {
      type: "error",
      ok: false,
      ...(operationId ? { operationId } : {}),
      error: {
        message: error.message,
        exitCode: error.exitCode,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    } as const;
    this.terminal = terminal;
    if (this.mode === "json" || this.mode === "ndjson") line(this.streams.stdout, terminal);
    if (!this.quiet) {
      this.streams.stderr.write(`relay: ${error.message}\n`);
      const recovery = recoveryDetails(error.details);
      if (recovery.message) this.streams.stderr.write(`Recovery: ${recovery.message}\n`);
      if (recovery.command) this.streams.stderr.write(`Try: ${recovery.command}\n`);
      if (isAccountNeedsRelogin(error.details)) {
        this.streams.stderr.write("Completed captures are preserved.\n");
        this.streams.stderr.write("Refresh the sign-in, then resume this activity.\n");
      }
    }
  }
}

export function formatTestCompileResult(value: unknown): string | undefined {
  const result = record(value);
  const plan = record(result?.plan);
  const preflight = record(result?.preflight);
  const summary = record(preflight?.summary);
  if (!plan || !preflight || !summary) return undefined;

  const test = record(plan.test);
  const target = record(plan.runtimeTargetProfile);
  const recipeCount = typeof summary.recipes === "number" ? summary.recipes : 0;
  const checked = typeof summary.checkedSelectors === "number" ? summary.checkedSelectors : 0;
  const resolved = typeof summary.resolvedSelectors === "number" ? summary.resolvedSelectors : 0;
  const blockers = typeof summary.blockers === "number" ? summary.blockers : 0;
  const warnings = typeof summary.warnings === "number" ? summary.warnings : 0;
  const appMapId = typeof plan.appMapId === "string" ? plan.appMapId : "unknown";
  const testId = typeof test?.id === "string" ? test.id : "<testId>";
  const testName = typeof test?.name === "string" ? test.name : testId;
  const revision = typeof plan.appMapRevision === "number" ? plan.appMapRevision : undefined;
  const profileId = typeof target?.id === "string" ? target.id : "not selected";
  const platform = typeof target?.platform === "string" ? target.platform : "unknown platform";
  const targetId = typeof target?.targetId === "string" ? target.targetId : undefined;
  const lines = [
    `Test: ${testName}`,
    `App: ${appMapId}${revision === undefined ? "" : ` (revision ${revision})`}`,
    `Target profile: ${profileId} (${platform})`,
    `Offline plan: ${recipeCount} recipes · ${resolved}/${checked} selectors resolved · ${blockers} blockers · ${warnings} warnings`,
  ];

  const findings = Array.isArray(preflight.findings) ? preflight.findings : [];
  for (const item of findings.slice(0, 5)) {
    const finding = record(item);
    if (!finding) continue;
    const message = typeof finding.message === "string" ? finding.message : undefined;
    const code = typeof finding.code === "string" ? finding.code : undefined;
    if (message || code) lines.push(`- ${message ?? code}`);
  }
  if (findings.length > 5) lines.push(`  …and ${findings.length - 5} more findings`);

  if (blockers > 0) {
    lines.push("Next: resolve the preflight blockers, then compile again before running.");
  } else if (
    targetId &&
    revision !== undefined &&
    (platform === "android" || platform === "ios" || platform === "browser")
  ) {
    const runInput = {
      expectedRevision: revision,
      target: {
        kind: platform === "browser" ? "browser" : "device",
        platform,
        targetId,
      },
      ...(profileId !== "not selected" ? { targetProfileId: profileId } : {}),
    };
    lines.push(
      `Next: run on this target: relay test run ${shellArgument(appMapId)} ${shellArgument(testId)} --input ${shellArgument(JSON.stringify(runInput))}`,
    );
  } else {
    lines.push(
      `Next: select a saved Lane, then run: relay test run ${shellArgument(appMapId)} ${shellArgument(testId)} --lane <lane>`,
    );
  }
  lines.push("Compile is offline; it did not contact the target.");
  return lines.join("\n");
}

function formatDoctorResult(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("kind" in value) || value.kind !== "relay-doctor") {
    return undefined;
  }
  const report = value as {
    server?: unknown;
    message?: unknown;
    cliVersion?: unknown;
    serverVersion?: unknown;
    versionMatch?: unknown;
    doctor?: { ok?: unknown; checks?: Array<{ id?: unknown; ok?: unknown; message?: unknown }> };
    notAccepted?: unknown;
  };
  const lines = ["Relay doctor", `Server: ${String(report.server ?? "unknown")}`];
  if (typeof report.cliVersion === "string") lines.push(`CLI ${report.cliVersion}`);
  if (typeof report.serverVersion === "string") lines.push(`Server ${report.serverVersion}`);
  if (report.versionMatch === false) lines.push("CLI and server versions differ.");
  if (report.versionMatch === true) lines.push("CLI and server versions match.");
  const checks = report.doctor?.checks ?? [];
  if (checks.length) {
    lines.push("", "Checks:");
    for (const check of checks) {
      const state = check.ok === true ? "ok" : "failed";
      lines.push(`- ${String(check.id ?? "check")}: ${state} — ${String(check.message ?? "")}`);
    }
  } else if (typeof report.message === "string" && report.message) {
    lines.push(report.message);
  }
  const pending = Array.isArray(report.notAccepted)
    ? report.notAccepted.filter((item): item is string => typeof item === "string")
    : [];
  if (pending.length) {
    lines.push("", "Not accepted yet:");
    for (const item of pending) lines.push(`- ${item}`);
  }
  return lines.join("\n");
}

function formatRunTestSnapshot(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("kind" in value) || value.kind !== "run-test") {
    return undefined;
  }
  const snapshot = value as {
    title?: unknown;
    phase?: unknown;
    progress?: { label?: unknown; completed?: unknown; total?: unknown };
    review?: { pending?: unknown };
    problems?: Array<{ title?: unknown; detail?: unknown; recovery?: unknown }>;
    frozen?: {
      engine?: unknown;
      account?: { kind?: unknown; accountId?: unknown };
    };
  };
  const lines = [typeof snapshot.title === "string" ? snapshot.title : "Run"];
  const configuration = runConfigurationLine(snapshot.frozen);
  if (configuration) lines.push(configuration);
  if (typeof snapshot.phase === "string") lines.push(snapshot.phase);
  if (typeof snapshot.progress?.label === "string") lines.push(snapshot.progress.label);
  const problem = snapshot.problems?.[0];
  const stopped =
    snapshot.phase === "blocked" ||
    snapshot.phase === "failed" ||
    snapshot.phase === "cancelled" ||
    snapshot.phase === "needs-attention";
  const blocked = stopped && typeof problem?.title === "string" && problem.title.length > 0;
  if (blocked && problem) {
    lines.push(`Could not continue: ${problem.title}`);
    if (typeof problem.detail === "string" && problem.detail) lines.push(problem.detail);
    if (typeof problem.recovery === "string" && problem.recovery) lines.push(problem.recovery);
  }
  const completed = snapshot.progress?.completed;
  const total = snapshot.progress?.total;
  if (
    typeof completed === "number" &&
    typeof total === "number" &&
    Number.isInteger(completed) &&
    Number.isInteger(total) &&
    completed >= 0 &&
    total > 0
  ) {
    const finished = snapshot.phase === "succeeded" || snapshot.phase === "completed";
    const mark = finished && completed === total ? "✓" : "·";
    lines.push(`${mark} ${completed} of ${total}`);
  }
  const pending = typeof snapshot.review?.pending === "number" ? snapshot.review.pending : 0;
  if (pending > 0) {
    lines.push(`${pending} screenshot${pending === 1 ? "" : "s"} awaiting review`);
  }
  return lines.join("\n");
}

function runConfigurationLine(
  frozen:
    | {
        engine?: unknown;
        account?: { kind?: unknown; accountId?: unknown };
      }
    | undefined,
): string | undefined {
  if (!frozen) return undefined;
  const parts: string[] = [];
  if (typeof frozen.engine === "string" && frozen.engine) parts.push(frozen.engine);
  if (frozen.account?.kind === "signed-out") parts.push("Signed out");
  else if (typeof frozen.account?.accountId === "string" && frozen.account.accountId) {
    parts.push(frozen.account.accountId);
  }
  return parts.length ? parts.join(" · ") : undefined;
}
