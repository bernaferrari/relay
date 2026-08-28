import * as z from "zod/v4";
import {
  EXECUTION_EXTERNAL_EFFECTS,
  type ExecutionExternalEffect,
  type ExecutionRiskLevel,
} from "./approval-policy.js";

export const EXPLORATION_POLICY_ID = "relay.exploration.action" as const;
export const EXPLORATION_POLICY_VERSION = 1 as const;

export const STATE_FIXTURE_SCOPES = [
  "app",
  "account",
  "locale",
  "theme",
  "permission",
  "network",
] as const;
export type StateFixtureScope = (typeof STATE_FIXTURE_SCOPES)[number];

const boundedId = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/u);
const unique = <T>(values: readonly T[]) => new Set(values).size === values.length;

export const stateFixtureSecretReferenceSchema = z
  .object({
    id: boundedId,
    source: z.enum(["environment", "keychain", "vault"]),
    key: boundedId.max(240),
    version: boundedId.max(80).optional(),
  })
  .strict();

const stateFixtureStepSchema = z
  .object({
    id: boundedId,
    scope: z.enum(STATE_FIXTURE_SCOPES),
    operation: z.enum(["reset", "apply-reviewed-preset", "verify", "restore", "prove-cleanup"]),
    presetRef: boundedId.max(240).optional(),
    secretRefs: z.array(boundedId).max(8).optional(),
    timeoutMs: z.number().int().min(1).max(60_000),
  })
  .strict()
  .superRefine((step, context) => {
    if (step.operation === "apply-reviewed-preset" && !step.presetRef) {
      context.addIssue({
        code: "custom",
        message: "A fixture preset operation needs a reviewed preset reference",
      });
    }
  });

function phaseSchema(operations: readonly string[]) {
  return z
    .object({
      maxDurationMs: z.number().int().min(1).max(300_000),
      steps: z.array(stateFixtureStepSchema).min(1).max(24),
    })
    .strict()
    .superRefine((phase, context) => {
      if (phase.steps.some((step) => !operations.includes(step.operation))) {
        context.addIssue({
          code: "custom",
          message: "Fixture phase contains an invalid operation",
        });
      }
      if (phase.steps.reduce((total, step) => total + step.timeoutMs, 0) > phase.maxDurationMs) {
        context.addIssue({
          code: "custom",
          message: "Fixture phase step budgets exceed its duration",
        });
      }
    });
}

const preparePhaseSchema = phaseSchema(["reset", "apply-reviewed-preset"]);
const verifyPhaseSchema = phaseSchema(["verify"]);
const cleanupPhaseSchema = phaseSchema(["restore", "prove-cleanup"]);

/**
 * Reviewed, bounded state setup. Secret material is structurally impossible to
 * embed: steps can only name reviewed presets and secret-reference ids.
 */
export const stateFixtureSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: boundedId,
    name: z.string().trim().min(1).max(160),
    review: z
      .object({
        revision: z.number().int().min(1),
        reviewedBy: boundedId,
        reviewedAt: z.number().int().nonnegative(),
        reason: z.string().trim().min(1).max(500),
      })
      .strict(),
    resetScope: z.array(z.enum(STATE_FIXTURE_SCOPES)).min(1).max(STATE_FIXTURE_SCOPES.length),
    secrets: z.array(stateFixtureSecretReferenceSchema).max(16),
    phases: z
      .object({
        prepare: preparePhaseSchema,
        verify: verifyPhaseSchema,
        cleanup: cleanupPhaseSchema,
      })
      .strict(),
    reversibility: z
      .object({
        status: z.literal("reviewed-reversible"),
        restoresScopes: z
          .array(z.enum(STATE_FIXTURE_SCOPES))
          .min(1)
          .max(STATE_FIXTURE_SCOPES.length),
        cleanupProofRequired: z.literal(true),
      })
      .strict(),
  })
  .strict()
  .superRefine((fixture, context) => {
    if (!unique(fixture.resetScope)) {
      context.addIssue({ code: "custom", message: "Fixture reset scopes must be unique" });
    }
    if (!unique(fixture.reversibility.restoresScopes)) {
      context.addIssue({ code: "custom", message: "Fixture restored scopes must be unique" });
    }
    const allSteps = [
      ...fixture.phases.prepare.steps,
      ...fixture.phases.verify.steps,
      ...fixture.phases.cleanup.steps,
    ];
    if (!unique(allSteps.map((step) => step.id))) {
      context.addIssue({ code: "custom", message: "Fixture step ids must be unique" });
    }
    if (!unique(fixture.secrets.map((secret) => secret.id))) {
      context.addIssue({ code: "custom", message: "Fixture secret-reference ids must be unique" });
    }
    const scope = new Set(fixture.resetScope);
    if (allSteps.some((step) => !scope.has(step.scope))) {
      context.addIssue({ code: "custom", message: "Fixture steps must stay inside resetScope" });
    }
    const secretIds = new Set(fixture.secrets.map((secret) => secret.id));
    if (allSteps.some((step) => step.secretRefs?.some((id) => !secretIds.has(id)))) {
      context.addIssue({ code: "custom", message: "Fixture steps reference an unknown secret" });
    }
    const exactScopes = (values: readonly StateFixtureScope[]) =>
      values.length === scope.size && values.every((value) => scope.has(value));
    if (!exactScopes(fixture.reversibility.restoresScopes)) {
      context.addIssue({
        code: "custom",
        message: "Fixture reversibility must restore every scope",
      });
    }
    for (const required of fixture.resetScope) {
      if (!fixture.phases.prepare.steps.some((step) => step.scope === required)) {
        context.addIssue({ code: "custom", message: `Fixture does not prepare ${required}` });
      }
      if (!fixture.phases.verify.steps.some((step) => step.scope === required)) {
        context.addIssue({ code: "custom", message: `Fixture does not verify ${required}` });
      }
      if (
        !fixture.phases.cleanup.steps.some(
          (step) => step.scope === required && step.operation === "restore",
        )
      ) {
        context.addIssue({ code: "custom", message: `Fixture does not restore ${required}` });
      }
      if (
        !fixture.phases.cleanup.steps.some(
          (step) => step.scope === required && step.operation === "prove-cleanup",
        )
      ) {
        context.addIssue({
          code: "custom",
          message: `Fixture does not prove cleanup for ${required}`,
        });
      }
    }
    const totalDuration =
      fixture.phases.prepare.maxDurationMs +
      fixture.phases.verify.maxDurationMs +
      fixture.phases.cleanup.maxDurationMs;
    if (totalDuration > 600_000) {
      context.addIssue({ code: "custom", message: "Fixture total duration exceeds ten minutes" });
    }
  });

