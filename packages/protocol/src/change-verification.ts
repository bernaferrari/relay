import * as z from "zod/v4";
import { browserCaseProfileSchema } from "./browser-case-profile.js";

export const CHANGE_VERIFICATION_STATES = [
  "planning",
  "awaiting-build",
  "ready",
  "running-pilot",
  "awaiting-expansion",
  "running",
  "proved",
  "rejected",
  "needs-review",
  "insufficient-evidence",
  "cancelled",
  "superseded",
] as const;

export const CHANGE_VERIFICATION_DECISIONS = [
  "proved",
  "rejected",
  "needs-review",
  "insufficient-evidence",
] as const;

const identifier = z.string().trim().min(1).max(256);
const boundedText = z.string().trim().min(1).max(4_096);
const exactGitSha = z
  .string()
  .regex(/^[a-f0-9]{40}$/u, "must be one exact 40-character lowercase Git SHA");
const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const timestamp = z.number().int().nonnegative();

export const changeVerificationChangeSchema = z
  .object({
    repository: z.string().trim().min(1).max(512),
    baseSha: exactGitSha,
    headSha: exactGitSha,
    pullRequest: z.number().int().positive().optional(),
    agentClaim: z
      .object({
        summary: boundedText,
        acceptanceCriteria: z.array(boundedText).max(64).readonly(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((change, context) => {
    if (change.baseSha === change.headSha) {
      context.addIssue({ code: "custom", message: "baseSha and headSha must identify a change" });
    }
  });

export const changeVerificationBuildSchema = z
  .object({
    id: identifier,
    platform: z.enum(["web", "android", "ios"]),
    artifactDigest: sha256,
    sourceSha: exactGitSha,
    configuration: identifier,
    environmentRevision: identifier,
  })
  .strict();

export const changeVerificationAffectedJourneySchema = z
  .object({
    appMapId: identifier,
    testId: identifier,
    reason: boundedText,
    confidence: z.enum(["definite", "probable", "coverage-gap"]),
  })
  .strict();

const executionTargetSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        schemaVersion: z.literal(1),
        kind: z.literal("local-device"),
        provider: z
          .object({ key: z.literal("relay.local.agent-device"), scope: z.literal("local") })
          .strict(),
        targetId: identifier,
        platform: z.enum(["android", "ios"]),
        identity: z.object({ kind: z.literal("device-serial"), value: identifier }).strict(),
      })
      .strict(),
    z
      .object({
        schemaVersion: z.literal(1),
        kind: z.literal("local-browser"),
        provider: z
          .object({ key: z.literal("relay.local.browser"), scope: z.literal("local") })
          .strict(),
        targetId: identifier,
        platform: z.literal("browser"),
        identity: z.object({ kind: z.literal("browser-target"), value: identifier }).strict(),
      })
      .strict(),
    z
      .object({
        schemaVersion: z.literal(1),
        kind: z.literal("provider-session"),
        provider: z.object({ key: identifier, scope: z.literal("remote") }).strict(),
        targetId: identifier,
        platform: z.enum(["android", "ios"]),
        identity: z.object({ kind: z.literal("provider-session"), value: identifier }).strict(),
      })
      .strict(),
  ])
  .superRefine((target, context) => {
    if (target.targetId !== target.identity.value) {
      context.addIssue({
        code: "custom",
        path: ["identity", "value"],
        message: "must equal the public targetId",
      });
    }
  });

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

const frozenTargetProfileSchema = z
  .object({
    id: identifier,
    targetId: identifier,
    source: z.enum(["device", "browser"]),
    platform: z.enum(["android", "ios", "browser"]),
    name: identifier,
    model: identifier.optional(),
    osVersion: identifier.optional(),
    viewport: z
      .object({ width: z.number().int().positive(), height: z.number().int().positive() })
      .strict()
      .optional(),
    browserCaseProfile: browserCaseProfileSchema.optional(),
    capabilities: z.array(targetCapabilitySchema).max(32).readonly(),
    observedAt: timestamp,
  })
  .strict()
  .superRefine((profile, context) => {
    if (profile.source === "browser") {
      if (profile.platform !== "browser" || !profile.browserCaseProfile) {
        context.addIssue({
          code: "custom",
          message: "browser targets require a full browser profile",
        });
      } else if (
        profile.viewport &&
        (profile.viewport.width !== profile.browserCaseProfile.viewport.width ||
          profile.viewport.height !== profile.browserCaseProfile.viewport.height)
      ) {
        context.addIssue({
          code: "custom",
          path: ["viewport"],
          message: "must equal the frozen browser viewport",
        });
      }
    } else if (profile.platform === "browser" || profile.browserCaseProfile) {
      context.addIssue({ code: "custom", message: "device targets cannot carry browser identity" });
    }
  });

export const frozenVerificationTargetCaseSchema = z
  .object({
    id: identifier,
    executionTarget: executionTargetSchema,
    targetProfile: frozenTargetProfileSchema,
    dimensions: z.record(identifier, identifier),
    required: z.boolean(),
  })
  .strict()
  .superRefine((item, context) => {
    if (
      item.executionTarget.targetId !== item.targetProfile.targetId ||
      item.executionTarget.platform !== item.targetProfile.platform
    ) {
      context.addIssue({ code: "custom", message: "execution target and frozen profile disagree" });
    }
  });

export const changeVerificationSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: identifier,
    organizationId: identifier,
    projectId: identifier,
    version: z.number().int().positive(),
    state: z.enum(CHANGE_VERIFICATION_STATES),
    change: changeVerificationChangeSchema,
    builds: z.array(changeVerificationBuildSchema).max(32).readonly(),
    selection: z
      .object({
        affectedJourneys: z.array(changeVerificationAffectedJourneySchema).max(128).readonly(),
        targetCases: z.array(frozenVerificationTargetCaseSchema).max(250).readonly(),
      })
      .strict(),
    policy: z
      .object({
        id: identifier,
        version: z.number().int().positive(),
      })
      .strict(),
    runIds: z.array(identifier).max(1_000).readonly(),
    evidenceDigests: z.array(sha256).max(2_000).readonly(),
    decision: z.enum(CHANGE_VERIFICATION_DECISIONS).optional(),
    firstCausalFailure: z
      .object({
        runId: identifier,
        testId: identifier.optional(),
        targetCaseId: identifier.optional(),
        checkId: identifier.optional(),
        summary: boundedText,
        evidenceRefs: z.array(sha256).max(64).readonly(),
      })
      .strict()
      .optional(),
    coverageGaps: z.array(boundedText).max(128).readonly(),
    residualRisk: z.array(boundedText).max(128).readonly(),
    smallestNextVerification: z
      .object({
        kind: z.enum(["approve-plan", "provide-build", "run-pilot", "expand", "review", "none"]),
        reason: boundedText,
        appMapId: identifier.optional(),
        testId: identifier.optional(),
        targetCaseId: identifier.optional(),
      })
      .strict()
      .optional(),
    supersedesProofId: identifier.optional(),
    supersededByProofId: identifier.optional(),
    requestedBy: identifier,
    updatedBy: identifier,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict()
  .superRefine((proof, context) => {
    const unique = (values: readonly string[], path: (string | number)[]) => {
      if (new Set(values).size !== values.length) {
        context.addIssue({ code: "custom", path, message: "must not contain duplicates" });
      }
    };
    unique(
      proof.builds.map((build) => build.id),
      ["builds"],
    );
    unique(
      proof.selection.affectedJourneys.map((journey) => `${journey.appMapId}\0${journey.testId}`),
      ["selection", "affectedJourneys"],
    );
    unique(
      proof.selection.targetCases.map((targetCase) => targetCase.id),
      ["selection", "targetCases"],
    );
    unique(proof.runIds, ["runIds"]);
    unique(proof.evidenceDigests, ["evidenceDigests"]);
    if (proof.builds.some((build) => build.sourceSha !== proof.change.headSha)) {
      context.addIssue({
        code: "custom",
        path: ["builds"],
        message: "every build must bind to the exact headSha",
      });
    }
    if (proof.updatedAt < proof.createdAt) {
      context.addIssue({ code: "custom", path: ["updatedAt"], message: "precedes createdAt" });
    }
    const terminalDecision =
      proof.state === "proved" ||
      proof.state === "rejected" ||
      proof.state === "needs-review" ||
      proof.state === "insufficient-evidence"
        ? proof.state
        : undefined;
    if (terminalDecision !== proof.decision) {
      context.addIssue({
        code: "custom",
        path: ["decision"],
        message: terminalDecision
          ? `state ${proof.state} requires decision ${terminalDecision}`
          : `state ${proof.state} cannot carry a merge decision`,
      });
    }
    if (proof.state === "superseded" && !proof.supersededByProofId) {
      context.addIssue({
        code: "custom",
        path: ["supersededByProofId"],
        message: "a superseded Proof must name its replacement",
      });
    }
    if (
      (proof.state === "ready" ||
        proof.state === "running-pilot" ||
        proof.state === "awaiting-expansion" ||
        proof.state === "running") &&
      (!proof.builds.length ||
        !proof.selection.affectedJourneys.length ||
        !proof.selection.targetCases.length)
    ) {
      context.addIssue({
        code: "custom",
        message: `state ${proof.state} requires an executable frozen Verification Plan`,
      });
    }
    if (proof.state !== "superseded" && proof.supersededByProofId) {
      context.addIssue({
        code: "custom",
        path: ["supersededByProofId"],
        message: "only a superseded Proof may name its replacement",
      });
    }
    if (
      proof.state === "proved" &&
      (!proof.builds.length ||
        !proof.selection.affectedJourneys.length ||
        !proof.selection.targetCases.length ||
        !proof.runIds.length ||
        !proof.evidenceDigests.length)
    ) {
      context.addIssue({
        code: "custom",
        message: "source metadata alone can never produce a proved Change Verification",
      });
    }
  });

export type ChangeVerificationState = (typeof CHANGE_VERIFICATION_STATES)[number];
export type ChangeVerificationDecision = (typeof CHANGE_VERIFICATION_DECISIONS)[number];
export type ChangeVerificationChange = z.output<typeof changeVerificationChangeSchema>;
export type ChangeVerificationBuild = z.output<typeof changeVerificationBuildSchema>;
export type ChangeVerificationAffectedJourney = z.output<
  typeof changeVerificationAffectedJourneySchema
>;
export type FrozenVerificationTargetCase = z.output<typeof frozenVerificationTargetCaseSchema>;
export type ChangeVerification = z.output<typeof changeVerificationSchema>;

export function parseChangeVerification(value: unknown): ChangeVerification {
  return changeVerificationSchema.parse(value);
}
