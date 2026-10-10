import { ApiError } from "@relay/client";
import {
  operationDefinition,
  summarizeExecutionOperationResult,
  type OperationId,
} from "@relay/protocol";
import { createRelayOutcomeJobs } from "@relay/workflows/outcomes";
import { pngScreenshotRecord } from "./png-result.js";
import { relayMcpExclusions, relayMcpTools } from "./tools.js";
import { relayOperatorTools, type RelayOperatorToolDescriptor } from "./operator-tools.js";

type OperationInvoker = {
  invoke(
    operationId: OperationId,
    input: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
};

const terminalJobStatuses = new Set(["ok", "error", "healed", "cancelled"]);
const excludedAdvanced = new Set<string>(relayMcpExclusions.map(({ operationId }) => operationId));

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function laneIdFrom(parsed: Record<string, unknown>): string | undefined {
  if (typeof parsed.laneId === "string" && parsed.laneId.trim()) return parsed.laneId;
  if (typeof parsed.lane === "string" && parsed.lane.trim()) return parsed.lane;
  return undefined;
}

function withLane(
  input: Record<string, unknown>,
  parsed: Record<string, unknown>,
): Record<string, unknown> {
  const laneId = laneIdFrom(parsed);
  return laneId ? { ...input, laneId } : input;
}

/** The serial `target.recover` already accepts. A browser Lane uses its managed target id. */
export function recoverSerialFromLane(
  lane: { target?: { kind?: string; serial?: string; browserTargetId?: string } } | undefined,
  laneId: string,
): string {
  if (!lane?.target) throw new Error(`Lane ${laneId} was not found.`);
  const serial = lane.target.kind === "device" ? lane.target.serial : lane.target.browserTargetId;
  if (!serial) throw new Error(`Lane ${laneId} has no recoverable target.`);
  return serial;
}

function serialFrom(input: Record<string, unknown>): string | undefined {
  if (typeof input.serial === "string" && input.serial.trim()) return input.serial;
  const targetValue = object(input.target);
  if (targetValue?.kind === "device" && typeof targetValue.targetId === "string") {
    return targetValue.targetId;
  }
  if (typeof input.deviceSerial === "string") return input.deviceSerial;
  return undefined;
}

function interactKind(parsed: Record<string, unknown>, preview = false): Record<string, unknown> {
  const base = withLane(
    {
      ...(typeof parsed.serial === "string" ? { serial: parsed.serial } : {}),
      ...(preview ? { preview: true } : {}),
    },
    parsed,
  );
  if (object(parsed.from) && object(parsed.to)) {
    return {
      ...base,
      kind: "swipe",
      from: parsed.from,
      to: parsed.to,
      ...(typeof parsed.durationMs === "number" ? { durationMs: parsed.durationMs } : {}),
    };
  }
  if (typeof parsed.identifier === "string") {
    return { ...base, kind: "identifier", identifier: parsed.identifier };
  }
  if (typeof parsed.label === "string") return { ...base, kind: "label", label: parsed.label };
  if (typeof parsed.text === "string") {
    return { ...base, kind: "text-match", match: parsed.text };
  }
  return { ...base, kind: "point", x: parsed.x, y: parsed.y };
}

function leaseIdFrom(result: unknown): string | undefined {
  const lease = object(object(result)?.lease) ?? object(result);
  return typeof lease?.id === "string" ? lease.id : undefined;
}

function isoTime(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "string" && value.trim()) return value;
  return undefined;
}

function holderFromLease(lease: Record<string, unknown> | undefined): {
  owner: string;
  since: string;
} {
  const owner =
    typeof lease?.ownerId === "string" && lease.ownerId.trim() ? lease.ownerId : "another actor";
  return { owner, since: isoTime(lease?.leasedAt) ?? "unknown" };
}

function heldByError(error: ApiError, owner: string, since: string): ApiError {
  const message = `held by ${owner} since ${since}`;
  const body = object(error.body) ?? {};
  return new ApiError(error.status || 403, message, { ...body, error: message });
}

