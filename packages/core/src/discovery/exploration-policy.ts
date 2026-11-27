import type {
  ExecutionExternalEffect,
  ExecutionRiskLevel,
  ExplorationActionKind,
  ExplorationActionPolicyDecision,
  ExplorationFrontierRanking,
  ExplorationFrontierRequest,
  StateFixture,
} from "@relay/protocol";
import {
  EXECUTION_EXTERNAL_EFFECTS,
  EXPLORATION_POLICY_ID,
  EXPLORATION_POLICY_VERSION,
  explorationActionPolicyInputSchema,
  explorationFrontierRequestSchema,
} from "@relay/protocol";

const effectForKind: Partial<Record<ExplorationActionKind, ExecutionExternalEffect>> = {
  "external-app": "external-app",
  communication: "communication",
  "permission-change": "permission-change",
  installation: "installation",
  "account-mutation": "account-mutation",
  "data-deletion": "data-deletion",
  purchase: "purchase",
};

const effectLevel: Record<ExecutionExternalEffect, ExecutionRiskLevel> = {
  communication: "guarded",
  purchase: "prohibited",
  "account-mutation": "destructive",
  "data-deletion": "destructive",
  "permission-change": "guarded",
  installation: "destructive",
  "external-app": "guarded",
};

const severity: Record<ExecutionRiskLevel, number> = {
  safe: 0,
  guarded: 1,
  destructive: 2,
  prohibited: 3,
};

function maxLevel(left: ExecutionRiskLevel, right: ExecutionRiskLevel): ExecutionRiskLevel {
  return severity[right] > severity[left] ? right : left;
}

function fixtureCovers(fixture: StateFixture | undefined, scopes: readonly string[]): boolean {
  if (!fixture || scopes.length === 0) return false;
  const reset = new Set(fixture.resetScope);
  return scopes.every((scope) => reset.has(scope as StateFixture["resetScope"][number]));
}

/**
 * Deterministic action admission. A model can propose an action, but this
 * strict parser rejects undeclared override fields and policy alone returns
 * the authorization and confirmation requirement.
 */
export function evaluateExplorationActionPolicy(raw: unknown): ExplorationActionPolicyDecision {
  const input = explorationActionPolicyInputSchema.parse(raw);
  const { action, fixture } = input;
  const reasons: ExplorationActionPolicyDecision["reasons"][number][] = [];
  let level: ExecutionRiskLevel;

  switch (action.kind) {
    case "observe":
      level = "safe";
      reasons.push({
        code: "exploration.action.observe",
        explanation: "The action reads reviewed evidence without changing application state.",
      });
      break;
    case "navigate":
      level = "safe";
      reasons.push({
        code: "exploration.action.navigate",
        explanation: "The action is bounded product navigation with no declared external effect.",
      });
      break;
    case "state-change":
    case "permission-change":
      if (fixtureCovers(fixture, action.requiredScopes)) {
        level = "guarded";
        reasons.push({
          code: "exploration.fixture.reviewed-reversible",
          explanation:
            "A reviewed fixture prepares, verifies, restores, and proves cleanup for every required scope.",
        });
      } else {
        level = "destructive";
        reasons.push({
          code: "exploration.fixture.missing-reversible-scope",
          explanation:
            "The state mutation lacks a reviewed reversible fixture covering every required scope.",
        });
      }
      break;
    case "external-app":
    case "communication":
      level = "guarded";
      reasons.push({
        code: `exploration.action.${action.kind}`,
        explanation:
          "The action crosses a product or human boundary and requires explicit confirmation.",
      });
      break;
    case "installation":
    case "account-mutation":
    case "data-deletion":
      level = "destructive";
      reasons.push({
        code: `exploration.action.${action.kind}`,
        explanation:
          "The action can materially change installed software, account state, or retained data.",
      });
      break;
    case "purchase":
    case "unknown":
      level = "prohibited";
      reasons.push({
        code:
          action.kind === "purchase"
            ? "exploration.action.purchase-prohibited"
            : "exploration.action.unclassified-prohibited",
        explanation:
          action.kind === "purchase"
            ? "Automatic exploration never performs a purchase."
            : "An unclassified mutation is prohibited until reviewed intent makes its effect explicit.",
      });
      break;
  }

  const effects = new Set(action.declaredExternalEffects);
  const implied = effectForKind[action.kind];
  if (implied) effects.add(implied);
  const orderedEffects = EXECUTION_EXTERNAL_EFFECTS.filter((effect) => effects.has(effect));
  for (const effect of orderedEffects) {
    level = maxLevel(level, effectLevel[effect]);
    reasons.push({
      code: `exploration.effect.${effect}`,
      explanation: `The reviewed action declares the ${effect} external effect.`,
    });
  }

  const authorization =
    level === "safe"
      ? "allowed"
      : level === "guarded"
        ? "confirmation-required"
        : level === "destructive"
          ? "human-only"
          : "blocked";
  const confirmation =
    level === "safe"
      ? "none"
      : level === "guarded"
        ? "once-per-action"
        : level === "destructive"
          ? "human-only"
          : "never";

  return {
    schemaVersion: 1,
    policy: { id: EXPLORATION_POLICY_ID, version: EXPLORATION_POLICY_VERSION },
    actionId: action.id,
    level,
    authorization,
    confirmation,
    reasons,
    externalEffects: orderedEffects,
    ...(fixture ? { fixture: { id: fixture.id, revision: fixture.review.revision } } : {}),
    basis: "deterministic-policy",
  };
}

const riskPenalty: Record<ExecutionRiskLevel, 0 | 25 | 75 | 100> = {
  safe: 0,
  guarded: 25,
  destructive: 75,
  prohibited: 100,
};

/**
 * Rank proposals only. The result records every fixed-point input and policy
 * penalty; it never invokes, schedules, leases, or mutates a target.
 */
export function rankExplorationFrontier(raw: unknown): ExplorationFrontierRanking {
  const request: ExplorationFrontierRequest = explorationFrontierRequestSchema.parse(raw);
  const ranked = request.candidates.map((candidate) => {
    const policy = evaluateExplorationActionPolicy({
      schemaVersion: 1,
      action: candidate.action,
      ...(candidate.fixture ? { fixture: candidate.fixture } : {}),
    });
    const penalty = riskPenalty[policy.level];
    const factors = candidate.factors;
    const score =
      factors.novelty * 3 +
      factors.coverageValue * 3 +
      factors.changedCodeRelevance * 2 +
      factors.uncertaintyReduction * 2 -
      factors.executionCost * 2 -
      penalty * 10;
    return {
      actionId: candidate.action.id,
      score,
      admission:
        policy.authorization === "allowed" ? ("policy-eligible" as const) : policy.authorization,
      policy,
      rationale: {
        ...factors,
        riskPenalty: penalty,
        explanation:
          "score = novelty×3 + coverage×3 + changed-code×2 + uncertainty×2 − cost×2 − risk×10",
      },
    };
  });
  ranked.sort(
    (left, right) => right.score - left.score || left.actionId.localeCompare(right.actionId),
  );
  return {
    schemaVersion: 1,
    formula: "relay.exploration.frontier.v1",
    entries: ranked.map((entry, index) => ({ rank: index + 1, ...entry })),
  };
}
