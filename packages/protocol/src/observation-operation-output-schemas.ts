import * as z from "zod/v4";

const pointSchema = z.object({ x: z.number(), y: z.number() }).strict();
const rectSchema = z
  .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
  .strict();

const targetCapabilitySchema = z.enum([
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

const targetProfileSchema = z
  .object({
    id: z.string(),
    targetId: z.string(),
    source: z.enum(["device", "browser"]),
    platform: z.enum(["android", "ios", "browser"]),
    name: z.string(),
    model: z.string().optional(),
    osVersion: z.string().optional(),
    viewport: z.object({ width: z.number(), height: z.number() }).strict().optional(),
    capabilities: z.array(targetCapabilitySchema),
    observedAt: z.number(),
  })
  .strict();

const discoveryTargetSchema = z
  .object({
    identifier: z.string().optional(),
    ref: z.string().optional(),
    label: z.string().optional(),
    text: z.string().optional(),
    point: pointSchema.optional(),
  })
  .strict();

const discoveryControlSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    role: z.string().optional(),
    target: discoveryTargetSchema,
  })
  .strict();

const screenIdentitySchema = z
  .object({
    schemaVersion: z.literal(1),
    fingerprint: z.string(),
    aliases: z.array(z.string()).optional(),
  })
  .strict();

const observedScreenSchema = z
  .object({
    id: z.string(),
    fingerprint: z.string(),
    identity: screenIdentitySchema.optional(),
    title: z.string().optional(),
    capturedAt: z.number(),
    screenshotPath: z.string().optional(),
    accessibilityPath: z.string().optional(),
    snapshotDigest: z.string().optional(),
    accessibilityDigest: z.string().optional(),
    variantOf: z.string().optional(),
    controls: z.array(discoveryControlSchema).optional(),
  })
  .strict();

const discoveryDecisionSchema = z
  .object({
    mode: z.enum(["model", "semantic"]),
    provider: z.string(),
    model: z.string(),
    selectedControlId: z.string(),
    requestId: z.string().optional(),
    promptDigest: z.string().optional(),
    durationMs: z.number().optional(),
  })
  .strict();

const observedTransitionSchema = z
  .object({
    id: z.string(),
    fromScreenId: z.string(),
    toScreenId: z.string().optional(),
    kind: z.enum(["tap", "type", "scroll", "back", "manual"]),
    label: z.string().optional(),
    target: discoveryTargetSchema.optional(),
    text: z.string().optional(),
    direction: z.enum(["up", "down"]).optional(),
    capturedAt: z.number(),
    changedScreen: z.boolean(),
    decision: discoveryDecisionSchema.optional(),
  })
  .strict();

const navigationProofPreviousSchema = z
  .object({ screenId: z.string(), proofToken: z.string() })
  .strict();
const navigationProofSchema = z.discriminatedUnion("status", [
  z
    .object({
      schemaVersion: z.literal(1),
      status: z.literal("proven"),
      screenId: z.string(),
      proofToken: z.string(),
      source: z.enum(["screen-observation", "transition", "cleanup"]),
      updatedAt: z.number(),
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(1),
      status: z.literal("unknown"),
      reason: z.string(),
      updatedAt: z.number(),
      previous: navigationProofPreviousSchema.optional(),
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(1),
      status: z.literal("external-handoff"),
      foregroundApp: z.string(),
      reason: z.string(),
      updatedAt: z.number(),
      previous: navigationProofPreviousSchema.optional(),
    })
    .strict(),
]);

const discoverySessionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    projectId: z.string().optional(),
    organizationId: z.string().optional(),
    targetId: z.string(),
    targetProfile: targetProfileSchema.optional(),
    agent: z
      .object({
        workerId: z.string(),
        appMapId: z.string(),
        goal: z.string(),
        focus: z.string().optional(),
        provider: z.string(),
        model: z.string().optional(),
        buildId: z.string().optional(),
        caseStackId: z.string().optional(),
        source: z.enum(["ui", "cli", "mcp", "api"]),
        createdBy: z
          .object({ actorId: z.string(), actorKind: z.enum(["human", "agent", "system"]) })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    scope: z
      .object({
        maxScreens: z.number(),
        maxTransitions: z.number(),
        maxDurationMs: z.number(),
        allowedOrigins: z.array(z.string()).optional(),
        allowSensitiveControls: z.boolean().optional(),
        strategy: z.enum(["surface", "timeline", "hard-edges"]).optional(),
        maxDepth: z.number().optional(),
      })
      .strict(),
    status: z.enum(["draft", "running", "paused", "complete", "stopped"]),
    createdAt: z.number(),
    updatedAt: z.number(),
    currentScreenId: z.string().optional(),
    explore: z
      .object({
        strategy: z.enum(["surface", "timeline", "hard-edges"]),
        maxDepth: z.number(),
        problems: z
          .array(
            z
              .object({
                screenId: z.string(),
                controlId: z.string(),
                label: z.string(),
                reason: z.string(),
                capturedAt: z.number(),
              })
              .strict(),
          )
          .optional(),
        stopReason: z
          .object({
            code: z.enum(["complete", "cancelled", "budget", "left_app", "error"]),
            message: z.string(),
            at: z.number(),
          })
          .strict()
          .optional(),
        navigationCursor: navigationProofSchema.optional(),
        startedAt: z.number(),
        updatedAt: z.number(),
      })
      .strict()
      .optional(),
    screens: z.array(observedScreenSchema),
    transitions: z.array(observedTransitionSchema),
  })
  .strict();

