import {
  CHANGE_SIGNAL_KINDS,
  changeImpactSchema,
  changeSignalsSchema,
  changeVerificationBuildSchema,
  changeVerificationChangeSchema,
  changeVerificationPolicySchema,
  frozenVerificationTargetCaseSchema,
  journeyAssociationSchema,
  verificationPlanSchema,
  type ChangeCoverageGap,
  type ChangeImpact,
  type ChangeSignals,
  type JourneyAssociation,
  type OperationInput,
  type VerificationPlan,
  type VerificationPlanTargetCase,
} from "@relay/protocol";

export type ComputeChangeImpactInput = {
  change: unknown;
  changed: unknown;
  associations: readonly unknown[];
};

export type CompileVerificationPlanInput = ComputeChangeImpactInput & {
  builds: readonly unknown[];
  targetCases: readonly unknown[];
  policy: unknown;
  maxCases?: number;
  maxDurationMs?: number;
};

type SignalMatch = { kind: (typeof CHANGE_SIGNAL_KINDS)[number]; value: string };

function fileMatches(changed: string, associated: string): boolean {
  const changedPath = changed.replace(/\/+$/u, "");
  const associatedPath = associated.replace(/\/+$/u, "");
  return changedPath === associatedPath || changedPath.startsWith(`${associatedPath}/`);
}

function matchedSignals(changed: ChangeSignals, association: JourneyAssociation): SignalMatch[] {
  const matches: SignalMatch[] = [];
  for (const kind of CHANGE_SIGNAL_KINDS) {
    for (const value of changed[kind]) {
      const matched = association.signals[kind].some((candidate) =>
        kind === "files" ? fileMatches(value, candidate) : value === candidate,
      );
      if (matched) matches.push({ kind, value });
    }
  }
  return matches;
}

function signalKey(signal: SignalMatch): string {
  return `${signal.kind}\0${signal.value}`;
}

function uniqueSignals(signals: readonly SignalMatch[]): SignalMatch[] {
  return [...new Map(signals.map((signal) => [signalKey(signal), signal])).values()].sort(
    (left, right) => left.kind.localeCompare(right.kind) || left.value.localeCompare(right.value),
  );
}

function allSignals(changed: ChangeSignals): SignalMatch[] {
  return CHANGE_SIGNAL_KINDS.flatMap((kind) => changed[kind].map((value) => ({ kind, value })));
}

export function computeChangeImpact(input: ComputeChangeImpactInput): ChangeImpact {
  const change = changeVerificationChangeSchema.parse(input.change);
  const changed = changeSignalsSchema.parse(input.changed);
  const associations = input.associations
    .map((value) => journeyAssociationSchema.parse(value))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(associations.map(({ id }) => id)).size !== associations.length) {
    throw new Error("journey association ids must be unique");
  }

  const matches = new Map(
    associations.map((association) => [association.id, matchedSignals(changed, association)]),
  );
  const reviewed = associations.filter(({ review }) => review.status === "reviewed");
  const byJourney = new Map<string, JourneyAssociation[]>();
  for (const association of reviewed) {
    const key = `${association.appMapId}\0${association.testId}`;
    const current = byJourney.get(key) ?? [];
    current.push(association);
    byJourney.set(key, current);
  }

  const journeys = [...byJourney.values()]
    .map((items) => {
      const relevant = items.filter((item) => (matches.get(item.id)?.length ?? 0) > 0);
      const classification = relevant.some(({ confidence }) => confidence === "definite")
        ? "definitely-affected"
        : relevant.length
          ? "probably-affected"
          : "unrelated";
      const associationIds = items.map(({ id }) => id).sort();
      const signals = uniqueSignals(relevant.flatMap(({ id }) => matches.get(id) ?? []));
      const firstReason = relevant[0]?.reason;
      return {
        appMapId: items[0]!.appMapId,
        testId: items[0]!.testId,
        classification,
        reason:
          firstReason ?? "No reviewed source-to-journey association signal matched this change.",
        associationIds,
        matchedSignals: signals,
      } as const;
    })
    .sort(
      (left, right) =>
        left.appMapId.localeCompare(right.appMapId) || left.testId.localeCompare(right.testId),
    );

  const coverageGaps: ChangeCoverageGap[] = [];
  for (const signal of allSignals(changed)) {
    const matching = associations.filter((association) =>
      (matches.get(association.id) ?? []).some(
        (candidate) => signalKey(candidate) === signalKey(signal),
      ),
    );
    if (matching.some(({ review }) => review.status === "reviewed")) continue;
    const unreviewed = matching.filter(({ review }) => review.status === "proposed");
    if (unreviewed.length) {
      for (const association of unreviewed) {
        coverageGaps.push({
          code: "unreviewed-association",
          reason: `Change signal ${signal.kind}:${signal.value} matches proposed association ${association.id}, which has no review authority.`,
          signalKind: signal.kind,
          signalValue: signal.value,
          associationId: association.id,
        });
      }
    } else {
      coverageGaps.push({
        code: "unmapped-change",
        reason: `No reviewed user journey is associated with ${signal.kind}:${signal.value}.`,
        signalKind: signal.kind,
        signalValue: signal.value,
      });
    }
  }

  return changeImpactSchema.parse({
    schemaVersion: 1,
    change,
    changed,
    journeys,
    coverageGaps,
  });
}

