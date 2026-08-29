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

/** The stable caller-facing identity of the deterministic Change Proof policy.
 *
 * The executable definition lives in core, where the decision implementation
 * is owned. Keeping this value limited to identity fields means callers cannot
 * smuggle policy rules into a Proof document. */
export const VERIFY_CHANGE_POLICY = Object.freeze({
  id: "relay.verify-change",
  version: 1,
} as const);

export const CHANGE_VERIFICATION_MUTATIONS = [
  "legacy-v1-migration",
  "legacy-plan-cell-migration",
  "start",
  "approve-plan",
  "revise-plan",
  "request-plan-review",
  "return-to-planning",
  "start-pilot",
  "await-expansion",
  "start-required-coverage",
  "record-runs",
  "record-decision",
  "cancel",
  "rerun-affected",
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
    /** Exact reviewed App Map revision. Historical/planning documents may
     * omit it, but live execution requires it before target control. */
    appMapRevision: z.number().int().positive().optional(),
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
    androidAvdName: identifier.optional(),
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
    /** Whether this target's Test must prove its compensating cleanup. */
    cleanupRequired: z.boolean().optional(),
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

/** One immutable, executable Verification Plan unit. Cells are materialized
 * before target control so execution can never infer a journey × target
 * pairing (or silently choose a build) later. */
export const verificationCellSchema = z
  .object({
    id: identifier,
    journey: z
      .object({
        appMapId: identifier,
        testId: identifier,
        appMapRevision: z.number().int().positive().optional(),
      })
      .strict(),
    targetCaseId: identifier,
    buildId: identifier,
    cleanupRequired: z.boolean(),
  })
  .strict();

export const changeVerificationSelectionSchema = z
  .object({
    affectedJourneys: z.array(changeVerificationAffectedJourneySchema).max(128).readonly(),
    targetCases: z.array(frozenVerificationTargetCaseSchema).max(250).readonly(),
    /** Optional while reading historical planning records; executable Proofs
     * must carry this explicitly materialized list. */
    cells: z.array(verificationCellSchema).max(1_000).readonly().optional(),
  })
  .strict();

export const changeVerificationPolicySchema = z
  .object({ id: identifier, version: z.number().int().positive() })
  .strict();

/** Digests are optional in the wire schema solely so old durable documents can
 * be read and converted to a review-needed state. New server-created Proofs
 * always materialize all applicable identities before persistence. */
const proofDigest = sha256;

export const changeVerificationNextSchema = z
  .object({
    kind: z.enum(["approve-plan", "provide-build", "run-pilot", "expand", "review", "none"]),
    reason: boundedText,
    appMapId: identifier.optional(),
    testId: identifier.optional(),
    targetCaseId: identifier.optional(),
  })
  .strict();

export const changeVerificationPlanApprovalSchema = z
  .object({
    decisionId: identifier,
    approvedBy: identifier,
    approvedAt: timestamp,
    reason: boundedText,
  })
  .strict();

export const changeVerificationMutationReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: identifier,
    requestDigest: sha256,
    action: z.enum(CHANGE_VERIFICATION_MUTATIONS),
    actorId: identifier,
    proofId: identifier,
    previousVersion: z.number().int().nonnegative(),
    version: z.number().int().positive(),
    at: timestamp,
  })
  .strict();

export const changeVerificationCancellationSchema = z
  .object({
    reason: boundedText,
    cancelledBy: identifier,
    cancelledAt: timestamp,
  })
  .strict();

