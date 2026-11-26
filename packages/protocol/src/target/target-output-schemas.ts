import { targetSupervisorEventCodes } from "./target-supervisor.js";
import * as z from "zod/v4";
import { artifactProjectionOutputSchema } from "../artifact-output-schemas.js";

export const targetRuntimeCapabilityReasonOutputSchema = z.enum([
  "not-yet-proven",
  "target-stopped",
  "developer-mode-disabled",
  "developer-services-unavailable",
  "probe-failed",
  "probe-in-flight",
  "input-changed",
  "visual-changed",
]);
type TargetRuntimeCapability = {
  mode: "pixels" | "accessibility" | "evidence";
  state: "unproven" | "proven" | "unavailable";
  freshness: "current" | "stale" | "unproven";
  proof?: { at: number; observedNodeCount?: number; durationMs?: number };
  lastError?: {
    at: number;
    reason: z.infer<typeof targetRuntimeCapabilityReasonOutputSchema>;
    observedNodeCount?: number;
    durationMs?: number;
    message?: string;
  };
  invalidated?: { at: number; reason: "input-changed" | "visual-changed" };
  reason?: z.infer<typeof targetRuntimeCapabilityReasonOutputSchema>;
  nextProbeAt?: number;
};
function refineTargetRuntimeCapability(
  capabilityKey: "previewPixels" | "semanticControl" | "evidenceCapture",
) {
  return (state: TargetRuntimeCapability, context: z.RefinementCtx): void => {
    const path = [capabilityKey];
    const fail = (message: string, ...rest: string[]) =>
      context.addIssue({ code: "custom", message, path: [...path, ...rest] });
    const proven = state.state === "proven";
    if (proven && state.freshness === "unproven") {
      fail("freshness cannot be unproven after a successful proof", "freshness");
    }
    if (!proven && state.freshness !== "unproven") {
      fail("freshness must be unproven without a successful proof", "freshness");
    }
    if (proven && state.proof === undefined) {
      fail("proof is required when state is proven", "proof");
    }
    if (!proven && state.proof !== undefined) {
      fail("proof is only allowed when state is proven", "proof");
    }
    if (state.lastError !== undefined && proven) {
      fail("lastError is not allowed when state is proven", "lastError");
    }
    if (state.invalidated !== undefined) {
      if (!proven || state.freshness !== "stale" || capabilityKey !== "semanticControl") {
        fail("invalidated is only allowed for stale proven semantic control", "invalidated");
      }
    }
    if (proven && state.freshness === "stale" && state.invalidated === undefined) {
      fail("invalidated is required when a semantic proof is stale", "invalidated");
    }
    if (state.nextProbeAt !== undefined) {
      if (
        capabilityKey !== "semanticControl" ||
        state.state !== "unavailable" ||
        state.lastError?.reason !== "probe-failed"
      ) {
        fail(
          "nextProbeAt is only allowed after an unavailable semantic probe failure",
          "nextProbeAt",
        );
      }
    }
  };
}
function targetRuntimeCapabilityReadinessOutputSchema(
  capabilityKey: "previewPixels" | "semanticControl" | "evidenceCapture",
  mode: "pixels" | "accessibility" | "evidence",
) {
  return z
    .object({
      mode: z.literal(mode),
      state: z.enum(["unproven", "proven", "unavailable"]),
      freshness: z.enum(["current", "stale", "unproven"]),
      proof: z
        .object({
          at: z.number(),
          observedNodeCount: z.number().optional(),
          durationMs: z.number().optional(),
        })
        .strict()
        .optional(),
      lastError: z
        .object({
          at: z.number(),
          reason: targetRuntimeCapabilityReasonOutputSchema,
          observedNodeCount: z.number().optional(),
          durationMs: z.number().optional(),
          message: z.string().max(480).optional(),
        })
        .strict()
        .optional(),
      invalidated: z
        .object({ at: z.number(), reason: z.enum(["input-changed", "visual-changed"]) })
        .strict()
        .optional(),
      reason: targetRuntimeCapabilityReasonOutputSchema.optional(),
      nextProbeAt: z.number().optional(),
    })
    .strict()
    .superRefine(refineTargetRuntimeCapability(capabilityKey));
}
export const targetRuntimeReadinessOutputSchema = z
  .object({
    previewPixels: targetRuntimeCapabilityReadinessOutputSchema("previewPixels", "pixels"),
    semanticControl: targetRuntimeCapabilityReadinessOutputSchema(
      "semanticControl",
      "accessibility",
    ),
    evidenceCapture: targetRuntimeCapabilityReadinessOutputSchema("evidenceCapture", "evidence"),
  })
  .strict();