const discoveryHereSchema = z
  .object({
    screen: z
      .object({
        id: z.string(),
        title: z.string().optional(),
        fingerprint: z.string(),
        screenshotPath: z.string().optional(),
        capturedAt: z.number(),
        controlCount: z.number(),
      })
      .strict(),
    options: z.array(discoveryControlSchema.extend({ opened: z.boolean() }).strict()),
    suggestion: discoveryControlSchema.nullable(),
    foregroundApp: z.string().optional(),
    canBack: z.boolean(),
    map: z
      .object({ id: z.string(), screens: z.number(), connections: z.number() })
      .strict()
      .optional(),
  })
  .strict();

const discoveryExplorationTimelineSchema = z
  .object({
    sessionId: z.string(),
    mapName: z.string(),
    generatedAt: z.number(),
    status: z.enum(["draft", "running", "paused", "complete", "stopped"]),
    stepCount: z.number(),
    steps: z.array(
      z
        .object({
          index: z.number(),
          transitionId: z.string(),
          kind: z.enum(["tap", "type", "scroll", "back", "manual"]),
          label: z.string().optional(),
          fromScreenId: z.string(),
          toScreenId: z.string().optional(),
          fromTitle: z.string().optional(),
          toTitle: z.string().optional(),
          changedScreen: z.boolean(),
          capturedAt: z.number(),
          screenshotPath: z.string().optional(),
          screenshotScreenId: z.string().optional(),
        })
        .strict(),
    ),
  })
  .strict();

const discoveryCoverageItemSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    observedProfileIds: z.array(z.string()),
    missingProfileIds: z.array(z.string()),
    sessionIds: z.array(z.string()),
  })
  .strict();
const discoveryCoverageSchema = z
  .object({
    mapName: z.string(),
    generatedAt: z.number(),
    sessionIds: z.array(z.string()),
    profiles: z.array(targetProfileSchema),
    unprofiledSessionIds: z.array(z.string()),
    screens: z.array(discoveryCoverageItemSchema),
    transitions: z.array(discoveryCoverageItemSchema),
    explorationTimeline: discoveryExplorationTimelineSchema.optional(),
    blockedReasons: z
      .array(
        z
          .object({
            code: z.enum(["left-app", "auth", "budget", "cancelled", "incomplete", "error"]),
            message: z.string(),
            evidence: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
    exploreOutcome: z.enum(["complete", "partial", "blocked", "running", "draft"]).optional(),
  })
  .strict();

const corpusControlTargetSchema = discoveryTargetSchema;
const corpusNavTargetSchema = discoveryTargetSchema
  .extend({ stableKey: z.string().optional() })
  .strict();
const corpusNavStepSchema: z.ZodType = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tap"), target: corpusNavTargetSchema }).strict(),
  z.object({ kind: z.literal("back") }).strict(),
  z.object({ kind: z.literal("wait"), ms: z.number() }).strict(),
  z
    .object({
      kind: z.literal("scroll"),
      direction: z.enum(["up", "down"]),
      amount: z.number().optional(),
    })
    .strict(),
  z.object({ kind: z.literal("relaunch") }).strict(),
  z
    .object({ kind: z.literal("openApp"), app: z.string(), relaunch: z.boolean().optional() })
    .strict(),
]);
const corpusJourneyStepSchema = z.union([
  corpusNavStepSchema,
  z.object({ kind: z.literal("capture"), name: z.string(), key: z.string().optional() }).strict(),
]);

const corpusControlSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    stableKey: z.string(),
    role: z.string().optional(),
    target: corpusControlTargetSchema,
    rect: rectSchema.optional(),
    skipCrawl: z.literal(true).optional(),
  })
  .strict();

const corpusScreenSchema = z
  .object({
    id: z.string(),
    canonicalKey: z.string(),
    fingerprint: z.string(),
    locale: z.string(),
    depth: z.number(),
    path: z.array(z.string()),
    pathKeys: z.array(z.string()),
    title: z.string().optional(),
    capturedAt: z.number(),
    screenshotPath: z.string().optional(),
    artifactPath: z.string().optional(),
    snapshotDigest: z.string().optional(),
    accessibilityPath: z.string().optional(),
    accessibilityDigest: z.string().optional(),
    controls: z.array(corpusControlSchema).optional(),
    localizedLabels: z.record(z.string(), z.string()).optional(),
  })
  .strict();