const sharedChangeVerificationSchema = z
  .object({
    id: identifier,
    organizationId: identifier,
    projectId: identifier,
    version: z.number().int().positive(),
    state: z.enum(CHANGE_VERIFICATION_STATES),
    change: changeVerificationChangeSchema,
    builds: z.array(changeVerificationBuildSchema).max(32).readonly(),
    selection: changeVerificationSelectionSchema,
    policy: changeVerificationPolicySchema,
    policyDigest: proofDigest.optional(),
    planDigest: proofDigest.optional(),
    decisionDigest: proofDigest.optional(),
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
    smallestNextVerification: changeVerificationNextSchema.optional(),
    supersedesProofId: identifier.optional(),
    supersededByProofId: identifier.optional(),
    requestedBy: identifier,
    updatedBy: identifier,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

type ChangeVerificationValidationShape = z.output<typeof sharedChangeVerificationSchema> & {
  readonly schemaVersion: 1 | 2;
  readonly planApproval?: z.output<typeof changeVerificationPlanApprovalSchema>;
  readonly lastMutation?: z.output<typeof changeVerificationMutationReceiptSchema>;
  readonly cancellation?: z.output<typeof changeVerificationCancellationSchema>;
};

function validateChangeVerification(
  proof: ChangeVerificationValidationShape,
  context: z.RefinementCtx,
  requiresDurableLifecycle: boolean,
  requiresFrozenCells = true,
): void {
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
  if (proof.selection.cells) {
    unique(
      proof.selection.cells.map((cell) => cell.id),
      ["selection", "cells"],
    );
    const journeys = new Map(
      proof.selection.affectedJourneys.map((journey) => [
        `${journey.appMapId}\0${journey.testId}`,
        journey,
      ]),
    );
    const targets = new Map(proof.selection.targetCases.map((target) => [target.id, target]));
    const builds = new Map(proof.builds.map((build) => [build.id, build]));
    const cellKeys = proof.selection.cells.map(
      (cell) => `${cell.journey.appMapId}\0${cell.journey.testId}\0${cell.targetCaseId}`,
    );
    unique(cellKeys, ["selection", "cells"]);
    for (const cell of proof.selection.cells) {
      const journey = journeys.get(`${cell.journey.appMapId}\0${cell.journey.testId}`);
      if (!journey || journey.appMapRevision !== cell.journey.appMapRevision) {
        context.addIssue({
          code: "custom",
          path: ["selection", "cells"],
          message: `cell ${cell.id} must bind one exact affected journey revision`,
        });
      }
      const target = targets.get(cell.targetCaseId);
      if (!target || !target.required) {
        context.addIssue({
          code: "custom",
          path: ["selection", "cells"],
          message: `cell ${cell.id} must bind a policy-required frozen target case`,
        });
      } else if ((target.cleanupRequired ?? false) !== cell.cleanupRequired) {
        context.addIssue({
          code: "custom",
          path: ["selection", "cells"],
          message: `cell ${cell.id} cleanup requirement disagrees with its target case`,
        });
      }
      const build = builds.get(cell.buildId);
      if (
        !build ||
        (target &&
          build.platform !==
            (target.executionTarget.platform === "browser"
              ? "web"
              : target.executionTarget.platform))
      ) {
        context.addIssue({
          code: "custom",
          path: ["selection", "cells"],
          message: `cell ${cell.id} must bind one exact compatible build`,
        });
      }
    }
    const expectedCellKeys = proof.selection.affectedJourneys.flatMap((journey) =>
      proof.selection.targetCases
        .filter(({ required }) => required)
        .map((target) => `${journey.appMapId}\0${journey.testId}\0${target.id}`),
    );
    if (
      cellKeys.length !== expectedCellKeys.length ||
      expectedCellKeys.some((key) => !cellKeys.includes(key))
    ) {
      context.addIssue({
        code: "custom",
        path: ["selection", "cells"],
        message:
          "must materialize exactly one cell for every affected journey and required target case",
      });
    }
  }
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
  if (requiresDurableLifecycle && !proof.lastMutation) {
    context.addIssue({
      code: "custom",
      path: ["lastMutation"],
      message: "schemaVersion 2 requires an exact durable mutation receipt",
    });
  } else if (
    proof.lastMutation &&
    (proof.lastMutation.proofId !== proof.id ||
      proof.lastMutation.version !== proof.version ||
      proof.lastMutation.previousVersion !== proof.version - 1 ||
      proof.lastMutation.actorId !== proof.updatedBy ||
      proof.lastMutation.at !== proof.updatedAt)
  ) {
    context.addIssue({
      code: "custom",
      path: ["lastMutation"],
      message: "must be the exact receipt for this immutable Proof version",
    });
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
  if (proof.state === "cancelled" && requiresDurableLifecycle && !proof.cancellation) {
    context.addIssue({
      code: "custom",
      path: ["cancellation"],
      message: "a cancelled Proof requires exact cancellation provenance",
    });
  }
  if (proof.state !== "cancelled" && proof.cancellation) {
    context.addIssue({
      code: "custom",
      path: ["cancellation"],
      message: "only a cancelled Proof may carry cancellation provenance",
    });
  }
  if (
    (proof.state === "ready" ||
      proof.state === "running-pilot" ||
      proof.state === "awaiting-expansion" ||
      proof.state === "running") &&
    (!proof.builds.length ||
      !proof.selection.affectedJourneys.length ||
      proof.selection.affectedJourneys.some(({ appMapRevision }) => appMapRevision === undefined) ||
      !proof.selection.targetCases.length ||
      (requiresDurableLifecycle && !proof.planApproval) ||
      (requiresFrozenCells && !proof.selection.cells?.length))
  ) {
    if (
      proof.selection.affectedJourneys.some(({ appMapRevision }) => appMapRevision === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["selection", "affectedJourneys"],
        message: `state ${proof.state} has no frozen App Map revision for every affected journey`,
      });
    }
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
}

const legacyChangeVerificationSchema = sharedChangeVerificationSchema
  .extend({ schemaVersion: z.literal(1) })
  .strict()
  .superRefine((proof, context) => validateChangeVerification(proof, context, false));

/** Schema for the durable v2 shape before Verification Cells were added.
 * `parseChangeVerification` immediately migrates approved records through a
 * fail-closed review state; this is not an executable compatibility path. */
const legacyPlanChangeVerificationSchema = sharedChangeVerificationSchema
  .extend({
    schemaVersion: z.literal(2),
    planApproval: changeVerificationPlanApprovalSchema.optional(),
    cancellation: changeVerificationCancellationSchema.optional(),
    lastMutation: changeVerificationMutationReceiptSchema,
  })
  .strict()
  .superRefine((proof, context) => validateChangeVerification(proof, context, true, false));

export const changeVerificationSchema = sharedChangeVerificationSchema
  .extend({
    schemaVersion: z.literal(2),
    planApproval: changeVerificationPlanApprovalSchema.optional(),
    cancellation: changeVerificationCancellationSchema.optional(),
    lastMutation: changeVerificationMutationReceiptSchema,
  })
  .strict()
  .superRefine((proof, context) => validateChangeVerification(proof, context, true));

export type ChangeVerificationState = (typeof CHANGE_VERIFICATION_STATES)[number];
export type ChangeVerificationDecision = (typeof CHANGE_VERIFICATION_DECISIONS)[number];
export type ChangeVerificationMutation = (typeof CHANGE_VERIFICATION_MUTATIONS)[number];
export type ChangeVerificationChange = z.output<typeof changeVerificationChangeSchema>;
export type ChangeVerificationBuild = z.output<typeof changeVerificationBuildSchema>;
export type ChangeVerificationAffectedJourney = z.output<
  typeof changeVerificationAffectedJourneySchema
>;
export type FrozenVerificationTargetCase = z.output<typeof frozenVerificationTargetCaseSchema>;
export type VerificationCell = z.output<typeof verificationCellSchema>;
export type ChangeVerification = z.output<typeof changeVerificationSchema>;

export function parseChangeVerification(value: unknown): ChangeVerification {
  const document = z.object({ schemaVersion: z.number() }).passthrough().parse(value);
  if (document.schemaVersion === 1) {
    const legacy = legacyChangeVerificationSchema.parse(value);
    const failClosedState =
      legacy.state === "rejected" ||
      legacy.state === "needs-review" ||
      legacy.state === "insufficient-evidence" ||
      legacy.state === "cancelled" ||
      legacy.state === "superseded"
        ? legacy.state
        : "needs-review";
    const migrationGap =
      "This Proof predates durable Verification Plan approval and mutation receipts; review is required before execution or merge.";
    return changeVerificationSchema.parse({
      ...legacy,
      schemaVersion: 2,
      state: failClosedState,
      decision:
        failClosedState === "rejected" ||
        failClosedState === "needs-review" ||
        failClosedState === "insufficient-evidence"
          ? failClosedState
          : undefined,
      coverageGaps:
        legacy.coverageGaps.includes(migrationGap) || legacy.coverageGaps.length >= 128
          ? legacy.coverageGaps
          : [...legacy.coverageGaps, migrationGap],
      smallestNextVerification:
        failClosedState === "superseded" || failClosedState === "cancelled"
          ? legacy.smallestNextVerification
          : {
              kind: "review",
              reason: migrationGap,
            },
      lastMutation: {
        schemaVersion: 1,
        requestId: "legacy-v1-migration",
        requestDigest: `sha256:${"0".repeat(64)}`,
        action: "legacy-v1-migration",
        actorId: legacy.updatedBy,
        proofId: legacy.id,
        previousVersion: legacy.version - 1,
        version: legacy.version,
        at: legacy.updatedAt,
      },
      ...(failClosedState === "cancelled"
        ? {
            cancellation: {
              reason: migrationGap,
              cancelledBy: legacy.updatedBy,
              cancelledAt: legacy.updatedAt,
            },
          }
        : {}),
    });
  }
  if (document.schemaVersion === 2) {
    const legacy = legacyPlanChangeVerificationSchema.safeParse(value);
    if (legacy.success && !legacy.data.selection.cells?.length) {
      const needsMigration =
        !["rejected", "needs-review", "insufficient-evidence", "cancelled", "superseded"].includes(
          legacy.data.state,
        ) &&
        (legacy.data.planApproval !== undefined ||
          legacy.data.state === "ready" ||
          legacy.data.state === "running-pilot" ||
          legacy.data.state === "awaiting-expansion" ||
          legacy.data.state === "running" ||
          legacy.data.state === "proved");
      if (!needsMigration) return legacy.data as ChangeVerification;
      const migrationGap =
        "This Proof predates explicit Verification Cells; review is required before execution or merge.";
      const failClosedState = "needs-review" as const;
      return changeVerificationSchema.parse({
        ...legacy.data,
        state: failClosedState,
        decision: failClosedState,
        planApproval: undefined,
        coverageGaps:
          legacy.data.coverageGaps.includes(migrationGap) || legacy.data.coverageGaps.length >= 128
            ? legacy.data.coverageGaps
            : [...legacy.data.coverageGaps, migrationGap],
        smallestNextVerification: { kind: "review", reason: migrationGap },
        lastMutation: {
          ...legacy.data.lastMutation,
          requestId: "legacy-plan-cell-migration",
          requestDigest: `sha256:${"0".repeat(64)}`,
          action: "legacy-plan-cell-migration",
        },
      });
    }
  }
  return changeVerificationSchema.parse(value);
}
