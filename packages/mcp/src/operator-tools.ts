import { VISUAL_REVIEW_ACTIONS, type OperationId } from "@relay/protocol";
import * as z from "zod/v4";

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

const controlTargetFields = { serial: identifier.optional(), ...laneFields };

function requireControlTarget(
  value: { serial?: string; lane?: string; laneId?: string },
  context: z.RefinementCtx,
): void {
  if (!value.serial && !value.lane && !value.laneId)
    context.addIssue({ code: "custom", message: "Provide serial or lane." });
  if (value.serial && (value.lane || value.laneId))
    context.addIssue({ code: "custom", message: "Choose serial or lane, not both." });
  if (value.lane && value.laneId && value.lane !== value.laneId)
    context.addIssue({ code: "custom", message: "lane and laneId must match." });
}

const interactTarget = z
  .object({
    ...controlTargetFields,
    identifier: identifier.optional(),
    label: identifier.optional(),
    text: z.string().min(1).optional(),
    x: z.number().optional(),
    y: z.number().optional(),
  })
  .strict()
  .superRefine(requireControlTarget);

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
    'When to use: happy path 1/3 — capture pixels before a tap; missing trees are fine. Then preview/tap, then screenshot again. For a saved Test, use relay_run directly. iOS 17+ needs go-ios tunnel, not target.open. Example: {serial:"RQCY104BG8X"} returns the current PNG.',
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
    z
      .object({ ...controlTargetFields, full: z.boolean().optional() })
      .strict()
      .superRefine(requireControlTarget),
    ro,
  ),
  verb(
    "relay_preview",
    "Preview a tap or swipe",
    'When to use: mark a control on a PNG without committing (returns an image, not a JSON dump). Example: {serial:"RQCY104BG8X",label:"Library"} returns the marked PNG.',
    interactTarget
      .safeExtend({ from: point.optional(), to: point.optional() })
      .superRefine((value, context) => requireTapTarget(value, context, true)),
    ro,
  ),
  verb(
    "relay_tap",
    "Tap a control",
    'When to use: happy path 2/3 — commit one tap after screenshot or preview. Prefer identifier, then label, then text, then point. A missing XCTest runner is not a reason to retry a point tap. Example: {serial:"RQCY104BG8X",label:"Library"}.',
    interactTarget.superRefine((value, context) => requireTapTarget(value, context)),
    rw,
  ),
  verb(
    "relay_type",
    "Type text",
    'When to use: type into the focused field or a named control. Example: {serial:"ipad",text:"hello"}.',
    z
      .object({
        ...controlTargetFields,
        text: z.string(),
        identifier: identifier.optional(),
        label: identifier.optional(),
      })
      .strict()
      .superRefine(requireControlTarget),
    rw,
  ),
  verb(
    "relay_swipe",
    "Swipe",
    'When to use: scroll or dismiss with a gesture. Example: {serial:"ipad",from:{x:200,y:800},to:{x:200,y:200}}.',
    z
      .object({
        ...controlTargetFields,
        from: point,
        to: point,
        durationMs: z.number().int().positive().optional(),
      })
      .strict()
      .superRefine(requireControlTarget),
    rw,
  ),
  verb(
    "relay_recover",
    "Recover the runner",
    'When to use: XCTest/session is down or iOS pixels lost the go-ios tunnel; never reboot. Adopts a healthy live runner and restores the userspace tunnel instead of killing either. Do not recover a ready iPad mid-pack. Example: {serial:"ipad"} adopts the live XCTest runner.',
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
    'When to use: run one saved Test directly when requested; no manual interaction is needed first. Default is one case; pass executionMode all only when asked. wait-for/expect-screen can sit on an unchanged screen. Example: {appMapId:"grok-web",testId:"logged-out-home",lane:"grok-daily"}.',
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
    'When to use: run a saved Plan (every selected case), optionally wait, print findings, and export the review pack. Missing extra sign-ins or devices fail closed as Infra columns, not a smaller Plan. Set triage:"jev" only for additive, read-only OpenRouter sorting of saved findings. Do not start this while tsx watch would reload :8787 mid-pack. Example: {appMapId:"grok-web",combineId:"grok-hourly",lane:"grok-lab",findings:true,triage:"jev",export:true}.',
    z
      .object({
        appMapId: identifier,
        combineId: identifier,
        ...laneFields,
        serial: identifier.optional(),
        browserTargetId: identifier.optional(),
        targetKind: z.enum(["device", "browser"]).optional(),
        executionMode: z.enum(["all"]).optional(),
        findings: z.boolean().optional(),
        triage: z.literal("jev").optional(),
        export: z.boolean().optional(),
        wait: z
          .boolean()
          .optional()
          .describe(
            "Defaults to true. Set false to return job IDs immediately; follow with relay_wait.",
          ),
      })
      .strict()
      .superRefine((value, context) => {
        if (value.wait === false && (value.findings || value.export || value.triage))
          context.addIssue({
            code: "custom",
            message: "With wait:false, fetch findings or export after the jobs finish.",
          });
        if (value.lane && value.laneId && value.lane !== value.laneId)
          context.addIssue({ code: "custom", message: "lane and laneId must match." });
      }),
    rw,
  ),
  verb(
    "relay_wait",
    "Wait for a job",
    'When to use: inspect a job with wait:false, or wait until terminal. A running job is not a failed Test. Example: {jobId:"job-1"} → {type:"result",ok:true,operationId:"job.get",result}.',
    z
      .object({
        jobId: identifier,
        wait: z.boolean().optional(),
        timeoutMs: z.number().int().positive().optional(),
      })
      .strict(),
    ro,
  ),
  verb(
    "relay_findings",
    "Plan findings",
    'When to use: read durable Plan findings for Confirm/Reject (never auto-accepts visuals). Set triage:"jev" only for additive, read-only OpenRouter sorting of saved findings. Example: {batchId:"camp-1",triage:"jev"}.',
    z.object({ batchId: identifier, triage: z.literal("jev").optional() }).strict(),
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
        action: z.enum(VISUAL_REVIEW_ACTIONS),
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