export function compileVerificationPlan(input: CompileVerificationPlanInput): VerificationPlan {
  const impact = computeChangeImpact(input);
  const builds = input.builds
    .map((value) => changeVerificationBuildSchema.parse(value))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(builds.map(({ id }) => id)).size !== builds.length) {
    throw new Error("build ids must be unique");
  }
  if (builds.some(({ sourceSha }) => sourceSha !== impact.change.headSha)) {
    throw new Error("every build must bind to the exact change headSha");
  }
  const targetCases = input.targetCases
    .map((value) => frozenVerificationTargetCaseSchema.parse(value))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(targetCases.map(({ id }) => id)).size !== targetCases.length) {
    throw new Error("target case ids must be unique");
  }
  const policy = changeVerificationPolicySchema.parse(input.policy);
  const affectedJourneys = impact.journeys
    .filter(({ classification }) => classification !== "unrelated")
    .map(({ appMapId, testId, classification, reason }) => ({
      appMapId,
      testId,
      reason,
      confidence:
        classification === "definitely-affected" ? ("definite" as const) : ("probable" as const),
    }));
  const requiredCases = targetCases.filter(({ required }) => required);
  const pilot = requiredCases[0];
  const maxCases = input.maxCases ?? Math.max(1, requiredCases.length);
  const maxDurationMs = input.maxDurationMs ?? 1_800_000;
  const planGaps: ChangeCoverageGap[] = [...impact.coverageGaps];
  if (!pilot) {
    planGaps.push({
      code: "missing-target-case",
      reason: "The Verification Plan requires at least one policy-required frozen target case.",
    });
  }
  if (requiredCases.length > maxCases) {
    planGaps.push({
      code: "required-case-budget-exceeded",
      reason: `The policy requires ${requiredCases.length} cases but the plan limit is ${maxCases}.`,
    });
  }
  const status = !builds.length
    ? "awaiting-build"
    : planGaps.length
      ? "needs-review"
      : "ready-for-approval";

  return verificationPlanSchema.parse({
    schemaVersion: 1,
    status,
    change: impact.change,
    impact,
    builds,
    selection: { affectedJourneys, targetCases },
    policy,
    ...(pilot ? { pilotTargetCaseId: pilot.id } : {}),
    expansion: {
      targetCaseIds: requiredCases.slice(1).map(({ id }) => id),
      maxCases,
      maxDurationMs,
      conditions: ["pilot-passed", "evidence-complete", "no-unreconciled-input"],
    },
    coverageGaps: planGaps,
  });
}

export function verificationPlanTargetCases(
  values: readonly unknown[],
): VerificationPlanTargetCase[] {
  return values.map((value) => frozenVerificationTargetCaseSchema.parse(value));
}

/** Project one reviewed, pure plan into the canonical Proof start contract.
 * Coverage gaps remain explicit strings on the durable Proof so approval
 * cannot turn unknown impact into a green merge decision. */
export function proofStartInputFromVerificationPlan(value: unknown): OperationInput<"proof.start"> {
  const plan = verificationPlanSchema.parse(value);
  const next =
    plan.status === "awaiting-build"
      ? {
          kind: "provide-build" as const,
          reason: "Provide an exact build whose source revision matches the Proof head.",
        }
      : plan.status === "needs-review"
        ? {
            kind: "review" as const,
            reason: "Resolve every Verification Plan coverage gap before approval.",
          }
        : {
            kind: "approve-plan" as const,
            reason: "Review and approve the exact builds, journeys, targets, and policy.",
          };
  return {
    change: plan.change,
    builds: plan.builds,
    selection: plan.selection,
    policy: plan.policy,
    coverageGaps: plan.coverageGaps.map(({ reason }) => reason),
    residualRisk: [],
    smallestNextVerification: next,
  };
}