export const targetLatencyOutputSchema = z
  .object({ count: z.number(), averageMs: z.number().optional(), maximumMs: z.number().optional() })
  .strict();
export const targetHealthOutputSchema = z
  .object({
    health: z
      .object({
        schemaVersion: z.literal(1),
        visibility: z.enum(["project", "public"]).optional(),
        target: z
          .object({ id: z.string().min(1).max(512), kind: z.enum(["android", "ios", "browser"]) })
          .strict(),
        observedAt: z.number(),
        epochs: z.object({ target: z.number(), semanticSession: z.number() }).strict(),
        pixels: z
          .object({
            state: z.enum(["ready", "delayed", "unavailable"]),
            lastCapturedAt: z.number().optional(),
            lastError: z.string().max(480).optional(),
          })
          .strict(),
        semantics: z
          .object({
            state: z.enum(["current", "stale", "refreshing", "wedged", "unavailable"]),
            lastCapturedAt: z.number().optional(),
            lastError: z.string().max(480).optional(),
            traversal: z.object({ token: z.string(), startedAt: z.number() }).strict().optional(),
          })
          .strict(),
        input: z
          .object({
            state: z.enum(["ready", "uncertain", "blocked"]),
            pendingMutationId: z.string().optional(),
            reason: z.string().max(480).optional(),
          })
          .strict(),
        control: z
          .object({
            state: z.enum(["available", "owned", "held-by-other"]),
            ownerId: z.string().optional(),
            expiresAt: z.number().optional(),
          })
          .strict(),
        overall: z.enum([
          "starting",
          "ready",
          "pixel-only",
          "recovering",
          "needs-human",
          "quarantined",
        ]),
        context: z
          .object({
            foregroundApp: z.string().optional(),
            display: z.enum(["on", "asleep", "locked", "unknown"]).optional(),
            connectivity: z.enum(["online", "offline", "airplane", "unknown"]).optional(),
            screenFingerprint: z.string().max(256).optional(),
            runCursor: z
              .object({
                runId: z.string(),
                stepId: z.string().optional(),
                index: z.number().optional(),
              })
              .strict()
              .optional(),
          })
          .strict(),
        recovery: z
          .object({
            channel: z.enum(["pixels", "semantics", "input"]),
            stage: z.enum([
              "refresh-pixels",
              "refresh-semantics",
              "restart-semantic-runner",
              "prepare-platform-services",
              "reconcile-observation",
            ]),
            attempt: z.number(),
            startedAt: z.number(),
          })
          .strict()
          .optional(),
        counters: z
          .object({
            pixelCaptures: z.number(),
            semanticTraversals: z.number(),
            semanticTimeouts: z.number(),
            semanticWedges: z.number(),
            uncertainMutations: z.number(),
            reconciliations: z.number(),
            recoveryAttempts: z.number(),
            recoveryFailures: z.number(),
          })
          .strict(),
        latency: z
          .object({
            pixels: targetLatencyOutputSchema,
            semantics: targetLatencyOutputSchema,
            recovery: targetLatencyOutputSchema,
          })
          .strict(),
        readiness: targetRuntimeReadinessOutputSchema,
        events: z
          .array(
            z
              .object({
                sequence: z.number(),
                at: z.number(),
                code: z.enum(targetSupervisorEventCodes),
                message: z.string().max(480),
                channel: z.enum(["pixels", "semantics", "input"]).optional(),
                stage: z
                  .enum([
                    "refresh-pixels",
                    "refresh-semantics",
                    "restart-semantic-runner",
                    "prepare-platform-services",
                    "reconcile-observation",
                  ])
                  .optional(),
                mutationId: z.string().optional(),
                traversalToken: z.string().optional(),
              })
              .strict(),
          )
          .max(128),
      })
      .strict(),
  })
  .strict();

