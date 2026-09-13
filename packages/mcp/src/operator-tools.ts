import { ApiError } from "@relay/client";
import { operationDefinition, type OperationId } from "@relay/protocol";
import * as z from "zod/v4";
import { relayMcpExclusions, relayMcpTools } from "./tools.js";

type OperationInvoker = {
  invoke(
    operationId: OperationId,
    input: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
};

type OperatorInputSchema = z.ZodType<Record<string, unknown>>;

export type RelayOperatorToolDescriptor = {
  readonly name: `relay_${string}`;
  readonly title: string;
  readonly description: string;
  readonly requiresConfirmation: boolean;
  readonly inputSchema: OperatorInputSchema;
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly destructiveHint: boolean;
    readonly idempotentHint: boolean;
    readonly openWorldHint: false;
  };
};

const identifier = z.string().trim().min(1);
const point = z.object({ x: z.number(), y: z.number() }).strict();
const target = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("device"),
      platform: z.enum(["android", "ios"]),
      targetId: identifier,
    })
    .strict(),
  z
    .object({
      kind: z.literal("browser"),
      platform: z.literal("browser"),
      targetId: identifier,
    })
    .strict(),
]);
const laneFields = {
  lane: identifier.optional().describe("Saved Lane id; passed through as laneId"),
  laneId: identifier.optional().describe("Saved Lane id"),
};
const ro = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false as const,
};
const rw = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false as const,
};

function verb(
  name: `relay_${string}`,
  title: string,
  description: string,
  inputSchema: OperatorInputSchema,
  annotations: RelayOperatorToolDescriptor["annotations"],
  requiresConfirmation = false,
): RelayOperatorToolDescriptor {
  return Object.freeze({
    name,
    title,
    description,
    requiresConfirmation,
    inputSchema,
    annotations,
  });
}

const interactTarget = z
  .object({
    serial: identifier,
    identifier: identifier.optional(),
    label: identifier.optional(),
    text: z.string().min(1).optional(),
    x: z.number().optional(),
    y: z.number().optional(),
  })
  .strict();

function requireTapTarget(
  value: {
    identifier?: string;
    label?: string;
    text?: string;
    x?: number;
    y?: number;
    from?: { x: number; y: number };
    to?: { y: number; x: number };
  },
  context: z.RefinementCtx,
  swipe = false,
): void {
  if (swipe && value.from && value.to) return;
  if (value.identifier || value.label || value.text) return;
  if (typeof value.x === "number" && typeof value.y === "number") return;
  context.addIssue({
    code: "custom",
    message: swipe
      ? "Provide from and to, or identifier/label/text/x+y"
      : "Provide identifier, label, text, or x and y",
  });
}

