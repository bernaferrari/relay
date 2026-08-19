import { createHash } from "node:crypto";
import type {
  AppMap,
  CampaignRepairProposalInput,
  CampaignRepairTarget,
  ConnectionNavigationTarget,
  Proposal,
  ProposalChange,
  StepTarget,
} from "@relay/protocol";
import { selectScenarioTestStep } from "./app-map/test-step-operations.js";

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function targetEqual(left: StepTarget, right: StepTarget): boolean {
  return stable(left) === stable(right);
}

function navigationTarget(
  selector: StepTarget,
  actorId: string,
  at: number,
  evidenceIds: string[],
): ConnectionNavigationTarget {
  if (selector.identifier) return { kind: "identifier", identifier: selector.identifier };
  if (selector.label || selector.text) {
    return {
      kind: "accessibility",
      label: selector.label ?? selector.text!,
      ...(selector.role ? { role: selector.role } : {}),
    };
  }
  const relative = selector.point?.relativeTo;
  if (relative) {
    return {
      kind: "element-relative",
      anchor: structuredClone(relative.target),
      xRatio: relative.xRatio,
      yRatio: relative.yRatio,
      reviewedAt: at,
      reviewedBy: actorId,
      evidenceIds,
    };
  }
  throw new Error(
    "Retarget requires an identifier, accessibility label, or reviewed element-relative selector",
  );
}

function observedFingerprint(target: CampaignRepairTarget): string {
  const identity = target.observed.screenIdentity;
  const fingerprint =
    identity && typeof identity === "object" && !Array.isArray(identity)
      ? (identity as Record<string, unknown>).fingerprint
      : undefined;
  if (typeof fingerprint !== "string" || !fingerprint.trim()) {
    throw new Error("The failed check has no observed semantic fingerprint to accept");
  }
  return fingerprint.trim();
}

type DerivedRepairChange = { change: ProposalChange; inverse: ProposalChange; diffKey: string };

function deriveChange(input: {
  map: AppMap;
  target: CampaignRepairTarget;
  request: CampaignRepairProposalInput;
  actorId: string;
  at: number;
}): DerivedRepairChange {
  const { map, target, request } = input;
  if (
    target.source.appMapId !== map.id ||
    target.source.appMapRevision !== map.revision ||
    !target.source.testId
  ) {
    throw new Error(
      `Repair evidence targets App Map revision ${String(target.source.appMapRevision)}, current revision is ${map.revision}`,
    );
  }
  if (request.kind === "retarget") {
    const repair = target.observed.navigationRepair;
    if (!repair || !request.selector || !targetEqual(request.selector, repair.currentSelector)) {
      throw new Error(
        "Retarget must use the exact successful selector recorded by this failed check",
      );
    }
    if (target.expected.transitionId && repair.connectionId !== target.expected.transitionId) {
      throw new Error("The recorded selector belongs to a different transition");
    }
    const connection = map.connections[repair.connectionId];
    if (!connection?.navigation) {
      throw new Error(`Connection ${repair.connectionId} has no navigation contract`);
    }
    const next = navigationTarget(
      request.selector,
      input.actorId,
      input.at,
      target.evidence.frames.map((frame) => frame.path),
    );
    const alternatives = [
      next,
      ...connection.navigation.targetAlternatives.filter(
        (candidate) => stable(candidate) !== stable(next),
      ),
    ];
    const change: ProposalChange = {
      kind: "connection.update",
      connectionId: connection.id,
      patch: {
        navigation: { ...structuredClone(connection.navigation), targetAlternatives: alternatives },
      },
    };
    return {
      change,
      inverse: {
        kind: "connection.update",
        connectionId: connection.id,
        patch: { navigation: structuredClone(connection.navigation) },
      },
      diffKey: stable(change),
    };
  }
  if (request.kind === "accept-current") {
    const screenId = target.expected.screenId;
    const screen = screenId ? map.screens[screenId] : undefined;
    if (!screen?.identity)
      throw new Error("The failed check does not identify a mapped Screen baseline");
    const fingerprint = observedFingerprint(target);
    const identity = {
      ...structuredClone(screen.identity),
      aliases: [...new Set([...(screen.identity.aliases ?? []), fingerprint])].sort(),
    };
    const change: ProposalChange = {
      kind: "screen.update",
      screenId: screen.id,
      input: { patch: { identity } },
    };
    return {
      change,
      inverse: {
        kind: "screen.update",
        screenId: screen.id,
        input: { patch: { identity: structuredClone(screen.identity) } },
      },
      diffKey: stable(change),
    };
  }
  const test = map.tests[target.source.testId];
  if (!test) throw new Error(`Test ${target.source.testId} no longer exists`);
  const selected = selectScenarioTestStep(test, target.source.checkId).step;
  const execution = {
    status: "disabled" as const,
    reason: request.reason.trim(),
    repairTargetId: target.id,
    decidedBy: input.actorId,
    decidedAt: input.at,
  };
  const change: ProposalChange = {
    kind: "test.edit",
    testId: test.id,
    edits: [{ kind: "step.patch", stepId: selected.id, patch: { execution } }],
  };
  return {
    change,
    inverse: {
      kind: "test.edit",
      testId: test.id,
      edits: [
        {
          kind: "step.patch",
          stepId: selected.id,
          patch: { execution: selected.execution ? structuredClone(selected.execution) : null },
        },
      ],
    },
    diffKey: stable({ kind: request.kind, testId: test.id, stepId: selected.id }),
  };
}