export const targetObservationOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    target: z.union([
      z
        .object({
          kind: z.literal("device"),
          platform: z.enum(["android", "ios"]),
          targetId: z.string().min(1),
        })
        .strict(),
      z
        .object({
          kind: z.literal("browser"),
          platform: z.literal("browser"),
          targetId: z.string().min(1),
          authenticationFixtureId: z.string().optional(),
          liveSessionId: z.string().optional(),
        })
        .strict(),
    ]),
    capturedAt: z.number(),
    pixels: z.discriminatedUnion("status", [
      z
        .object({
          status: z.literal("captured"),
          capturedAt: z.number(),
          mime: z.enum(["image/png", "image/jpeg"]),
          bytes: z.number(),
          artifact: artifactProjectionOutputSchema,
          presentationBase64: z
            .string()
            .max(Math.ceil((8 * 1024 * 1024) / 3) * 4 + 4)
            .regex(/^[A-Za-z0-9+/]*={0,2}$/u)
            .optional(),
          width: z.number().optional(),
          height: z.number().optional(),
          fingerprint: z.string().optional(),
        })
        .strict(),
      z.object({ status: z.literal("unavailable"), message: z.string().max(480) }).strict(),
    ]),
    semantics: z
      .object({
        status: z.enum(["current", "stale", "unavailable"]),
        capturedAt: z.number().optional(),
        artifact: artifactProjectionOutputSchema,
        source: z.enum(["sdk", "android-system", "pixels-only"]).optional(),
        androidTreeBackend: z.enum(["helper", "dump"]).optional(),
        inspectionState: z
          .enum(["active", "keyguard", "asleep", "unavailable", "unknown"])
          .optional(),
        fingerprint: z.string().optional(),
        nodeCount: z.number().nonnegative(),
        controls: z
          .array(
            z
              .object({
                identifier: z.string().optional(),
                label: z.string().optional(),
                text: z.string().optional(),
                role: z.string().optional(),
                enabled: z.boolean().optional(),
                selected: z.boolean().optional(),
                rect: z
                  .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
                  .strict()
                  .optional(),
              })
              .strict(),
          )
          .max(40, "exceeds the public bound"),
        message: z.string().max(480).optional(),
      })
      .strict(),
    foregroundApp: z.string().optional(),
    screenCandidate: z
      .object({
        id: z.string().optional(),
        fingerprint: z.string().min(1),
        confidence: z.enum(["matched", "observed"]),
      })
      .strict()
      .optional(),
    readiness: targetRuntimeReadinessOutputSchema.optional(),
  })
  .strict();