const corpusTransitionSchema = z
  .object({
    id: z.string(),
    fromScreenId: z.string(),
    toScreenId: z.string().optional(),
    locale: z.string(),
    kind: z.enum(["tap", "scroll", "back", "relaunch", "manual"]),
    label: z.string().optional(),
    stableKey: z.string().optional(),
    target: corpusControlTargetSchema.optional(),
    depth: z.number(),
    capturedAt: z.number(),
    changedScreen: z.boolean(),
  })
  .strict();

const corpusMapActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("open"),
      stableKey: z.string(),
      label: z.string(),
      target: corpusControlTargetSchema,
      depth: z.number(),
      pathKeys: z.array(z.string()),
      path: z.array(z.string()),
      fromCanonicalKey: z.string(),
      toCanonicalKey: z.string().optional(),
    })
    .strict(),
  z.object({ kind: z.literal("back"), depth: z.number(), fromCanonicalKey: z.string() }).strict(),
]);
const corpusMapPlanSchema = z
  .object({
    mappedLocale: z.string(),
    rootCanonicalKey: z.string().optional(),
    actions: z.array(corpusMapActionSchema),
    mappedAt: z.number(),
  })
  .strict();

const corpusTerminalSchema = z
  .object({
    code: z.literal("ios-mutation-outcome-unknown"),
    message: z.string(),
    recordedAt: z.number(),
    operation: z.string(),
    nativeAttempts: z.literal(1),
    nextAction: z.literal("capture-current-screen-before-any-retry"),
    evidence: z
      .object({
        corpusSessionId: z.string(),
        lastCapturedScreenId: z.string().optional(),
        screenshotPath: z.string().optional(),
        accessibilityPath: z.string().optional(),
      })
      .strict(),
  })
  .strict();

const corpusScopeSchema = z
  .object({
    maxDepth: z.number(),
    maxScreens: z.number(),
    maxTransitions: z.number(),
    maxDurationMs: z.number(),
    locales: z.array(z.string()),
    strategy: z.enum(["map-once-replay", "crawl-each"]).optional(),
    mapLocale: z.string().optional(),
    app: z.string().optional(),
    entryPath: z.array(corpusNavStepSchema).optional(),
    languagePath: z.array(corpusNavStepSchema).optional(),
    languageOptions: z.record(z.string(), z.array(corpusNavStepSchema)).optional(),
    journeys: z
      .array(
        z
          .object({ id: z.string(), name: z.string(), steps: z.array(corpusJourneyStepSchema) })
          .strict(),
      )
      .optional(),
    allowSensitiveControls: z.boolean().optional(),
  })
  .strict();

const corpusSessionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    projectId: z.string().optional(),
    organizationId: z.string().optional(),
    targetId: z.string(),
    targetProfile: targetProfileSchema.optional(),
    scope: corpusScopeSchema,
    status: z.enum(["draft", "running", "paused", "complete", "stopped", "failed"]),
    createdAt: z.number(),
    updatedAt: z.number(),
    currentScreenId: z.string().optional(),
    currentLocale: z.string().optional(),
    progress: z
      .object({
        phase: z.enum([
          "idle",
          "opening",
          "mapping",
          "switching-language",
          "replaying",
          "crawling",
          "exporting",
          "complete",
          "failed",
        ]),
        locale: z.string().optional(),
        depth: z.number().optional(),
        path: z.array(z.string()).optional(),
        screensCaptured: z.number(),
        transitionsCaptured: z.number(),
        completedLocales: z.array(z.string()).optional(),
        message: z.string().optional(),
        updatedAt: z.number(),
      })
      .strict(),
    screens: z.array(corpusScreenSchema),
    transitions: z.array(corpusTransitionSchema),
    mapPlan: corpusMapPlanSchema.optional(),
    packRoot: z.string().optional(),
    error: z.string().optional(),
    terminal: corpusTerminalSchema.optional(),
  })
  .strict();

const corpusCoverageSchema = z
  .object({
    sessionId: z.string(),
    name: z.string(),
    generatedAt: z.number(),
    locales: z.array(z.string()),
    screens: z.array(
      z
        .object({
          id: z.string(),
          label: z.string(),
          canonicalKey: z.string(),
          observedLocales: z.array(z.string()),
          missingLocales: z.array(z.string()),
          screenIds: z.array(z.string()),
        })
        .strict(),
    ),
    complete: z.number(),
    partial: z.number(),
    missing: z.number(),
  })
  .strict();