export type StateFixture = z.infer<typeof stateFixtureSchema>;
export type StateFixtureSecretReference = z.infer<typeof stateFixtureSecretReferenceSchema>;

export const EXPLORATION_ACTION_KINDS = [
  "observe",
  "navigate",
  "state-change",
  "external-app",
  "communication",
  "permission-change",
  "installation",
  "account-mutation",
  "data-deletion",
  "purchase",
  "unknown",
] as const;
export type ExplorationActionKind = (typeof EXPLORATION_ACTION_KINDS)[number];

export const explorationActionSchema = z
  .object({
    id: boundedId,
    kind: z.enum(EXPLORATION_ACTION_KINDS),
    requiredScopes: z.array(z.enum(STATE_FIXTURE_SCOPES)).max(STATE_FIXTURE_SCOPES.length),
    declaredExternalEffects: z
      .array(z.enum(EXECUTION_EXTERNAL_EFFECTS))
      .max(EXECUTION_EXTERNAL_EFFECTS.length),
  })
  .strict()
  .superRefine((action, context) => {
    if (!unique(action.requiredScopes)) {
      context.addIssue({ code: "custom", message: "Exploration action scopes must be unique" });
    }
    if (!unique(action.declaredExternalEffects)) {
      context.addIssue({ code: "custom", message: "Exploration external effects must be unique" });
    }
  });

export const explorationActionPolicyInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    action: explorationActionSchema,
    fixture: stateFixtureSchema.optional(),
  })
  .strict();

export type ExplorationAction = z.infer<typeof explorationActionSchema>;
export type ExplorationActionPolicyInput = z.infer<typeof explorationActionPolicyInputSchema>;

export type ExplorationActionPolicyDecision = {
  schemaVersion: 1;
  policy: { id: typeof EXPLORATION_POLICY_ID; version: typeof EXPLORATION_POLICY_VERSION };
  actionId: string;
  level: ExecutionRiskLevel;
  authorization: "allowed" | "confirmation-required" | "human-only" | "blocked";
  confirmation: "none" | "once-per-action" | "human-only" | "never";
  reasons: ReadonlyArray<{ code: string; explanation: string }>;
  externalEffects: readonly ExecutionExternalEffect[];
  fixture?: { id: string; revision: number };
  basis: "deterministic-policy";
};

export const explorationFrontierFactorsSchema = z
  .object({
    novelty: z.number().int().min(0).max(100),
    coverageValue: z.number().int().min(0).max(100),
    changedCodeRelevance: z.number().int().min(0).max(100),
    uncertaintyReduction: z.number().int().min(0).max(100),
    executionCost: z.number().int().min(0).max(100),
  })
  .strict();

export const explorationFrontierRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    candidates: z
      .array(
        z
          .object({
            action: explorationActionSchema,
            fixture: stateFixtureSchema.optional(),
            factors: explorationFrontierFactorsSchema,
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict()
  .superRefine((request, context) => {
    if (!unique(request.candidates.map((candidate) => candidate.action.id))) {
      context.addIssue({
        code: "custom",
        message: "Exploration frontier action ids must be unique",
      });
    }
  });

export type ExplorationFrontierFactors = z.infer<typeof explorationFrontierFactorsSchema>;
export type ExplorationFrontierRequest = z.infer<typeof explorationFrontierRequestSchema>;

export type ExplorationFrontierRanking = {
  schemaVersion: 1;
  formula: "relay.exploration.frontier.v1";
  entries: ReadonlyArray<{
    rank: number;
    actionId: string;
    score: number;
    admission: "policy-eligible" | "confirmation-required" | "human-only" | "blocked";
    policy: ExplorationActionPolicyDecision;
    rationale: ExplorationFrontierFactors & {
      riskPenalty: 0 | 25 | 75 | 100;
      explanation: string;
    };
  }>;
};
