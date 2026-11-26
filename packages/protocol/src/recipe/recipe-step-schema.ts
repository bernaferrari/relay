import * as z from "zod/v4";
import type { RecipeStep } from "../recipes.js";
import {
  reviewedDocumentOriginReferenceSchema,
  scrollSurfaceDocumentOriginProofSchema,
  scrollSurfaceViewportSchema,
} from "./recipe-scroll-surface-schema.js";

const rectSchema = z
  .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
  .strict();

export const stepPointAnchorTargetSchema = z
  .object({
    identifier: z.string().optional(),
    ref: z.string().optional(),
    label: z.string().optional(),
    role: z.string().optional(),
    text: z.string().optional(),
  })
  .strict();

export const stepPointSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    anchor: z
      .object({
        horizontal: z.enum(["left", "center", "right"]),
        vertical: z.enum(["top", "center", "bottom"]),
      })
      .strict()
      .optional(),
    referenceBounds: z.object({ width: z.number(), height: z.number() }).strict().optional(),
    fallbackPolicy: z.literal("reviewed").optional(),
    relativeTo: z
      .object({ target: stepPointAnchorTargetSchema, xRatio: z.number(), yRatio: z.number() })
      .strict()
      .optional(),
  })
  .strict();

export const stepTargetSchema = z
  .object({
    identifier: z.string().optional(),
    ref: z.string().optional(),
    label: z.string().optional(),
    role: z.string().optional(),
    text: z.string().optional(),
    relation: z
      .object({ kind: z.literal("following-row"), anchor: stepPointAnchorTargetSchema })
      .strict()
      .optional(),
    point: stepPointSchema.optional(),
  })
  .strict();

export const normalizedSemanticNodeSchema = z
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

