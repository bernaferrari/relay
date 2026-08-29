import * as z from "zod/v4";
import { browserCaseProfileSchema, browserEnvironmentInputSchema } from "./browser-case-profile.js";
import {
  browserDeviceBinaryFrameMetadataSchema,
  browserDeviceFrameSchema,
  browserDeviceInputResolutionSchema,
  browserDeviceSemanticOverlaySchema,
  browserDeviceSessionSchema,
} from "./browser-device.js";

const text = z.string().min(1);
const natural = z.number().int().nonnegative();
const actorKind = z.enum(["human", "agent", "system"]);
const point = z.object({ x: z.number(), y: z.number() }).strict();
const bounds = z
  .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
  .strict();
const ok = z.object({ ok: z.literal(true) }).strict();

const diagnostic = z
  .object({
    id: text,
    ok: z.boolean(),
    message: z.string(),
  })
  .strict();

const auditEvent = z
  .object({
    at: natural,
    subject: text,
    actorId: text.optional(),
    organizationId: text,
    projectId: text,
    action: text,
    resource: z.string().optional(),
    target: z.string().optional(),
    result: z.enum(["allow", "deny"]),
  })
  .strict();

const activityRecord = z
  .object({
    schemaVersion: z.literal(1),
    organizationId: text,
    projectId: text,
    activityId: text,
    actorId: text,
    actorKind,
    operationId: text,
    requestId: text,
    timestamp: natural,
    eventType: text,
    resourceKind: text,
    resourceId: text,
    summary: text,
    correlationId: text.optional(),
    causationId: text.optional(),
    sessionId: text.optional(),
    leaseId: text.optional(),
    beforeRevision: natural.optional(),
    afterRevision: natural.optional(),
    evidenceIds: z.array(text).optional(),
    outcome: z.enum(["succeeded", "failed", "cancelled"]).optional(),
    durationMs: natural.optional(),
    statusCode: z.number().int().min(100).max(599).optional(),
    errorCode: text.optional(),
  })
  .strict();

const appleDeviceSetup = z
  .object({
    teamId: text,
    bundleId: text,
    signingIdentity: text.optional(),
    provisioningProfile: text.optional(),
  })
  .strict();
const deviceSetup = z
  .object({
    version: z.literal(1),
    ios: appleDeviceSetup.optional(),
    iosLivePreview: z
      .object({
        backend: z.enum(["agent-device-png", "go-ios-auto", "go-ios-mjpeg"]),
      })
      .strict()
      .optional(),
  })
  .strict();

const targetCapability = z.enum([
  "snapshot",
  "screenshot",
  "stream",
  "recording",
  "tap",
  "type",
  "scroll",
  "clipboard",
  "network",
  "logs",
  "permissions",
  "location",
  "rotation",
  "lock-screen",
  "app-switcher",
  "install",
  "launch",
]);