export function campaignRepairProposal(input: {
  map: AppMap;
  targets: CampaignRepairTarget[];
  request: CampaignRepairProposalInput;
  proposalId: string;
  actorId: string;
  at: number;
}): Proposal {
  if (!input.request.reason.trim()) throw new Error("A repair proposal requires a review reason");
  if (input.targets.length === 0) throw new Error("A repair proposal requires at least one target");
  const derived = input.targets.map((target) =>
    deriveChange({
      map: input.map,
      target,
      request: input.request,
      actorId: input.actorId,
      at: input.at,
    }),
  );
  const [first] = derived;
  if (!first || derived.some((candidate) => candidate.diffKey !== first.diffKey)) {
    throw new Error("Equivalent repair targets do not derive the same document change");
  }
  const testIds = new Set(input.targets.map((target) => target.source.testId));
  if (testIds.size !== 1 || !input.targets[0]!.source.testId) {
    throw new Error("Equivalent repair targets must identify the same saved Test");
  }
  const uniqueTargets = new Map(input.targets.map((target) => [target.id, target]));
  const repairTargetIds = [...uniqueTargets.keys()].sort();
  const equivalentDiffKey = createHash("sha256").update(first.diffKey).digest("hex");
  return {
    organizationId: input.map.organizationId,
    projectId: input.map.projectId,
    appMapId: input.map.id,
    id: input.proposalId,
    title: `${input.request.kind === "retarget" ? "Retarget" : input.request.kind === "accept-current" ? "Accept current" : "Disable"} ${input.targets[0]!.source.checkTitle}`,
    description: input.request.reason.trim(),
    status: "pending",
    baseRevision: input.map.revision,
    changes: [structuredClone(first.change)],
    repair: {
      kind: input.request.kind,
      testId: input.targets[0]!.source.testId,
      repairTargetIds,
      sourceRunIds: [...new Set(input.targets.map((target) => target.source.runId))].sort(),
      sourceCheckIds: [...new Set(input.targets.map((target) => target.source.checkId))].sort(),
      evidenceFramePaths: [
        ...new Set(
          input.targets.flatMap((target) => target.evidence.frames.map((frame) => frame.path)),
        ),
      ].sort(),
      equivalentDiffKey,
      inverseChanges: [structuredClone(first.inverse)],
    },
    createdAt: input.at,
    updatedAt: input.at,
  };
}