export const screenIdentityObservationSchema = z
  .object({
    fingerprint: z.string().min(1),
    nodes: z.array(normalizedSemanticNodeSchema),
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

const destinationEvidenceSurfaceSchema = z.enum([
  "ordinary",
  "modal",
  "preview",
  "confirmation",
  "dead-end",
]);

const ignoreRegionSchema = rectSchema.extend({ name: z.string().optional() }).strict();

export const recipeParameterSchema = z
  .object({
    name: z.string().min(1),
    label: z.string().optional(),
    description: z.string().optional(),
    default: z.string().optional(),
    required: z.boolean().optional(),
  })
  .strict();

const recordedNodeEvidenceSchema = z
  .object({
    label: z.string().optional(),
    value: z.string().optional(),
    identifier: z.string().optional(),
    role: z.string().optional(),
    type: z.string().optional(),
    ref: z.string().optional(),
    index: z.number().optional(),
    parentIndex: z.number().optional(),
    rect: rectSchema.optional(),
  })
  .strict();

const recordedSelectorCandidateSchema = z
  .object({
    strategy: z.enum(["identifier", "ref", "label", "text", "point"]),
    label: z.string(),
    source: z.enum(["element", "ancestor", "coordinate"]),
    confidence: z.enum(["high", "medium", "fallback"]),
    target: stepTargetSchema,
  })
  .strict();

const recordedStepEvidenceSchema = z
  .object({
    id: z.string(),
    recordedAt: z.number(),
    serial: z.string().optional(),
    capture: z
      .object({
        schemaVersion: z.literal(1),
        uiTreeCapturedAt: z.number().optional(),
        screenshotCapturedAt: z.number().optional(),
        status: z.enum(["complete", "partial"]),
        issues: z
          .array(z.enum(["missing-ui-tree", "missing-screenshot", "missing-target"]))
          .optional(),
      })
      .strict()
      .optional(),
    deviceBounds: z.object({ width: z.number(), height: z.number() }).strict().optional(),
    pointer: z.object({ x: z.number(), y: z.number() }).strict().optional(),
    node: recordedNodeEvidenceSchema.optional(),
    ancestors: z.array(recordedNodeEvidenceSchema).optional(),
    nodes: z.array(recordedNodeEvidenceSchema).optional(),
    candidates: z.array(recordedSelectorCandidateSchema).optional(),
    screenshot: z
      .object({
        recipeId: z.string(),
        id: z.string(),
        capturedAt: z.number(),
        mime: z.literal("image/png"),
        bytes: z.number().optional(),
        sha256: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const reviewedExternalEffectsSchema = z
  .object({
    schemaVersion: z.literal(1),
    effects: z.array(
      z.enum([
        "communication",
        "purchase",
        "account-mutation",
        "data-deletion",
        "permission-change",
        "installation",
        "external-app",
      ]),
    ),
    reviewedBy: z.string(),
    reviewedAt: z.number(),
    reason: z.string(),
  })
  .strict();

const whenClauseSchema = z
  .object({
    target: stepTargetSchema,
    condition: z.enum(["present", "absent"]),
    region: z
      .object({
        minX: z.number().optional(),
        maxX: z.number().optional(),
        minY: z.number().optional(),
        maxY: z.number().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const connectionDestinationSchema = z.union([
  z.object({ kind: z.literal("screen"), screenId: z.string() }).strict(),
  z.object({ kind: z.literal("end") }).strict(),
]);

const semanticRevealPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    documentHeight: z.number(),
    viewportHeight: z.number(),
    anchors: z.array(
      z
        .object({
          order: z.number(),
          documentY: z.number(),
          target: stepTargetSchema,
          label: z.string().optional(),
          role: z.string().optional(),
          value: z.string().optional(),
          enabled: z.boolean().optional(),
          selected: z.boolean().optional(),
        })
        .strict(),
    ),
    surfaceId: z.string(),
    captureId: z.string(),
    targetOrder: z.number(),
    targetDocumentY: z.number(),
  })
  .strict();

const recipeStepMetadataShape = {
  id: z.string().optional(),
  coverage: z.enum(["inspect", "transition"]).optional(),
  group: z.string().optional(),
  evidence: recordedStepEvidenceSchema.optional(),
  note: z.string().optional(),
  reviewedExternalEffects: reviewedExternalEffectsSchema.optional(),
  optional: z.boolean().optional(),
  check: z
    .object({
      id: z.string(),
      title: z.string(),
      warmSourceScreenId: z.string().optional(),
      transitionDependencies: z
        .array(
          z
            .object({
              connectionId: z.string(),
              originScreenId: z.string(),
              destination: connectionDestinationSchema,
              expectedApp: z.string().optional(),
            })
            .strict(),
        )
        .optional(),
      recovery: z
        .object({
          groupId: z.string(),
          recipeId: z.string(),
          transitionId: z.string().optional(),
          mode: z.literal("warm-transition").optional(),
          coldRecipeId: z.string().optional(),
        })
        .strict()
        .optional(),
      cleanup: z
        .object({
          recipeId: z.string(),
          bindings: z.record(z.string(), z.string()).optional(),
          terminalScreenId: z.string(),
          onCancel: z.enum(["run-if-controllable", "skip"]),
        })
        .strict()
        .optional(),
    })
    .strict()
    .optional(),
  when: whenClauseSchema.optional(),
  leftoverSkip: z.literal("dest").optional(),
} as const;

const tapStepSchema = z
  .object({
    ...recipeStepMetadataShape,
    kind: z.literal("tap"),
    target: stepTargetSchema,
    expectedApp: z.string().optional(),
    fallbackTargets: z.array(stepTargetSchema).optional(),
    navigationContract: z
      .object({
        connectionId: z.string(),
        expectedScreenId: z.string(),
        expectedFingerprint: z.string(),
        evidenceIds: z.array(z.string()),
      })
      .strict()
      .optional(),
    gesture: z.enum(["single", "multi", "hold"]).optional(),
    tapCount: z.number().optional(),
    intervalMs: z.number().optional(),
    durationMs: z.number().optional(),
  })
  .strict();

const keyStepSchema = z
  .object({
    ...recipeStepMetadataShape,
    kind: z.literal("key"),
    key: z.enum(["back", "home", "recents"]),
  })
  .strict();

const swipeStepSchema = z
  .object({
    ...recipeStepMetadataShape,
    kind: z.literal("swipe"),
    from: stepPointSchema,
    to: stepPointSchema,
    durationMs: z.number().optional(),
  })
  .strict();

const scrollStepSchema = z
  .object({
    ...recipeStepMetadataShape,
    kind: z.literal("scroll"),
    direction: z.enum(["down", "up"]),
    amount: z.number().optional(),
    until: z
      .object({
        screenId: z.string(),
        screenTitle: z.string(),
        fingerprint: z.string(),
        aliases: z.array(z.string()).optional(),
        observations: z.array(screenIdentityObservationSchema).optional(),
      })
      .strict()
      .optional(),
    maxAttempts: z.number().optional(),
  })
  .strict();

const mappedPreludeStepSchema = z.union([
  tapStepSchema,
  keyStepSchema,
  swipeStepSchema,
  scrollStepSchema,
]);

const recipeStepSchemaUnion = z.union([
  tapStepSchema,
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("type"),
      text: z.string(),
      target: stepTargetSchema.optional(),
      mode: z.enum(["append", "replace"]).optional(),
    })
    .strict(),
  scrollStepSchema,
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("reveal"),
      target: stepTargetSchema,
      direction: z.enum(["up", "down", "auto"]).optional(),
      maxAttempts: z.number().optional(),
      navigation: z.array(semanticRevealPlanSchema).optional(),
    })
    .strict(),
  swipeStepSchema,
  keyStepSchema,
  z.object({ ...recipeStepMetadataShape, kind: z.literal("sleep"), ms: z.number() }).strict(),
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("wait-for"),
      target: stepTargetSchema,
      timeoutMs: z.number().optional(),
    })
    .strict(),
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("wait-response"),
      target: stepTargetSchema,
      busyTarget: stepTargetSchema.optional(),
      idleTarget: stepTargetSchema.optional(),
      timeoutMs: z.number().optional(),
      stableForMs: z.number().optional(),
      maxMs: z.number().optional(),
    })
    .strict(),
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("expect"),
      target: stepTargetSchema,
      condition: z.enum(["visible", "gone"]),
      timeoutMs: z.number().optional(),
    })
    .strict(),
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("expect-set"),
      identifierPrefix: z.string().optional(),
      scope: stepTargetSchema.optional(),
      labels: z.array(z.string()),
      timeoutMs: z.number().optional(),
      extras: z.enum(["forbid", "allow"]).optional(),
    })
    .strict(),
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("expect-screen"),
      screenId: z.string(),
      screenTitle: z.string(),
      fingerprint: z.string(),
      expectedApp: z.string().optional(),
      aliases: z.array(z.string()).optional(),
      timeoutMs: z.number().optional(),
      observations: z.array(screenIdentityObservationSchema).optional(),
      ignoreRegions: z.array(ignoreRegionSchema).optional(),
      returnRequirement: z
        .object({
          connectionId: z.string(),
          fromScreenId: z.string(),
          destinationScreenId: z.string(),
        })
        .strict()
        .optional(),
      evidenceSurface: destinationEvidenceSurfaceSchema.optional(),
      recovery: z
        .object({
          strategy: z.literal("back"),
          maxAttempts: z.number().optional(),
          restoreParentViewport: z.boolean().optional(),
        })
        .strict()
        .optional(),
      repairCheckpoint: z
        .object({
          sourceRunId: z.string(),
          sourceCheckId: z.string(),
          sourceInputDigest: z.string(),
          transitionId: z.string().optional(),
        })
        .strict()
        .optional(),
      destinationSurvey: z.object({ maxScrolls: z.number() }).strict().optional(),
      preludeSteps: z.array(mappedPreludeStepSchema).optional(),
      preludeStartFingerprint: z.string().optional(),
    })
    .strict(),
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("extract"),
      as: z.string(),
      target: stepTargetSchema,
      role: z.enum(["user", "assistant", "system"]).optional(),
    })
    .strict(),
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("assert-content"),
      input: z.string(),
      expected: z.string(),
      match: z.enum(["exact", "equals", "contains", "not-contains", "number-equals", "field"]),
      field: z.string().optional(),
    })
    .strict(),
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("assert-layout"),
      relation: z.literal("non-overlap"),
      first: stepTargetSchema,
      second: stepTargetSchema,
      timeoutMs: z.number().optional(),
    })
    .strict(),
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("evaluate-semantic"),
      input: z.string(),
      criteria: z.array(z.string()),
      threshold: z.number().optional(),
      provider: z.string().optional(),
      model: z.string().optional(),
      requireAgreement: z.boolean().optional(),
      secondProvider: z.string().optional(),
      secondModel: z.string().optional(),
    })
    .strict(),

  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("act"),
      intent: z.string(),
      maxActions: z.number().optional(),
      model: z.string().optional(),
      cached: z.array(z.lazy(() => recipeStepSchema)).optional(),
    })
    .strict(),
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("evaluate-visual"),
      criteria: z.array(z.string()),
      threshold: z.number().optional(),
      provider: z.string().optional(),
      model: z.string().optional(),
      requireAgreement: z.boolean().optional(),
      secondProvider: z.string().optional(),
      secondModel: z.string().optional(),
      region: rectSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("identity-ignore"),
      region: rectSchema,
      name: z.string().optional(),
    })
    .strict(),
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("pause"),
      message: z.string(),
      reason: z
        .enum([
          "authentication",
          "consent",
          "verification",
          "captcha",
          "permission",
          "review",
          "other",
        ])
        .optional(),
      resumeLabel: z.string().optional(),
      timeoutMs: z.number().optional(),
      verifyAfter: z
        .object({
          target: stepTargetSchema,
          condition: z.enum(["visible", "gone"]).optional(),
          timeoutMs: z.number().optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("review"),
      capability: z.string(),
      reason: z.string(),
    })
    .strict(),
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("screenshot"),
      caption: z.string().optional(),
      review: z
        .object({
          mode: z.literal("later"),
          lookFor: z.string().optional(),
          policy: z.enum(["fast", "stable", "sequence"]).optional(),
          checkpointId: z.string().optional(),
          phase: z.string().optional(),
          phases: z
            .array(
              z
                .object({
                  id: z.string(),
                  caption: z.string().optional(),
                  lookFor: z.string().optional(),
                  intervalMs: z.number().optional(),
                })
                .strict(),
            )
            .optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("capture-surface"),
      screenId: z.string(),
      screenTitle: z.string(),
      variantId: z.string(),
      surfaceId: z.string(),
      baselineCaptureId: z.string(),
      reason: z.string(),
      maxScrolls: z.number().optional(),
      forceRecapture: z.boolean().optional(),
      baselineTrust: z.enum(["trusted", "recapture-required"]).optional(),
      baselineTrustReason: z.string().optional(),
      documentOrigin: scrollSurfaceViewportSchema.optional(),
      documentOriginProof: scrollSurfaceDocumentOriginProofSchema.optional(),
      reviewedDocumentOrigin: reviewedDocumentOriginReferenceSchema.optional(),
      baseline: z
        .object({
          compositeWidth: z.number().optional(),
          compositeHeight: z.number().optional(),
          semanticNodeCount: z.number(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("tour"),
      depth: z.number().optional(),
      screenshot: z.boolean().optional(),
      captureOrigin: z.boolean().optional(),
      originVerifiedBySetup: z.boolean().optional(),
      maxStops: z.number().optional(),
      excludeLanguageRows: z.boolean().optional(),
      originScreenId: z.string().optional(),
      originTitle: z.string().optional(),
      originFingerprint: z.string().optional(),
      originAliases: z.array(z.string()).optional(),
      originObservations: z.array(screenIdentityObservationSchema).optional(),
      preludeSteps: z.array(mappedPreludeStepSchema).max(16).optional(),
      preludeStartFingerprint: z.string().optional(),
      preludeStartAliases: z.array(z.string()).optional(),
      fallbackStops: z
        .array(
          z
            .object({
              label: z.string(),
              identifier: z.string().optional(),
              point: z.object({ x: z.number(), y: z.number() }).strict().optional(),
              capture: z.boolean().optional(),
              optional: z.boolean().optional(),
              evidenceSurface: destinationEvidenceSurfaceSchema.optional(),
            })
            .strict(),
        )
        .optional(),
      landmarkStops: z
        .array(
          z
            .object({
              label: z.string(),
              identifier: z.string().optional(),
              point: z.object({ x: z.number(), y: z.number() }).strict().optional(),
            })
            .strict(),
        )
        .optional(),
      mappedStopsOnly: z.boolean().optional(),
      scrollSearch: z
        .object({ maxScrolls: z.number().optional(), amount: z.number().optional() })
        .strict()
        .optional(),
      returnAfterLast: z.boolean().optional(),
    })
    .strict(),
  z.object({ ...recipeStepMetadataShape, kind: z.literal("flow"), flow: z.string() }).strict(),
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("module"),
      recipeId: z.string(),
      bindings: z.record(z.string(), z.string()).optional(),
    })
    .strict(),
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("branch"),
      input: z.string(),
      operator: z.enum(["exists", "equals", "not-equals", "contains"]),
      expected: z.string().optional(),
      thenRecipeId: z.string(),
      elseRecipeId: z.string().optional(),
    })
    .strict(),
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("repeat"),
      count: z.number(),
      recipeId: z.string(),
    })
    .strict(),
  z.object({ ...recipeStepMetadataShape, kind: z.literal("script"), source: z.string() }).strict(),
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("clipboard"),
      action: z.enum(["write", "read", "paste", "copy"]),
      text: z.string().optional(),
      target: stepTargetSchema.optional(),
      expect: z.string().optional(),
      match: z.enum(["exact", "contains"]).optional(),
    })
    .strict(),
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("app"),
      action: z.enum([
        "open",
        "close",
        "switcher",
        "inspect",
        "assert-installed",
        "assert-not-installed",
        "set-locale",
        "install",
        "update",
        "uninstall",
        "background",
      ]),
      backgroundMs: z.number().optional(),
      app: z.string().optional(),
      locale: z.string().optional(),
      url: z.string().optional(),
      relaunch: z.boolean().optional(),
      artifact: z.string().optional(),
      as: z.string().optional(),
      version: z.string().optional(),
      versionMatch: z.enum(["exact", "contains"]).optional(),
    })
    .strict(),
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("device"),
      action: z.enum(["lock", "unlock", "keyboard-dismiss", "keyboard-enter"]),
    })
    .strict(),
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("rotate"),
      orientation: z.enum([
        "portrait",
        "portrait-upside-down",
        "landscape-left",
        "landscape-right",
      ]),
    })
    .strict(),
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("settings"),
      setting: z.enum(["wifi", "airplane", "mobile-data", "location", "animations", "appearance"]),
      state: z.enum(["on", "off", "light", "dark", "toggle"]),
    })
    .strict(),
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("location"),
      latitude: z.number(),
      longitude: z.number(),
    })
    .strict(),
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("permission"),
      action: z.enum(["grant", "deny", "reset"]),
      permission: z.enum([
        "camera",
        "microphone",
        "photos",
        "contacts",
        "notifications",
        "calendar",
        "location",
        "location-always",
        "media-library",
        "motion",
        "reminders",
        "siri",
      ]),
    })
    .strict(),
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("alert"),
      action: z.enum(["get", "accept", "dismiss", "wait"]),
      timeoutMs: z.number().optional(),
    })
    .strict(),
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("network"),
      action: z.enum(["dump", "log"]),
      include: z.enum(["summary", "headers", "body", "all"]).optional(),
      limit: z.number().optional(),
    })
    .strict(),
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("logs"),
      action: z.enum(["start", "stop", "mark", "clear"]),
      message: z.string().optional(),
    })
    .strict(),
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("offline"),
      state: z.enum(["on", "off"]),
    })
    .strict(),
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("download"),
      file: z.string(),
      target: stepTargetSchema,
    })
    .strict(),
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("media-check"),
      file: z.string(),
      media: z.enum(["image", "video", "audio"]),
      width: z.number().optional(),
      height: z.number().optional(),
      minDurationMs: z.number().optional(),
      minBytes: z.number().optional(),
      sourceFile: z.string().optional(),
      relation: z.enum(["edited", "upscaled", "extended"]).optional(),
    })
    .strict(),
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("audio-record"),
      target: stepTargetSchema,
      file: z.string(),
      durationMs: z.number(),
    })
    .strict(),
  z
    .object({
      ...recipeStepMetadataShape,
      kind: z.literal("upload"),
      file: z.string(),
      target: stepTargetSchema.optional(),
    })
    .strict(),
]) satisfies z.ZodType<RecipeStep>;

/** Canonical recursive Recipe Step contract. The union above is structurally
 * strict; the canonical annotation keeps API inference exact through the
 * recursive `act.cached` / `tour.preludeSteps` references. */
export const recipeStepSchema: z.ZodType<RecipeStep> = recipeStepSchemaUnion;
