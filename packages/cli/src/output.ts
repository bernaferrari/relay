import type { Writable } from "node:stream";
import type { OutputMode } from "./config.js";
import type { CliError } from "./errors.js";
import type { EventEnvelope } from "@relay/protocol";

export type OutputStreams = {
  stdout: Writable;
  stderr: Writable;
};

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
    if (this.mode === "ndjson") {
      line(this.streams.stdout, { type: "progress", operationId, phase });
    } else if (!this.quiet && this.mode === "human") {
      const verb =
        phase === "following" ? "Following" : phase === "watching" ? "Watching" : "Invoking";
      this.streams.stderr.write(`${verb} ${operationId}…\n`);
    }
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
      this.streams.stderr.write(`${id}: ${status}\n`);
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
    else this.streams.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
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