export const relayOperatorTools = Object.freeze([
  verb(
    "relay_health",
    "Relay health",
    "When to use: check the local Relay server is up before other verbs. Example: {} → {ok, pid, startedAt}.",
    z.object({}).strict(),
    ro,
  ),
  verb(
    "relay_devices",
    "List devices",
    "When to use: see connected phones, tablets, and emulators. Example: {} → {devices:[{serial, platform, booted}]}.",
    z.object({}).strict(),
    ro,
  ),
  verb(
    "relay_screenshot",
    "Capture screenshot",
    'When to use: capture pixels before a tap; missing trees are fine. Example: {serial:"ipad"} returns the current PNG.',
    z
      .object({
        serial: identifier,
        previewX: z.number().optional(),
        previewY: z.number().optional(),
      })
      .strict(),
    ro,
  ),
  verb(
    "relay_snapshot",
    "Capture snapshot",
    'When to use: read app/header/controls digest; do not retry if the tree is missing. Example: {serial:"ipad"} → digest; pass full:true for nodes.',
    z.object({ serial: identifier, full: z.boolean().optional() }).strict(),
    ro,
  ),
  verb(
    "relay_preview",
    "Preview a tap or swipe",
    'When to use: mark a control on a PNG without committing. Example: {serial:"ipad",label:"Back"} returns the marked PNG path/image.',
    interactTarget
      .safeExtend({ from: point.optional(), to: point.optional() })
      .superRefine((value, context) => requireTapTarget(value, context, true)),
    ro,
  ),
  verb(
    "relay_tap",
    "Tap a control",
    'When to use: commit one tap after screenshot or preview. Prefer identifier, then label, then text, then point. Example: {serial:"ipad",label:"Back"}.',
    interactTarget.superRefine((value, context) => requireTapTarget(value, context)),
    rw,
  ),
  verb(
    "relay_type",
    "Type text",
    'When to use: type into the focused field or a named control. Example: {serial:"ipad",text:"hello"}.',
    z
      .object({
        serial: identifier,
        text: z.string(),
        identifier: identifier.optional(),
        label: identifier.optional(),
      })
      .strict(),
    rw,
  ),
  verb(
    "relay_swipe",
    "Swipe",
    'When to use: scroll or dismiss with a gesture. Example: {serial:"ipad",from:{x:200,y:800},to:{x:200,y:200}}.',
    z
      .object({
        serial: identifier,
        from: point,
        to: point,
        durationMs: z.number().int().positive().optional(),
      })
      .strict(),
    rw,
  ),
  verb(
    "relay_recover",
    "Recover the runner",
    'When to use: XCTest/session is down; never reboot the device. Example: {serial:"ipad"} remounts the runner.',
    z.object({ serial: identifier }).strict(),
    rw,
  ),
  verb(
    "relay_teach",
    "Teach a new screen",
    'When to use: only after identity actually changed (new fingerprint); do not teach a toggle. Example: {appMapId:"grok-ios",target:{kind:"device",platform:"ios",targetId:"ipad"},title:"Settings"}.',
    z
      .object({
        appMapId: identifier,
        target,
        expectedRevision: z.number().int().nonnegative().optional(),
        fromScreenId: identifier.optional(),
        title: identifier.optional(),
        label: identifier.optional(),
        leaseId: identifier.optional(),
        interaction: z.unknown().optional(),
      })
      .strict(),
    rw,
  ),
  verb(
    "relay_run",
    "Run a Test",
    'When to use: run one saved Test; pass lane/laneId instead of assembling profileTargets. Example: {appMapId:"grok-web",testId:"logged-out-home",lane:"grok-daily"}.',
    z
      .object({
        appMapId: identifier,
        testId: identifier,
        expectedRevision: z.number().int().nonnegative().optional(),
        target: target.optional(),
        ...laneFields,
        in: z.record(z.string(), z.array(identifier).min(1)).optional(),
        lens: z
          .enum(["visual", "smoke", "every-screen", "failures-only", "final-screen", "none"])
          .optional(),
        executionMode: z.enum(["pilot", "all"]).optional(),
      })
      .strict(),
    rw,
  ),
  verb(
    "relay_plan_run",
    "Run a Plan",
    'When to use: run a saved Plan (Combine), optionally wait, print findings, and export the review pack. Example: {appMapId:"grok-web",combineId:"grok-hourly",lane:"grok-lab",findings:true,export:true}.',
    z
      .object({
        appMapId: identifier,
        combineId: identifier,
        ...laneFields,
        serial: identifier.optional(),
        browserTargetId: identifier.optional(),
        targetKind: z.enum(["device", "browser"]).optional(),
        executionMode: z.enum(["pilot", "all"]).optional(),
        findings: z.boolean().optional(),
        export: z.union([z.boolean(), identifier]).optional(),
      })
      .strict(),
    rw,
  ),
  verb(
    "relay_wait",
    "Wait for a job",
    'When to use: poll until a job is terminal and return the CLI JSON envelope. Example: {jobId:"job-1"} → {type:"result",ok:true,operationId:"job.get",result}.',
    z.object({ jobId: identifier, timeoutMs: z.number().int().positive().optional() }).strict(),
    ro,
  ),
  verb(
    "relay_findings",
    "Plan findings",
    'When to use: read durable Combine findings for Confirm/Reject (never auto-accepts visuals). Example: {batchId:"camp-1"}.',
    z.object({ batchId: identifier }).strict(),
    ro,
  ),
  verb(
    "relay_evidence",
    "Run evidence",
    'When to use: read immutable evidence for one persisted Run. Example: {runId:"run-1"}.',
    z.object({ runId: identifier }).strict(),
    ro,
  ),
  verb(
    "relay_visual_compare",
    "Compare visuals",
    'When to use: compute a visual comparison for a Run before human review. Example: {runId:"run-1"}.',
    z.object({ runId: identifier }).strict(),
    ro,
  ),
  verb(
    "relay_visual_review",
    "Review visuals",
    'When to use: a human approves or rejects a visual comparison; agents must not call this. Example: {runId:"run-1",comparisonId:"cmp-1",action:"approve-new-baseline",confirm:true} as actor human:local-cli.',
    z
      .object({
        runId: identifier,
        comparisonId: identifier,
        action: z.enum([
          "approve-new-baseline",
          "keep-baseline",
          "fix-connection",
          "retry",
          "mark-expected-variation",
        ]),
        note: z.string().optional(),
      })
      .strict(),
    { ...rw, destructiveHint: false },
    true,
  ),
  verb(
    "relay_lanes",
    "List Lanes",
    "When to use: list saved who+where overlays before relay_run / relay_plan_run. Example: {} → {lanes:[{id,appMapId,target}]}. Also read relay://lanes.",
    z.object({}).strict(),
    ro,
  ),
  verb(
    "relay_advanced",
    "Advanced operation",
    'When to use: one escape hatch for a canonical operationId not covered above. Example: {operationId:"app-map.list",input:{}}. lease.takeover is refused unless --profile full.',
    z
      .object({
        operationId: identifier.describe("Canonical dotted operation id"),
        input: z.record(z.string(), z.unknown()),
      })
      .strict(),
    rw,
  ),
] as const satisfies readonly RelayOperatorToolDescriptor[]);

