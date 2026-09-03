import * as z from "zod/v4";
import { browserCaseProfileSchema } from "./browser-case-profile.js";
import { stateFixtureSchema } from "./exploration-policy.js";

const pointSchema = z.object({ x: z.number(), y: z.number() }).strict();
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
    androidAvdName: z.string().optional(),
    osVersion: z.string().optional(),
    viewport: z.object({ width: z.number(), height: z.number() }).strict().optional(),
    browserCaseProfile: browserCaseProfileSchema.optional(),
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

const discoveryExploreCursorSchema = z
  .object({
    schemaVersion: z.literal(1),
    stack: z
      .array(
        z
          .object({
            screenId: z.string(),
            pendingControlIds: z.array(z.string()),
          })
          .strict(),
      )
      .max(500),
    exploredEdgeKeys: z.array(z.string()).max(2_000),
    sameScreenActions: z.record(z.string(), z.number().int().nonnegative()).default({}),
    inFlight: z.object({ screenId: z.string(), controlId: z.string() }).strict().optional(),
  })
  .strict();

const discoveryExploreFixtureSchema = z
  .object({
    definition: stateFixtureSchema,
    phase: z.enum(["preparing", "prepared", "verified", "cleanup-pending", "cleaned"]),
  })
  .strict();

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
        cursor: discoveryExploreCursorSchema.optional(),
        fixture: discoveryExploreFixtureSchema.optional(),
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