const viewport = z.object({ width: z.number().positive(), height: z.number().positive() }).strict();
const targetDefinition = z
  .object({
    id: text,
    name: text,
    kind: z.enum(["android", "ios", "browser"]),
    createdAt: natural,
    updatedAt: natural,
    browser: z
      .object({
        startUrl: z.url(),
        executablePath: text.optional(),
        headless: z.boolean().optional(),
        viewport: viewport.optional(),
        environment: browserEnvironmentInputSchema.optional(),
        profileRetention: z.enum(["retain", "ephemeral"]).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const targetPreflight = z
  .object({
    targetId: text,
    ok: z.boolean(),
    checkedAt: natural,
    capabilities: z.array(targetCapability),
    checks: z.array(
      z
        .object({
          id: text,
          label: text,
          status: z.enum(["pass", "warning", "fail"]),
          message: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

const interactInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("identifier"), identifier: text, point: point.optional() }).strict(),
  z.object({ kind: z.literal("label"), label: text, point: point.optional() }).strict(),
  z.object({ kind: z.literal("point"), x: z.number(), y: z.number() }).strict(),
  z.object({ kind: z.literal("ref"), ref: text }).strict(),
  z.object({ kind: z.literal("find"), query: text, point: point.optional() }).strict(),
  z.object({ kind: z.literal("text-match"), match: text, point: point.optional() }).strict(),
  z
    .object({
      kind: z.literal("swipe"),
      from: point,
      to: point,
      durationMs: z.number().min(50).max(5_000).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("key"),
      key: z.enum(["enter", "backspace", "back", "home"]),
    })
    .strict(),
  z.object({ kind: z.literal("type"), text: z.string() }).strict(),
  z
    .object({
      kind: z.literal("replace"),
      target: z
        .object({
          identifier: text.optional(),
          ref: text.optional(),
          label: text.optional(),
          text: text.optional(),
          point: point.optional(),
        })
        .strict(),
      text: z.string(),
    })
    .strict(),
]);

const namedControlResolution = z
  .object({
    method: z.enum(["identifier", "label", "text", "relation", "point"]),
    point,
    bounds,
    activation: z.literal("snapshot-point").optional(),
  })
  .strict();

const iosSessionLifecycle = z
  .object({
    operation: z.enum(["preview", "snapshot", "screenshot", "interaction", "evidence"]),
    outcome: z.enum(["passed", "unavailable", "in-flight"]),
    code: z.enum([
      "IOS_SESSION_OPERATION_READY",
      "IOS_SESSION_OPERATION_UNAVAILABLE",
      "IOS_SESSION_OPERATION_ACCESSIBILITY_IN_FLIGHT",
    ]),
    attempts: z.literal(1),
    repairAttempted: z.literal(false),
    durationMs: natural,
    stages: z.array(
      z
        .object({
          stage: z.enum(["preview", "xctest-availability", "accessibility-query", "repair"]),
          outcome: z.enum(["passed", "failed", "skipped", "in-flight"]),
        })
        .strict(),
    ),
  })
  .strict();

const iosMutation = z
  .object({
    sequence: natural,
    operation: z.enum([
      "app-open",
      "app-close",
      "url-open",
      "press",
      "long-press",
      "fill",
      "type",
      "swipe",
      "scroll",
      "back",
      "home",
      "clipboard-write",
      "clipboard-paste",
      "clipboard-copy",
      "app-switcher",
      "rotate",
      "keyboard",
      "alert",
      "settings",
      "video",
    ]),
    nativeAttempts: z.literal(1),
    outcome: z.enum(["completed", "selector-miss", "outcome-unknown"]),
    retry: z
      .object({
        attempts: z.literal(0),
        decision: z.enum(["not-needed", "safe-selector-fallback", "blocked"]),
        reason: z.enum([
          "native-command-completed",
          "selector-was-not-dispatched",
          "native-command-outcome-unknown",
        ]),
      })
      .strict(),
    intervention: z
      .object({
        required: z.boolean(),
        action: z.enum(["none", "capture-current-screen-before-any-retry"]),
      })
      .strict(),
    cancellation: z
      .object({ observedAfterAttemptStarted: z.literal(true) })
      .strict()
      .optional(),
    at: natural,
  })
  .strict();

const groundingCandidate = z
  .object({
    label: z.string().optional(),
    identifier: z.string().optional(),
    point: point.optional(),
    reason: z.string().optional(),
  })
  .strict();
const groundingResultFields = {
  interaction: interactInput,
  method: z.enum(["a11y", "heuristic", "vision"]),
  confidence: z.number().min(0).max(1),
  candidates: z.array(groundingCandidate).optional(),
};

const targetProfile = z
  .object({
    id: text,
    targetId: text,
    source: z.enum(["device", "browser"]),
    platform: z.enum(["android", "ios", "browser"]),
    name: text,
    model: z.string().optional(),
    androidAvdName: z.string().optional(),
    osVersion: z.string().optional(),
    viewport: viewport.optional(),
    browserCaseProfile: browserCaseProfileSchema.optional(),
    capabilities: z.array(targetCapability),
    observedAt: natural,
  })
  .strict();

const androidAvd = z
  .object({
    avdName: text,
    serial: text.optional(),
    name: text,
    platform: z.literal("android"),
    kind: z.literal("emulator"),
    target: z.enum(["mobile", "tv"]),
    booted: z.boolean(),
    status: z.enum(["stopped", "booting", "booted"]),
    source: z.literal("android-sdk"),
  })
  .strict();
const androidAvdInventory = z
  .object({
    source: z.enum(["android-sdk", "unavailable"]),
    available: z.boolean(),
    avds: z.array(androidAvd),
    reason: z.enum(["sdk-unavailable", "inventory-failed"]).optional(),
  })
  .strict();
const androidAvdBoot = z
  .object({
    avdName: text,
    serial: text,
    platform: z.literal("android"),
    kind: z.literal("emulator"),
    booted: z.literal(true),
    status: z.enum(["booted", "already-booted"]),
    reused: z.boolean(),
    observedAt: natural,
  })
  .strict();

const targetSelector = z
  .object({
    targetIds: z.array(text).optional(),
    platforms: z.array(z.enum(["android", "ios", "browser"])).optional(),
    osVersionPrefixes: z.array(text).optional(),
    nameIncludes: z.array(text).optional(),
    requiredCapabilities: z.array(targetCapability).optional(),
  })
  .strict();
const compatibilityMatrix = z
  .object({
    id: text,
    projectId: text,
    name: text,
    selectors: z.array(targetSelector),
    createdAt: natural,
    updatedAt: natural,
  })
  .strict();

const schedule = z
  .object({
    id: text,
    recipeId: text,
    targetKind: z.enum(["device", "browser"]),
    targetId: text,
    platform: z.enum(["android", "ios", "browser"]),
    intervalMinutes: z.number().int().min(1).max(43_200),
    repetitions: z.number().int().min(1).max(20),
    enabled: z.boolean(),
    projectId: text,
    createdAt: natural,
    updatedAt: natural,
    nextRunAt: natural,
    lastRunAt: natural.optional(),
    lastFailureAt: natural.optional(),
    lastFailure: text.optional(),
  })
  .strict();

const presence = z
  .object({
    actorId: text,
    actorKind,
    updatedAt: natural,
    expiresAt: natural,
    displayName: z.string().optional(),
    avatarToken: z.string().optional(),
    cursor: point.optional(),
    selection: z
      .object({ screenId: z.string().optional(), connectionId: z.string().optional() })
      .strict()
      .optional(),
    viewport: z
      .object({
        x: z.number(),
        y: z.number(),
        zoom: z.number().positive(),
        width: z.number().nonnegative(),
        height: z.number().nonnegative(),
      })
      .strict()
      .optional(),
    activity: z.enum(["editing", "recording", "running", "idle"]),
  })
  .strict();

const executionTarget = z.discriminatedUnion("kind", [
  z
    .object({
      schemaVersion: z.literal(1),
      kind: z.literal("local-device"),
      provider: z
        .object({ key: z.literal("relay.local.agent-device"), scope: z.literal("local") })
        .strict(),
      targetId: text,
      platform: z.enum(["android", "ios"]),
      identity: z.object({ kind: z.literal("device-serial"), value: text }).strict(),
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(1),
      kind: z.literal("local-browser"),
      provider: z
        .object({ key: z.literal("relay.local.browser"), scope: z.literal("local") })
        .strict(),
      targetId: text,
      platform: z.literal("browser"),
      identity: z.object({ kind: z.literal("browser-target"), value: text }).strict(),
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(1),
      kind: z.literal("provider-session"),
      provider: z.object({ key: text, scope: z.literal("remote") }).strict(),
      targetId: text,
      platform: z.enum(["android", "ios"]),
      identity: z.object({ kind: z.literal("provider-session"), value: text }).strict(),
    })
    .strict(),
]);

const targetContext = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("device"), platform: z.enum(["android", "ios"]), serial: text })
    .strict(),
  z.object({ kind: z.literal("browser"), platform: z.literal("browser"), targetId: text }).strict(),
  z
    .object({
      kind: z.literal("cloud"),
      provider: text,
      sessionId: text,
      platform: z.enum(["android", "ios"]),
    })
    .strict(),
]);

const commandIdentity = z
  .object({
    schemaVersion: z.literal(1),
    actorId: text,
    actorKind,
    organizationId: text,
    projectId: text,
    operationId: text,
    requestId: text,
    idempotencyKey: text,
    issuedAt: natural,
    causationId: text.optional(),
    correlationId: text.optional(),
    authoringSessionId: text.optional(),
    leaseId: text.optional(),
    leaseOwnerId: text.optional(),
    interventionJobId: text.optional(),
    interventionRequestedAt: natural.optional(),
  })
  .strict();

const glyph = z.enum([
  "tap",
  "type",
  "wait",
  "shot",
  "swipe",
  "ok",
  "fail",
  "ai",
  "dl",
  "re",
  "store",
  "login",
]);
const stepKind = z.enum(["Replay", "Agent", "Healed", "Capture", "Setup", "Verify"]);
const stepTone = z.enum(["dim", "acc", "heal", "pass", "fail"]);
const traceFrame = z
  .object({
    path: text,
    caption: z.string(),
    capturedAt: natural,
    bytes: natural.optional(),
    base64: z.string().optional(),
    mime: z.string().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
  })
  .strict();
const traceStep = z
  .object({
    id: text,
    index: natural,
    kind: stepKind,
    tone: stepTone,
    title: z.string(),
    glyphs: z.array(glyph),
    actions: z
      .array(z.object({ kind: glyph, at: natural, label: z.string().optional() }).strict())
      .optional(),
    startedAt: natural,
    finishedAt: natural.optional(),
    durationMs: natural.optional(),
    frames: z.array(traceFrame),
    log: z.string(),
    heal: z.string().optional(),
    status: z.enum(["running", "ok", "error", "healed"]).optional(),
  })
  .strict();

const evidencePolicy = z
  .object({
    schemaVersion: z.literal(1),
    sensitive: z
      .object({
        audio: z
          .object({ grantedAt: natural, grantedBy: text, reason: z.string() })
          .strict()
          .optional(),
        crash: z
          .object({ grantedAt: natural, grantedBy: text, reason: z.string() })
          .strict()
          .optional(),
        "network-body": z
          .object({ grantedAt: natural, grantedBy: text, reason: z.string() })
          .strict()
          .optional(),
      })
      .strict(),
    redaction: z
      .object({
        enabled: z.boolean(),
        source: z.enum(["default", "workspace", "environment"]),
        locked: z.boolean(),
        updatedAt: natural.optional(),
      })
      .strict()
      .optional(),
    updatedAt: natural.optional(),
  })
  .strict();

const job = z
  .object({
    id: text,
    projectId: text.optional(),
    ownerId: text.optional(),
    operationContext: commandIdentity.optional(),
    targetContext,
    executionTarget: executionTarget.optional(),
    action: text,
    recipeId: text.optional(),
    serial: z.string().optional(),
    deviceName: z.string().optional(),
    platform: z.enum(["android", "ios"]),
    targetKind: z.enum(["device", "browser"]).optional(),
    browserTargetId: z.string().optional(),
    browserCaseProfile: browserCaseProfileSchema.optional(),
    targetProfile: targetProfile.optional(),
    workerId: z.string().optional(),
    workerCapacity: z.number().int().positive().optional(),
    hostWorkerId: z.string().optional(),
    hostWorkerCapacity: z.number().int().positive().optional(),
    status: z.enum(["queued", "running", "paused", "ok", "error", "healed", "cancelled"]),
    queuedAt: natural,
    startedAt: natural.optional(),
    finishedAt: natural.optional(),
    logs: z.array(z.string()),
    result: z.unknown().optional(),
    error: z.string().optional(),
    errorCode: z
      .enum([
        "ACTION_FAILED",
        "DEVICE_MISSING",
        "UNKNOWN_ACTION",
        "TIMEOUT",
        "ACCOUNT_SWITCH_FAILED",
        "CANCELLED",
        "INTERNAL",
      ])
      .optional(),
    outcome: z
      .enum(["passed", "product-failure", "harness-failure", "uncertain", "cancelled"])
      .optional(),
    failureCategory: z
      .enum([
        "environment",
        "target-state",
        "locator",
        "action",
        "completion",
        "extraction",
        "deterministic-assertion",
        "semantic-assertion",
        "visual-assertion",
        "judge-uncertainty",
        "review-required",
        "harness-defect",
      ])
      .optional(),
    review: z.unknown().optional(),
    appVersion: z.string().optional(),
    batchId: z.string().optional(),
    caseIndex: natural.optional(),
    caseCount: natural.optional(),
    previousError: z.string().optional(),
    healed: z.boolean().optional(),
    healMessage: z.string().optional(),
    attempts: z.number().int().positive(),
    retryOf: z.string().optional(),
    retriedBy: z.string().optional(),
    steps: z.array(traceStep),
    frames: z.array(traceFrame),
    glyphs: z.array(glyph),
    kind: stepKind,
    tone: stepTone,
    title: z.string(),
    runDir: z.string().optional(),
    persisted: z.boolean().optional(),
    recipeSnapshot: z.unknown().optional(),
    recipeGraph: z.record(z.string(), z.unknown()).optional(),
    evidence: z.unknown().optional(),
    evidencePolicy,
    waitingFor: z.unknown().optional(),
    artifacts: z.array(z.object({ kind: text, capturedAt: natural, data: z.unknown() }).strict()),
    resolvedInputs: z.record(z.string(), z.string()),
    sensitiveInputNames: z.array(z.string()).optional(),
    options: z.object({ prodAccountMatch: z.string().optional() }).strict().optional(),
  })
  .strict();

const actionRunOutput = z.union([
  z.object({ job }).strict(),
  z
    .object({
      ok: z.boolean(),
      action: text,
      result: z.unknown().optional(),
      error: z.string().optional(),
      healed: z.boolean().optional(),
      healMessage: z.string().optional(),
      cancelled: z.boolean(),
      job,
      logs: z.array(z.string()),
    })
    .strict(),
]);

/** Strict runtime response contracts for workspace and target HTTP operations. */
export const workspaceTargetOperationOutputSchemas = {
  "system.doctor.get": z
    .object({ ok: z.boolean(), checks: z.array(diagnostic), error: z.string().optional() })
    .strict(),
  "system.audit.list": z.object({ events: z.array(auditEvent) }).strict(),
  "activity.list": z
    .object({ records: z.array(activityRecord), nextCursor: text.optional() })
    .strict(),
  "workspace.apple-device.update": z.object({ setup: deviceSetup }).strict(),
  "workspace.apple-live-preview.update": z.object({ setup: deviceSetup }).strict(),
  "target.list": z.object({ targets: z.array(targetDefinition) }).strict(),
  "target.create": z.object({ target: targetDefinition }).strict(),
  "target.delete": ok,
  "target.preflight": z.object({ preflight: targetPreflight }).strict(),
  "target.open": z
    .object({ session: z.object({ targetId: text, name: text, url: z.url() }).strict() })
    .strict(),
  "target.browser-device.open": z.object({ session: browserDeviceSessionSchema }).strict(),
  "target.browser-device.frame": z
    .object({
      session: browserDeviceSessionSchema,
      frame: browserDeviceFrameSchema,
      gap: z
        .object({ afterSequence: natural, currentSequence: natural, dropped: natural })
        .strict()
        .optional(),
    })
    .strict(),
  "target.browser-device.frame-binary": browserDeviceBinaryFrameMetadataSchema,
  "target.browser-device.inspect": z
    .object({ overlay: browserDeviceSemanticOverlaySchema })
    .strict(),
  "target.browser-device.control": z
    .object({
      ok: z.literal(true),
      session: browserDeviceSessionSchema,
      resolution: browserDeviceInputResolutionSchema.optional(),
    })
    .strict(),
  "target.boot": z.object({ ok: z.literal(true), serial: text }).strict(),
  "target.avds.list": z.object({ inventory: androidAvdInventory }).strict(),
  "target.avd.boot": z.object({ boot: androidAvdBoot }).strict(),
  "target.authorize": z.object({ ok: z.literal(true), serial: text }).strict(),
  "target.interact": z.union([
    z
      .object({
        ok: z.literal(true),
        preview: z.literal(true),
        mime: z.literal("image/png"),
        base64: z.string(),
        bytes: natural,
        width: z.number().positive().optional(),
        height: z.number().positive().optional(),
        inspectable: z.boolean(),
        resolution: namedControlResolution.optional(),
      })
      .strict(),
    z
      .object({
        ok: z.literal(true),
        resolution: namedControlResolution.optional(),
        iosSessionLifecycle: iosSessionLifecycle.optional(),
        iosMutation: iosMutation.optional(),
      })
      .strict(),
  ]),
  "target.ground": z.object({ ok: z.literal(true), ...groundingResultFields }).strict(),
  "target.do": z
    .object({
      ok: z.literal(true),
      ...groundingResultFields,
      resolution: namedControlResolution.optional(),
      iosSessionLifecycle: iosSessionLifecycle.optional(),
      iosMutation: iosMutation.optional(),
    })
    .strict(),
  "target.touch": ok,
  "target.key": ok,
  "target.scroll": ok,
  "target.video.start": z
    .object({
      take: z
        .object({
          id: text,
          serial: text,
          startedAt: natural,
          finishedAt: natural.optional(),
          state: z.enum(["recording", "ready"]),
          warning: z.string().optional(),
        })
        .strict()
        .nullable(),
    })
    .strict(),
  "target.stream.open": z.object({ contentType: text, stream: z.literal("binary") }).strict(),
  "action.run": actionRunOutput,
  "schedule.list": z.object({ schedules: z.array(schedule) }).strict(),
  "schedule.create": z.object({ schedule }).strict(),
  "schedule.delete": ok,
  "matrix.list": z.object({ matrices: z.array(compatibilityMatrix) }).strict(),
  "matrix.create": z.object({ matrix: compatibilityMatrix }).strict(),
  "matrix.update": z.object({ matrix: compatibilityMatrix }).strict(),
  "matrix.delete": ok,
  "matrix.import": z.object({ matrix: compatibilityMatrix }).strict(),
  "matrix.resolve": z
    .object({
      expansion: z
        .object({
          matrixId: text,
          matrixName: text,
          resolvedAt: natural,
          profiles: z.array(targetProfile),
          excluded: z.array(z.object({ profile: targetProfile, reason: text }).strict()),
        })
        .strict(),
    })
    .strict(),
  "presence.list": z.object({ actors: z.array(presence) }).strict(),
  "presence.upsert": z.object({ actor: presence }).strict(),
  "presence.clear": ok,
} as const satisfies Readonly<Record<string, z.ZodType>>;