async function resolveHolder(
  error: ApiError,
  invoker: OperationInvoker,
  serial: string | undefined,
  signal: AbortSignal,
): Promise<{ owner: string; since: string }> {
  const body = object(error.body);
  const active = object(body?.activeLease);
  let owner = typeof active?.ownerId === "string" ? active.ownerId : undefined;
  let since = isoTime(active?.leasedAt);
  if ((owner && since && since !== "unknown") || !serial) {
    return { owner: owner ?? "another actor", since: since ?? "unknown" };
  }
  try {
    const listed = await invoker.invoke("lease.list", { status: "active" }, { signal });
    const leases = object(listed)?.leases;
    const match = Array.isArray(leases)
      ? leases
          .map(object)
          .find(
            (lease) =>
              lease &&
              lease.status === "leased" &&
              (lease.deviceSerial === serial || lease.deviceSerial === undefined),
          )
      : undefined;
    const holder = holderFromLease(match);
    return {
      owner: owner ?? holder.owner,
      since: since ?? holder.since,
    };
  } catch {
    return { owner: owner ?? "another actor", since: since ?? "unknown" };
  }
}

async function invokeWithAutoLease(
  invoker: OperationInvoker,
  operationId: OperationId,
  input: Record<string, unknown>,
  signal: AbortSignal,
): Promise<unknown> {
  const run = (payload: Record<string, unknown>) =>
    invoker.invoke(operationId, payload, { signal });
  try {
    return await run(input);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    const code = object(error.body)?.code;
    const serial = serialFrom(input);
    if (code === "TARGET_CONTROL_LEASE_REQUIRED" && serial) {
      try {
        const created = await invoker.invoke(
          "lease.create",
          { poolId: "local", deviceSerial: serial },
          { signal },
        );
        const leaseId = leaseIdFrom(created);
        const retry = leaseId && typeof input.leaseId !== "string" ? { ...input, leaseId } : input;
        return await run(retry);
      } catch (leaseError) {
        if (
          leaseError instanceof ApiError &&
          leaseError.status === 403 &&
          object(leaseError.body)?.code === "TARGET_CONTROL_LEASE_CONFLICT"
        ) {
          const holder = await resolveHolder(leaseError, invoker, serial, signal);
          throw heldByError(leaseError, holder.owner, holder.since);
        }
        throw leaseError;
      }
    }
    if (error.status === 403 && code === "TARGET_CONTROL_LEASE_CONFLICT") {
      const holder = await resolveHolder(error, invoker, serial, signal);
      throw heldByError(error, holder.owner, holder.since);
    }
    throw error;
  }
}

function jobStatus(result: unknown): string {
  const job = object(object(result)?.job);
  const status = job?.status;
  if (typeof status !== "string") {
    throw new TypeError("Malformed job.get response: expected { job: { status: string } }");
  }
  return status;
}

function startedJobIds(response: unknown): string[] {
  const record = object(response);
  const ids: string[] = [];
  const direct = object(record?.job);
  if (typeof direct?.id === "string") ids.push(direct.id);
  const jobs = record?.jobs;
  if (Array.isArray(jobs)) {
    for (const item of jobs) {
      const job = object(item);
      if (typeof job?.id === "string") ids.push(job.id);
    }
  }
  return [...new Set(ids)];
}

function planBatchId(response: unknown): string | undefined {
  const record = object(response);
  const campaign = object(record?.campaign);
  if (typeof campaign?.id === "string") return campaign.id;
  const batch = object(record?.batch);
  return typeof batch?.id === "string" ? batch.id : undefined;
}

