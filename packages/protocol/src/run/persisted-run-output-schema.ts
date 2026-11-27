import * as z from "zod/v4";
import { browserAuthenticationHealthSchema } from "../browser/browser-authentication-fixture.js";
import { browserCaseProfileSchema } from "../browser/browser-case-profile.js";
import {
  captureReviewDecisionOutputSchema,
  captureReferenceComparisonSchema,
} from "../capture/capture-review-shared-schemas.js";
import { sourceRevisionSchema } from "../app-map/app-map-test-run-schemas.js";
import {
  executionTargetSchema,
  runReviewSchema,
  targetProfileSchema,
} from "../execution/execution-target-schemas.js";
import { runTestStepEvidenceSchema } from "./run-test-step-evidence.js";

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
    path: z.string().min(1),
    caption: z.string(),
    capturedAt: z.number(),
    bytes: z.number().optional(),
    base64: z.string().optional(),
    mime: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    stepId: z.string().optional(),
  })
  .strict();
const traceStep = z
  .object({
    attempt: z.number().optional(),
    id: z.string().min(1),
    index: z.number(),
    recipeId: z.string().optional(),
    recipeStepId: z.string().optional(),
    kind: stepKind,
    tone: stepTone,
    title: z.string(),
    glyphs: z.array(glyph),
    actions: z
      .array(z.object({ kind: glyph, at: z.number(), label: z.string().optional() }).strict())
      .optional(),
    startedAt: z.number(),
    finishedAt: z.number().optional(),
    durationMs: z.number().optional(),
    frames: z.array(traceFrame),
    log: z.string(),
    heal: z.string().optional(),
    status: z.enum(["running", "ok", "error", "healed"]).optional(),
  })
  .strict();

/** Durable Run envelope returned by human review mutations. Collector-owned
 * result/evidence/artifact payloads remain nested extension points, but the
 * Run identity, provenance, lineage, timing, review, and trace envelope are exact. */
export const persistedRunOutputSchema = z
  .object({
    schemaVersion: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    id: z.string().min(1),
    projectId: z.string().optional(),
    ownerId: z.string().optional(),
    action: z.string(),
    title: z.string().optional(),
    serial: z.string().optional(),
    deviceName: z.string().optional(),
    platform: z.string().optional(),
    executionTarget: executionTargetSchema.optional(),
    browserCaseProfile: browserCaseProfileSchema.optional(),
    targetProfile: targetProfileSchema.optional(),
    laneId: z.string().optional(),
    unsignedLaneId: z.string().optional(),
    authenticationHealth: browserAuthenticationHealthSchema.optional(),
    status: z.string(),
    healed: z.boolean().optional(),
    healMessage: z.string().optional(),
    attempts: z.number(),
    retryOf: z.string().optional(),
    retriedBy: z.string().optional(),
    queuedAt: z.number(),
    startedAt: z.number().optional(),
    finishedAt: z.number().optional(),
    durationMs: z.number().optional(),
    result: z.unknown().optional(),
    error: z.string().optional(),
    errorCode: z.string().optional(),
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
    review: runReviewSchema.optional(),
    referenceReviewMode: z.enum(["human", "approved-reference"]).optional(),
    captureReviews: z.array(captureReviewDecisionOutputSchema).optional(),
    captureComparisons: z.record(z.string(), captureReferenceComparisonSchema).optional(),
    captureReviewReceipts: z.array(captureReviewDecisionOutputSchema).optional(),
    appVersion: z.string().optional(),
    batchId: z.string().optional(),
    caseIndex: z.number().optional(),
    caseCount: z.number().optional(),
    logs: z.array(z.string()),
    steps: z.array(traceStep),
    testStepEvidence: z.array(runTestStepEvidenceSchema).optional(),
    frames: z.array(traceFrame),
    frameCount: z.number().optional(),
    dir: z.string().min(1),
    writtenAt: z.number(),
    recipeSnapshot: z.unknown().optional(),
    recipeGraph: z.record(z.string(), z.unknown()).optional(),
    artifacts: z.array(
      z.object({ kind: z.string().min(1), capturedAt: z.number(), data: z.unknown() }).strict(),
    ),
    inputDigest: z.string(),
    resolvedInputs: z.record(z.string(), z.string()),
    evidence: z.unknown().optional(),
    executionProvenance: z
      .object({
        schemaVersion: z.literal(1),
        actorId: z.string(),
        actorKind: z.enum(["human", "agent", "system"]),
        organizationId: z.string(),
        projectId: z.string(),
        operationId: z.string(),
        requestId: z.string(),
        issuedAt: z.number(),
        causationId: z.string().optional(),
        correlationId: z.string().optional(),
        authoringSessionId: z.string().optional(),
        leaseId: z.string().optional(),
      })
      .strict()
      .optional(),
    sourceRevision: sourceRevisionSchema.optional(),
  })
  .strict();