const combineEvidenceFindingCodeSchema = z.enum([
  "SCREEN_MISSING",
  "POSSIBLE_LOCALE_NOT_APPLIED",
  "CONTROL_MISSING",
  "POSSIBLE_UNTRANSLATED_TEXT",
  "POSSIBLE_TEXT_CLIPPED",
]);
const combineEvidenceFindingSchema = z
  .object({
    id: z.string(),
    code: combineEvidenceFindingCodeSchema,
    severity: z.enum(["critical", "warning"]),
    confidence: z.enum(["high", "medium"]),
    canonicalKey: z.string(),
    screenLabel: z.string(),
    locale: z.string(),
    baselineLocale: z.string(),
    stableKey: z.string().optional(),
    expected: z.string().optional(),
    observed: z.string().optional(),
    detail: z.string(),
  })
  .strict();
const combineEvidenceAnalysisSchema = z
  .object({
    schemaVersion: z.literal(1),
    sessionId: z.string(),
    generatedAt: z.number(),
    baselineLocale: z.string(),
    findings: z.array(combineEvidenceFindingSchema),
    critical: z.number(),
    warnings: z.number(),
    affectedScreens: z.number(),
  })
  .strict();

const knownFindingSchema = z
  .object({
    id: z.string(),
    code: combineEvidenceFindingCodeSchema,
    canonicalKey: z.string(),
    screenLabel: z.string(),
    locale: z.string(),
    scope: z.enum(["locale", "control"]).optional(),
    detail: z.string(),
    stableKey: z.string().optional(),
    note: z.string().optional(),
    markedAt: z.number(),
    markedBy: z.string().optional(),
  })
  .strict();

const languageProfileSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    app: z.string(),
    platform: z.enum(["ios", "android", "any"]).optional(),
    entryPath: z.array(corpusNavStepSchema),
    languagePath: z.array(corpusNavStepSchema),
    languages: z.array(
      z
        .object({
          tag: z.string(),
          label: z.string(),
          aliases: z.array(z.string()).optional(),
          identifier: z.string().optional(),
        })
        .strict(),
    ),
    defaultLocale: z.string().optional(),
    notes: z.string().optional(),
    verifiedAt: z.string().optional(),
    scanned: z.boolean().optional(),
  })
  .strict();

const switcherProfileSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: z.enum(["language", "account", "environment", "theme", "workspace", "build", "custom"]),
    app: z.string(),
    platform: z.enum(["ios", "android", "any"]).optional(),
    entryPath: z.array(corpusNavStepSchema),
    pickerPath: z.array(corpusNavStepSchema),
    options: z.array(
      z
        .object({
          id: z.string(),
          label: z.string(),
          aliases: z.array(z.string()).optional(),
          identifier: z.string().optional(),
        })
        .strict(),
    ),
    defaultOptionId: z.string().optional(),
    notes: z.string().optional(),
    verifiedAt: z.string().optional(),
    scanned: z.boolean().optional(),
  })
  .strict();

/** Runtime response contracts for App Map discovery routes. */
export const observationOperationOutputSchemas = {
  "discovery.list": z.object({ sessions: z.array(discoverySessionSchema) }).strict(),
  "discovery.create": z.object({ session: discoverySessionSchema }).strict(),
  "discovery.get": z.object({ session: discoverySessionSchema }).strict(),
  "discovery.rename": z.object({ session: discoverySessionSchema }).strict(),
  "discovery.status.update": z.object({ session: discoverySessionSchema }).strict(),
  "discovery.capture": z
    .object({ screen: observedScreenSchema, isNew: z.boolean(), session: discoverySessionSchema })
    .strict(),
  "discovery.interact": z
    .object({
      transition: observedTransitionSchema,
      before: observedScreenSchema,
      after: observedScreenSchema,
    })
    .strict(),
  "discovery.here": z.object({ here: discoveryHereSchema }).strict(),
  "discovery.do": z
    .object({
      transition: observedTransitionSchema,
      changedIdentity: z.boolean(),
      changed: z.boolean(),
      before: observedScreenSchema,
      after: observedScreenSchema,
      here: discoveryHereSchema,
    })
    .strict(),
  "discovery.suggestion": z
    .object({
      suggestion: z
        .object({ screenId: z.string(), control: discoveryControlSchema })
        .strict()
        .nullable(),
    })
    .strict(),
  "discovery.coverage": z.object({ coverage: discoveryCoverageSchema }).strict(),
  "discovery.exploration-timeline": z
    .object({ explorationTimeline: discoveryExplorationTimelineSchema })
    .strict(),
  "discovery.export": z.string(),
  "discovery.promote": z.never(),
  "discovery.start": z.object({ session: discoverySessionSchema }).strict(),
  "discovery.cancel": z.object({ session: discoverySessionSchema }).strict(),
} as const satisfies Readonly<Record<string, z.ZodType>>;
