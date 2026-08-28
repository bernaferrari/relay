import type { Writable } from "node:stream";
import type { OutputMode } from "./config.js";
import type { CliError } from "./errors.js";
import type { EventEnvelope } from "@relay/protocol";
import { formatVerifyChangeResult } from "./verify-change-output.js";

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

export class CliOutput {
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

  heartbeat(message: string): void {
    if (this.quiet) return;
    if (this.mode === "ndjson") {
      line(this.streams.stdout, { type: "progress", phase: "watching", message });
      return;
    }
    this.streams.stderr.write(`${message}\n`);
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

  result(operationId: string, result: unknown): void {
    const terminal = { type: "result", ok: true, operationId, result } as const;
    if (this.mode === "json" || this.mode === "ndjson") line(this.streams.stdout, terminal);
    else {
      const verifyChange = formatVerifyChangeResult(result);
      this.streams.stdout.write(`${verifyChange ?? JSON.stringify(result, null, 2)}\n`);
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
    if (this.mode === "json" || this.mode === "ndjson") line(this.streams.stdout, terminal);
    if (!this.quiet) {
      this.streams.stderr.write(`relay: ${error.message}\n`);
      const recovery = recoveryDetails(error.details);
      if (recovery.message) this.streams.stderr.write(`Recovery: ${recovery.message}\n`);
      if (recovery.command) this.streams.stderr.write(`Try: ${recovery.command}\n`);
    }
  }
}