function recoveryFenceEvidenceOutputSchema(kind: "screenshot" | "snapshot") {
  return z
    .object({
      id: z.string().min(1),
      kind: z.literal(kind),
      capturedAt: z.number(),
      uri: z.string().min(1),
      sha256: z.string().regex(/^[a-f0-9]{64}$/u),
      bytes: z.number(),
      mime: z.string().min(1),
    })
    .strict()
    .superRefine((evidence, context) => {
      if (evidence.uri !== `relay-evidence://${evidence.sha256}`) {
        context.addIssue({
          code: "custom",
          message: "evidence must be a content-addressed Relay evidence reference",
          path: ["uri"],
        });
      }
    });
}
export const targetRecoveryOutputSchema = z
  .object({
    recovery: z
      .object({
        serial: z.string().min(1),
        recovered: z.boolean(),
        ready: z.boolean(),
        summary: z.string(),
        actions: z.array(
          z
            .object({
              kind: z.enum(["stale-lock", "agent-device", "core-device"]),
              status: z.enum(["completed", "skipped", "failed"]),
              detail: z.string(),
            })
            .strict(),
        ),
        session: z
          .object({
            status: z.enum(["restored", "unavailable"]),
            app: z.string().optional(),
            fallback: z.boolean().optional(),
            detail: z.string(),
          })
          .strict(),
        readiness: targetRuntimeReadinessOutputSchema.optional(),
      })
      .strict(),
    recoveryFenceRelease: z
      .object({
        assignmentId: z.string().min(1),
        releasedAt: z.number(),
        reproofId: z.string().min(1),
        evidence: z
          .object({
            manifest: recoveryFenceEvidenceOutputSchema("snapshot"),
            screenshotBefore: recoveryFenceEvidenceOutputSchema("screenshot"),
            semanticSnapshot: recoveryFenceEvidenceOutputSchema("snapshot"),
            screenshotAfter: recoveryFenceEvidenceOutputSchema("screenshot"),
          })
          .strict(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((output, context) => {
    if (output.recoveryFenceRelease === undefined) return;
    if (output.recovery.ready !== true) {
      context.addIssue({
        code: "custom",
        message: "recovery fence release requires a ready recovered target",
        path: ["recoveryFenceRelease"],
      });
    }
    const manifestSha256 = output.recoveryFenceRelease.evidence.manifest.sha256;
    if (
      output.recoveryFenceRelease.reproofId !== `durable-recovery-fence-reproof:${manifestSha256}`
    ) {
      context.addIssue({
        code: "custom",
        message: "reproofId must match the immutable recovery-fence manifest",
        path: ["recoveryFenceRelease", "reproofId"],
      });
    }
  });

export const targetInputReviewOutputSchema = z
  .object({
    source: z.literal("operator-review"),
    observed: z.enum(["applied", "not-observed", "uncertain"]),
    actorId: z.string().min(1),
  })
  .strict();

export const targetScreenshotOutputSchema = z
  .object({
    serial: z.string().optional(),
    capturedAt: z.number(),
    mime: z.literal("image/png"),
    base64: z.string().min(1),
    path: z.string().min(1),
    bytes: z.number(),
    width: z.number().optional(),
    height: z.number().optional(),
    foregroundApp: z.string().optional(),
    screenMatch: z
      .object({
        fingerprint: z.string().min(1),
        visualFingerprint: z.string().optional(),
        matchedScreenId: z.string().nullable(),
        status: z.enum(["observed", "unavailable"]),
      })
      .strict()
      .optional(),
    proposedRows: z
      .array(
        z
          .object({
            x: z.number(),
            y: z.number(),
            top: z.number().optional(),
            bottom: z.number().optional(),
            height: z.number().optional(),
          })
          .strict(),
      )
      .optional(),
    jobId: z.string().optional(),
    framePath: z.string().optional(),
    inspectable: z.boolean().optional(),
    readiness: targetRuntimeReadinessOutputSchema.optional(),
    display: z
      .object({
        state: z.enum(["on", "asleep", "locked", "unknown"]),
        warning: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const normalizedSemanticNodeOutputSchema = z
  .object({
    role: z.string(),
    label: z.string().optional(),
    value: z.string().optional(),
    identifier: z.string().optional(),
    enabled: z.boolean().optional(),
    selected: z.boolean().optional(),
    focused: z.boolean().optional(),
    hittable: z.boolean().optional(),
    depth: z.number().optional(),
  })
  .strict();
export const screenIdentityObservationOutputSchema = z
  .object({
    fingerprint: z.string().min(1),
    nodes: z.array(normalizedSemanticNodeOutputSchema),
    volatileSignals: z.array(
      z
        .object({
          kind: z.enum([
            "clock",
            "counter",
            "date",
            "generated-id",
            "percentage",
            "placeholder",
            "relative-time",
            "uuid",
          ]),
          field: z.enum(["identifier", "label", "value"]),
          node: z.number().int().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict();
export const semanticNodeOutputSchema = z
  .object({
    label: z.string().optional(),
    value: z.string().optional(),
    description: z.string().optional(),
    identifier: z.string().optional(),
    role: z.string().optional(),
    type: z.string().optional(),
    enabled: z.boolean().optional(),
    selected: z.boolean().optional(),
    focused: z.boolean().optional(),
    visibleToUser: z.boolean().optional(),
    hittable: z.boolean().optional(),
    rect: z
      .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
      .strict()
      .optional(),
    ref: z.string().optional(),
    index: z.number().int().optional(),
    depth: z.number().int().optional(),
    parentIndex: z.number().int().optional(),
    bundleId: z.string().optional(),
  })
  .strict();

export const iosSessionOperationLifecycleOutputSchema = z
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
    durationMs: z.number(),
    stages: z.array(
      z
        .object({
          stage: z.enum(["preview", "xctest-availability", "accessibility-query", "repair"]),
          outcome: z.enum(["passed", "failed", "skipped", "in-flight"]),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((lifecycle, context) => {
    const expectedCode =
      lifecycle.outcome === "passed"
        ? "IOS_SESSION_OPERATION_READY"
        : lifecycle.outcome === "unavailable"
          ? "IOS_SESSION_OPERATION_UNAVAILABLE"
          : "IOS_SESSION_OPERATION_ACCESSIBILITY_IN_FLIGHT";
    if (lifecycle.code !== expectedCode) {
      context.addIssue({
        code: "custom",
        message: "lifecycle code does not match the operation outcome",
        path: ["code"],
      });
    }
    if (lifecycle.outcome !== "in-flight") return;
    const stages = lifecycle.stages;
    if (
      !stages.some(
        (stage) => stage.stage === "xctest-availability" && stage.outcome === "skipped",
      ) ||
      !stages.some(
        (stage) => stage.stage === "accessibility-query" && stage.outcome === "in-flight",
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "in-flight lifecycle must keep XCTest availability unclaimed while AX is in flight",
        path: ["stages"],
      });
    }
  });

export const targetSnapshotOutputSchema = z
  .object({
    serial: z.string().optional(),
    capturedAt: z.number(),
    nodes: z.array(semanticNodeOutputSchema),
    interactive: z.array(semanticNodeOutputSchema),
    tree: z.string(),
    bounds: z.object({ width: z.number(), height: z.number() }).strict().optional(),
    boundsSource: z.literal("current-window").optional(),
    inspectable: z.boolean(),
    source: z.enum(["sdk", "android-system", "pixels-only"]),
    androidTreeBackend: z.enum(["helper", "dump"]).optional(),
    inspectionState: z.enum(["active", "keyguard", "asleep", "unavailable", "unknown"]).optional(),
    foregroundApp: z.string().optional(),
    app: z.string().optional(),
    header: z.string().optional(),
    treeApp: z.string().optional(),
    bindingState: z.enum(["matched", "rebound", "unavailable"]).optional(),
    inspectionError: z.string().optional(),
    iosSessionLifecycle: iosSessionOperationLifecycleOutputSchema.optional(),
    screenIdentity: screenIdentityObservationOutputSchema,
    visualFingerprint: z.string().optional(),
    proposedRows: z
      .array(
        z
          .object({
            x: z.number(),
            y: z.number(),
            top: z.number().optional(),
            bottom: z.number().optional(),
            height: z.number().optional(),
          })
          .strict(),
      )
      .optional(),
    readiness: targetRuntimeReadinessOutputSchema.optional(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (!snapshot.tree && snapshot.inspectable !== false) {
      context.addIssue({
        code: "custom",
        message: "snapshot tree must be non-empty unless the snapshot is explicitly uninspectable",
        path: ["tree"],
      });
    }
  });

export const scrollSurveySnapshotOutputSchema = z
  .object({
    serial: z.string().optional(),
    capturedAt: z.number(),
    nodes: z.array(semanticNodeOutputSchema),
    interactive: z.array(semanticNodeOutputSchema),
    bounds: z.object({ width: z.number(), height: z.number() }).strict().optional(),
    inspectable: z.boolean(),
    source: z.enum(["sdk", "android-system", "pixels-only"]),
    androidTreeBackend: z.enum(["helper", "dump"]).optional(),
    inspectionState: z.enum(["active", "keyguard", "asleep", "unavailable", "unknown"]).optional(),
    foregroundApp: z.string().optional(),
    treeApp: z.string().optional(),
    bindingState: z.enum(["matched", "rebound", "unavailable"]).optional(),
    inspectionError: z.string().optional(),
    screenIdentity: screenIdentityObservationOutputSchema,
    visualFingerprint: z.string().optional(),
    proposedRows: z
      .array(
        z
          .object({
            x: z.number(),
            y: z.number(),
            top: z.number().optional(),
            bottom: z.number().optional(),
            height: z.number().optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
export const scrollSurveyFrameOutputSchema = z
  .object({
    index: z.number().int(),
    offsetY: z.number(),
    screenshot: z
      .object({
        base64: z.string().min(1),
        width: z.number(),
        height: z.number(),
        capturedAt: z.number(),
      })
      .strict(),
    snapshot: scrollSurveySnapshotOutputSchema,
    appendedHeight: z.number(),
  })
  .strict();
export const scrollSurveyOutputSchema = z
  .object({
    status: z.enum(["completed", "stopped"]),
    reason: z.enum([
      "end-of-content",
      "screen-changed",
      "inspection-unavailable",
      "missing-page-anchor",
      "seam-ambiguous",
      "dimension-changed",
      "scroll-failed",
      "restore-failed",
      "start-viewport-unproven",
      "extent-unproven",
      "limit-reached",
    ]),
    frames: z.array(scrollSurveyFrameOutputSchema).min(1),
    diagnosticFrames: z.array(scrollSurveyFrameOutputSchema),
    stitched: z
      .object({
        base64: z.string().min(1),
        width: z.number(),
        height: z.number(),
        mime: z.literal("image/png"),
      })
      .strict()
      .optional(),
    mergedNodes: z.array(semanticNodeOutputSchema),
    restoredStartViewport: z.boolean(),
    message: z.string(),
    persist: z
      .object({
        dir: z.string().min(1),
        status: z.enum(["completed", "stopped"]),
        reason: z.string(),
        frameCount: z.number(),
        paths: z.array(z.object({ png: z.string().min(1), json: z.string().min(1) }).strict()),
        frames: z.array(
          z
            .object({
              index: z.number().int(),
              offsetY: z.number().optional(),
              labelCount: z.number(),
              files: z.object({ png: z.string().min(1), json: z.string().min(1) }).strict(),
            })
            .strict(),
        ),
        full: z
          .object({
            png: z.string().min(1),
            json: z.string().min(1),
            width: z.number(),
            height: z.number(),
            nodeCount: z.number(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const targetInputReceiptOutputSchema = z
  .object({
    receipt: z
      .object({
        resolutionId: z.string().min(1),
        mutationId: z.string().min(1),
        outcome: z.enum(["applied", "not-applied", "ambiguous", "acknowledged"]),
        review: targetInputReviewOutputSchema.optional(),
        reviewedAt: z.number(),
        health: z
          .object({
            state: z.enum(["ready", "blocked", "uncertain"]),
            pendingMutationId: z.string().optional(),
            reason: z.string().optional(),
          })
          .strict()
          .optional(),
        observation: targetObservationOutputSchema.optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const receipt = value.receipt;
    if ((receipt.outcome === "acknowledged" || receipt.review !== undefined) && !receipt.review) {
      context.addIssue({
        code: "custom",
        message: "acknowledged receipts require explicit review",
        path: ["receipt", "review"],
      });
    }
    if (receipt.outcome === "acknowledged" && receipt.review?.observed === "uncertain") {
      context.addIssue({
        code: "custom",
        message: "explicit review must resolve the outcome",
        path: ["receipt", "review", "observed"],
      });
    }
  });

export const targetInputReconcileOutputSchema = z
  .object({
    health: targetHealthOutputSchema.shape.health,
    observation: targetObservationOutputSchema,
    mutationId: z.string().min(1).optional(),
    outcome: z.enum(["applied", "not-applied", "ambiguous", "acknowledged"]).optional(),
    review: targetInputReviewOutputSchema.optional(),
    resolutionId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.outcome === "acknowledged" || value.review !== undefined) && !value.review) {
      context.addIssue({
        code: "custom",
        message: "acknowledged reconciliations require explicit review",
        path: ["review"],
      });
    }
    if (value.outcome === "acknowledged" && value.review?.observed === "uncertain") {
      context.addIssue({
        code: "custom",
        message: "explicit review must resolve the outcome",
        path: ["review", "observed"],
      });
    }
  });