function waitEnvelope(result: unknown): Record<string, unknown> {
  const status = jobStatus(result);
  return {
    type: "result",
    ok: status === "ok" || status === "healed",
    operationId: "job.get",
    result: summarizeExecutionOperationResult("job.get", result),
  };
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) {
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("aborted");
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function waitForJob(
  invoker: OperationInvoker,
  jobId: string,
  signal: AbortSignal,
  pollIntervalMs: number,
  timeoutMs?: number,
): Promise<unknown> {
  const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs;
  while (true) {
    if (signal.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error("aborted");
    }
    if (deadline !== undefined && Date.now() > deadline) {
      throw new TypeError(`relay_wait timed out after ${timeoutMs}ms waiting for ${jobId}`);
    }
    const result = await invoker.invoke("job.get", { jobId }, { signal });
    if (terminalJobStatuses.has(jobStatus(result))) return result;
    await sleep(pollIntervalMs, signal);
  }
}

function pngResult(result: unknown): boolean {
  return pngScreenshotRecord(result) !== undefined;
}

export function operatorResultIsPng(name: string, result: unknown): boolean {
  return (name === "relay_screenshot" || name === "relay_preview") && pngResult(result);
}

async function invokeAdvanced(
  parsed: Record<string, unknown>,
  confirmed: boolean,
  invoker: OperationInvoker,
  signal: AbortSignal,
  profile: string,
): Promise<unknown> {
  const operationId = parsed.operationId as string;
  if (operationId === "lease.takeover" && profile !== "full") {
    throw new TypeError(
      "relay_advanced cannot invoke lease.takeover unless MCP starts with --profile full.",
    );
  }
  if (excludedAdvanced.has(operationId)) {
    const reason =
      relayMcpExclusions.find((item) => item.operationId === operationId)?.reason ??
      "excluded from MCP tools";
    throw new TypeError(`relay_advanced cannot invoke ${operationId}: ${reason}`);
  }
  const descriptor = relayMcpTools.find((tool) => tool.operationId === operationId);
  if (!descriptor) {
    try {
      operationDefinition(operationId as OperationId);
    } catch {
      throw new TypeError(`Unknown Relay operation: ${operationId}`);
    }
    throw new TypeError(`relay_advanced cannot invoke ${operationId}: not an MCP tool`);
  }
  if (descriptor.requiresConfirmation && !confirmed) {
    throw new TypeError(`relay_advanced ${operationId} requires confirm: true.`);
  }
  const input = object(parsed.input) ?? {};
  const validated = descriptor.inputSchema.parse(
    descriptor.requiresConfirmation ? { ...input, confirm: true } : input,
  ) as Record<string, unknown>;
  const { confirm: _confirm, ...operationInput } = validated;
  return summarizeExecutionOperationResult(
    descriptor.operationId,
    await invokeWithAutoLease(invoker, descriptor.operationId, operationInput, signal),
  );
}

/**
 * Validate and dispatch an operator verb. Auto-creates a lease on
 * TARGET_CONTROL_LEASE_REQUIRED and rewrites lease-conflict 403s to held-by copy.
 */
/** One case unless the caller explicitly asks for every selected case. */
export function planRunExecutionMode(mode: unknown): "pilot" | "all" {
  return mode === "all" ? "all" : "pilot";
}

export async function invokeRelayOperatorTool(input: {
  name: RelayOperatorToolDescriptor["name"];
  argumentsValue: Record<string, unknown>;
  confirmed: boolean;
  invoker: OperationInvoker;
  actorId: string;
  signal: AbortSignal;
  profile?: string;
  pollIntervalMs?: number;
}): Promise<unknown> {
  const descriptor = relayOperatorTools.find(({ name }) => name === input.name);
  if (!descriptor) throw new TypeError(`Unknown Relay operator tool: ${input.name}`);
  if (descriptor.requiresConfirmation && !input.confirmed) {
    throw new TypeError(`${descriptor.name} requires confirm: true.`);
  }
  const parsed = descriptor.inputSchema.parse(input.argumentsValue) as Record<string, unknown>;
  const { invoker, signal } = input;
  const pollIntervalMs = input.pollIntervalMs ?? 250;
  const call = (operationId: OperationId, payload: Record<string, unknown>) =>
    invokeWithAutoLease(invoker, operationId, payload, signal);

  if (input.name === "relay_health") return call("system.health.get", {});
  if (input.name === "relay_devices") return call("target.devices.list", {});
  if (input.name === "relay_screenshot") {
    return call(
      "target.screenshot.capture",
      withLane(
        {
          ...(typeof parsed.serial === "string" ? { serial: parsed.serial } : {}),
          ...(typeof parsed.previewX === "number" ? { previewX: parsed.previewX } : {}),
          ...(typeof parsed.previewY === "number" ? { previewY: parsed.previewY } : {}),
        },
        parsed,
      ),
    );
  }
  if (input.name === "relay_snapshot") {
    return call(
      "target.snapshot.capture",
      withLane(
        {
          ...(typeof parsed.serial === "string" ? { serial: parsed.serial } : {}),
          ...(parsed.full === true ? { full: true } : {}),
        },
        parsed,
      ),
    );
  }
  if (input.name === "relay_preview") return call("target.interact", interactKind(parsed, true));
  if (input.name === "relay_tap") return call("target.interact", interactKind(parsed));
  if (input.name === "relay_type") {
    return call("target.interact", {
      ...withLane(typeof parsed.serial === "string" ? { serial: parsed.serial } : {}, parsed),
      kind: "type",
      text: parsed.text,
      ...(typeof parsed.identifier === "string" || typeof parsed.label === "string"
        ? {
            target: {
              ...(typeof parsed.identifier === "string" ? { identifier: parsed.identifier } : {}),
              ...(typeof parsed.label === "string" ? { label: parsed.label } : {}),
            },
          }
        : {}),
    });
  }
  if (input.name === "relay_swipe") {
    return call("target.interact", {
      ...withLane(typeof parsed.serial === "string" ? { serial: parsed.serial } : {}, parsed),
      kind: "swipe",
      from: parsed.from,
      to: parsed.to,
      ...(typeof parsed.durationMs === "number" ? { durationMs: parsed.durationMs } : {}),
    });
  }
  if (input.name === "relay_recover") {
    if (typeof parsed.serial === "string") return call("target.recover", { serial: parsed.serial });
    const laneId = laneIdFrom(parsed);
    if (!laneId) throw new Error("Provide serial or lane.");
    const listed = (await invoker.invoke("lane.list", {}, { signal })) as {
      lanes?: Array<{
        id: string;
        target?: { kind?: string; serial?: string; browserTargetId?: string };
      }>;
    };
    const lane = listed.lanes?.find((item) => item.id === laneId);
    return call("target.recover", { serial: recoverSerialFromLane(lane, laneId) });
  }
  if (input.name === "relay_teach") {
    const teachTarget = parsed.target as { kind: string; targetId: string };
    let leaseId = typeof parsed.leaseId === "string" ? parsed.leaseId : undefined;
    if (!leaseId && teachTarget.kind === "device") {
      const created = await invoker.invoke(
        "lease.create",
        { poolId: "local", deviceSerial: teachTarget.targetId },
        { signal },
      );
      leaseId = leaseIdFrom(created);
    }
    if (!leaseId) throw new TypeError("relay_teach needs leaseId or a device target to auto-lease");
    return call("app-map.teach", {
      appMapId: parsed.appMapId,
      target: parsed.target,
      ...(typeof parsed.expectedRevision === "number"
        ? { expectedRevision: parsed.expectedRevision }
        : {}),
      ...(typeof parsed.fromScreenId === "string" ? { fromScreenId: parsed.fromScreenId } : {}),
      ...(typeof parsed.title === "string" ? { title: parsed.title } : {}),
      ...(typeof parsed.label === "string" ? { label: parsed.label } : {}),
      ...(parsed.interaction !== undefined ? { interaction: parsed.interaction } : {}),
      leaseId,
    });
  }
  if (input.name === "relay_run") {
    return summarizeExecutionOperationResult(
      "app-map.test.run",
      await call(
        "app-map.test.run",
        withLane(
          {
            appMapId: parsed.appMapId,
            testId: parsed.testId,
            ...(typeof parsed.expectedRevision === "number"
              ? { expectedRevision: parsed.expectedRevision }
              : {}),
            ...(parsed.target ? { target: parsed.target } : {}),
            ...(parsed.in ? { in: parsed.in } : {}),
            ...(typeof parsed.lens === "string" ? { lens: parsed.lens } : {}),
            ...(typeof parsed.executionMode === "string"
              ? { executionMode: parsed.executionMode }
              : {}),
          },
          parsed,
        ),
      ),
    );
  }

  if (input.name === "relay_plan_run") {
    const started = await call(
      "job.combine.start",
      withLane(
        {
          appMapId: parsed.appMapId,
          combineId: parsed.combineId,
          executionMode: planRunExecutionMode(parsed.executionMode),
          ...(typeof parsed.serial === "string" ? { serial: parsed.serial } : {}),
          ...(typeof parsed.browserTargetId === "string"
            ? { browserTargetId: parsed.browserTargetId }
            : {}),
          ...(typeof parsed.targetKind === "string" ? { targetKind: parsed.targetKind } : {}),
        },
        parsed,
      ),
    );
    if (parsed.wait === false) {
      return {
        operationId: "job.combine.start",
        status: "started",
        batchId: planBatchId(started),
        jobIds: startedJobIds(started),
        result: summarizeExecutionOperationResult("job.combine.start", started),
        next: "Call relay_wait for each jobId, then relay_findings with batchId. Do not start the Plan again to check progress.",
      };
    }
    const waited: unknown[] = [];
    for (const jobId of startedJobIds(started)) {
      waited.push(await waitForJob(invoker, jobId, signal, pollIntervalMs));
    }
    const batchId = planBatchId(started);
    const findings =
      parsed.findings === true && batchId
        ? await invoker.invoke(
            "job.combine.analysis",
            {
              batchId,
              ...(parsed.triage === "jev" || parsed.triage === "model" ? { triage: "jev" } : {}),
            },
            { signal },
          )
        : undefined;
    const exported =
      parsed.export && batchId
        ? await invoker.invoke("job.combine.export", { batchId }, { signal })
        : undefined;
    const waitedProjected = waited.map((item) =>
      summarizeExecutionOperationResult("job.get", item),
    );
    const lastProjected = waitedProjected.at(-1);
    const lastJob = object(object(lastProjected)?.job) ?? lastProjected;
    const jobs = waitedProjected.flatMap((item) => {
      const job = object(object(item)?.job);
      return job ? [job] : [];
    });
    return {
      type: "result",
      ok: waited.length
        ? waited.every((item) => {
            try {
              const status = jobStatus(item);
              return status === "ok" || status === "healed";
            } catch {
              return false;
            }
          })
        : true,
      operationId: "job.combine.start",
      result: summarizeExecutionOperationResult("job.combine.start", started),
      ...(jobs.length ? { jobs } : {}),
      ...(lastJob ? { job: lastJob } : {}),
      ...(findings !== undefined
        ? { findings: summarizeExecutionOperationResult("job.combine.analysis", findings) }
        : {}),
      ...(exported !== undefined
        ? { export: summarizeExecutionOperationResult("job.combine.export", exported) }
        : {}),
    };
  }
  if (input.name === "relay_wait") {
    if (parsed.wait === false) {
      const result = await invoker.invoke("job.get", { jobId: parsed.jobId }, { signal });
      const status = jobStatus(result);
      if (terminalJobStatuses.has(status)) return waitEnvelope(result);
      return {
        operationId: "job.get",
        jobId: parsed.jobId,
        status,
        terminal: false,
        result: summarizeExecutionOperationResult("job.get", result),
        next: "Inspect this job again with relay_wait; do not start another run.",
      };
    }
    const result = await waitForJob(
      invoker,
      parsed.jobId as string,
      signal,
      pollIntervalMs,
      typeof parsed.timeoutMs === "number" ? parsed.timeoutMs : undefined,
    );
    return waitEnvelope(result);
  }
  if (input.name === "relay_cancel") {
    return invoker.invoke("job.cancel", { jobId: parsed.jobId }, { signal });
  }
  if (input.name === "relay_export") {
    const joined = Array.isArray(parsed.with)
      ? parsed.with.filter((id): id is string => typeof id === "string" && id !== parsed.runId)
      : [];
    return summarizeExecutionOperationResult(
      "run.walkthrough-pack.get",
      await invoker.invoke(
        "run.walkthrough-pack.get",
        { runId: parsed.runId, ...(joined.length ? { with: joined } : {}) },
        { signal },
      ),
    );
  }
  if (input.name === "relay_save") {
    return summarizeExecutionOperationResult(
      "app-map.test.save",
      await call("app-map.test.save", parsed),
    );
  }
  if (input.name === "relay_findings") {
    return summarizeExecutionOperationResult(
      "job.combine.analysis",
      await invoker.invoke(
        "job.combine.analysis",
        {
          batchId: parsed.batchId,
          ...(parsed.triage === "jev" || parsed.triage === "model" ? { triage: "jev" } : {}),
        },
        { signal },
      ),
    );
  }
  if (input.name === "relay_evidence") {
    return summarizeExecutionOperationResult(
      "run.evidence.get",
      await invoker.invoke("run.evidence.get", { runId: parsed.runId }, { signal }),
    );
  }
  if (input.name === "relay_visual_compare") {
    return summarizeExecutionOperationResult(
      "run.visual.compare",
      await invoker.invoke("run.visual.compare", { runId: parsed.runId }, { signal }),
    );
  }
  if (input.name === "relay_visual_review") {
    if (input.actorId.startsWith("agent:")) {
      throw new TypeError(
        "relay_visual_review requires a human actor; agent:* cannot approve or reject visual comparisons.",
      );
    }
    return summarizeExecutionOperationResult(
      "run.visual.review",
      await invoker.invoke(
        "run.visual.review",
        {
          runId: parsed.runId,
          comparisonId: parsed.comparisonId,
          action: parsed.action,
          ...(typeof parsed.note === "string" ? { note: parsed.note } : {}),
        },
        { signal },
      ),
    );
  }
  if (input.name === "relay_goal") {
    const jobs = createRelayOutcomeJobs(
      {
        invoke: (operationId, operationInput) =>
          invoker.invoke(operationId, operationInput as never, { signal }),
      },
      { actorId: input.actorId },
    );
    return jobs.goal({
      kind: "goal-start",
      goal: String(parsed.goal),
      ...(typeof parsed.startUrl === "string" ? { startUrl: parsed.startUrl } : {}),
      ...(typeof parsed.laneId === "string" ? { laneId: parsed.laneId } : {}),
    });
  }
  if (input.name === "relay_lanes") return invoker.invoke("lane.list", {}, { signal });
  return invokeAdvanced(parsed, input.confirmed, invoker, signal, input.profile ?? "operator");
}