export const relayOperatorToolNames = relayOperatorTools.map(({ name }) => name);

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
  const serial = parsed.serial as string;
  const base: Record<string, unknown> = preview ? { serial, preview: true } : { serial };
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
        if (leaseError instanceof ApiError && leaseError.status === 403) {
          const holder = await resolveHolder(leaseError, invoker, serial, signal);
          throw heldByError(leaseError, holder.owner, holder.since);
        }
        throw leaseError;
      }
    }
    if (error.status === 403) {
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
    result,
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
  const record = object(result);
  return record?.mime === "image/png" && typeof record.base64 === "string";
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
  return invokeWithAutoLease(invoker, descriptor.operationId, input, signal);
}

/**
 * Validate and dispatch an operator verb. Auto-creates a lease on
 * TARGET_CONTROL_LEASE_REQUIRED and rewrites other 403s to held-by copy.
 */
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
    return call("target.screenshot.capture", {
      serial: parsed.serial,
      ...(typeof parsed.previewX === "number" ? { previewX: parsed.previewX } : {}),
      ...(typeof parsed.previewY === "number" ? { previewY: parsed.previewY } : {}),
    });
  }
  if (input.name === "relay_snapshot") {
    return call("target.snapshot.capture", {
      serial: parsed.serial,
      ...(parsed.full === true ? { full: true } : {}),
    });
  }
  if (input.name === "relay_preview") return call("target.interact", interactKind(parsed, true));
  if (input.name === "relay_tap") return call("target.interact", interactKind(parsed));
  if (input.name === "relay_type") {
    return call("target.interact", {
      serial: parsed.serial,
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
      serial: parsed.serial,
      kind: "swipe",
      from: parsed.from,
      to: parsed.to,
      ...(typeof parsed.durationMs === "number" ? { durationMs: parsed.durationMs } : {}),
    });
  }
  if (input.name === "relay_recover") return call("target.recover", { serial: parsed.serial });
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
    return call(
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
    );
  }
  if (input.name === "relay_plan_run") {
    const started = await call(
      "job.combine.start",
      withLane(
        {
          appMapId: parsed.appMapId,
          combineId: parsed.combineId,
          executionMode: parsed.executionMode === "pilot" ? "pilot" : "all",
          ...(typeof parsed.serial === "string" ? { serial: parsed.serial } : {}),
          ...(typeof parsed.browserTargetId === "string"
            ? { browserTargetId: parsed.browserTargetId }
            : {}),
          ...(typeof parsed.targetKind === "string" ? { targetKind: parsed.targetKind } : {}),
        },
        parsed,
      ),
    );
    const waited: unknown[] = [];
    for (const jobId of startedJobIds(started)) {
      waited.push(await waitForJob(invoker, jobId, signal, pollIntervalMs));
    }
    const batchId = planBatchId(started);
    const findings =
      parsed.findings === true && batchId
        ? await invoker.invoke("job.combine.analysis", { batchId }, { signal })
        : undefined;
    const exported =
      parsed.export && batchId
        ? await invoker.invoke("job.combine.export", { batchId }, { signal })
        : undefined;
    const last = waited.at(-1);
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
      result: started,
      ...(last ? { job: object(object(last)?.job) ?? last } : {}),
      ...(findings !== undefined ? { findings } : {}),
      ...(exported !== undefined ? { export: exported } : {}),
    };
  }
  if (input.name === "relay_wait") {
    const result = await waitForJob(
      invoker,
      parsed.jobId as string,
      signal,
      pollIntervalMs,
      typeof parsed.timeoutMs === "number" ? parsed.timeoutMs : undefined,
    );
    return waitEnvelope(result);
  }
  if (input.name === "relay_findings") {
    return invoker.invoke("job.combine.analysis", { batchId: parsed.batchId }, { signal });
  }
  if (input.name === "relay_evidence") {
    return invoker.invoke("run.evidence.get", { runId: parsed.runId }, { signal });
  }
  if (input.name === "relay_visual_compare") {
    return invoker.invoke("run.visual.compare", { runId: parsed.runId }, { signal });
  }
  if (input.name === "relay_visual_review") {
    if (input.actorId.startsWith("agent:")) {
      throw new TypeError(
        "relay_visual_review requires a human actor; agent:* cannot approve or reject visual comparisons.",
      );
    }
    return invoker.invoke(
      "run.visual.review",
      {
        runId: parsed.runId,
        comparisonId: parsed.comparisonId,
        action: parsed.action,
        ...(typeof parsed.note === "string" ? { note: parsed.note } : {}),
      },
      { signal },
    );
  }
  if (input.name === "relay_lanes") return invoker.invoke("lane.list", {}, { signal });
  return invokeAdvanced(parsed, input.confirmed, invoker, signal, input.profile ?? "operator");
}
