import type {
  EvidenceChannel,
  EvidenceCollectionPolicy,
  EvidenceManifest,
  FailureCategory,
  RunOutcome,
  RunReview,
  SoakEvidenceChannelReport,
  SoakReport,
  TargetProfile,
} from "@relay/protocol";

const EVIDENCE_CHANNELS: EvidenceChannel[] = [
  "input",
  "screenshot",
  "video",
  "ui-tree",
  "logs",
  "network",
  "performance",
  "crash",
  "audio",
];

export type SoakRunEvidence = {
  id: string;
  action: string;
  batchId?: string;
  targetProfile?: TargetProfile;
  status: string;
  outcome?: RunOutcome;
  review?: RunReview;
  failureCategory?: FailureCategory;
  caseCount?: number;
  evidence?: EvidenceManifest;
  evidencePolicy?: EvidenceCollectionPolicy;
  artifacts?: Array<{ kind: string; data: unknown }>;
};

function expectedFor(run: SoakRunEvidence, channel: EvidenceChannel): boolean {
  if (channel === "audio") return Boolean(run.evidencePolicy?.sensitive.audio);
  if (channel === "crash") return Boolean(run.evidencePolicy?.sensitive.crash);
  return true;
}

function evidenceReport(
  runs: SoakRunEvidence[],
  channel: EvidenceChannel,
): SoakEvidenceChannelReport {
  const expectedRuns = runs.filter((run) => expectedFor(run, channel));
  let captured = 0;
  let partial = 0;
  let denied = 0;
  let unsupported = 0;
  let failed = 0;
  let missing = 0;
  for (const run of expectedRuns) {
    const status = run.evidence?.channels[channel]?.status;
    if (status === "captured") captured += 1;
    else if (status === "partial") partial += 1;
    else if (status === "denied" || status === "redacted") denied += 1;
    else if (status === "unsupported") unsupported += 1;
    else if (status === "failed") failed += 1;
    else missing += 1;
  }
  const usable = captured + partial;
  return {
    channel,
    expected: expectedRuns.length,
    captured,
    partial,
    denied,
    unsupported,
    failed,
    missing,
    coverageRate: expectedRuns.length ? usable / expectedRuns.length : null,
  };
}

function matrixMetadata(runs: SoakRunEvidence[]): { matrixId?: string; matrixName?: string } {
  for (const run of runs) {
    const artifact = run.artifacts?.find((item) => item.kind === "compatibility-profile");
    if (!artifact?.data || typeof artifact.data !== "object") continue;
    const data = artifact.data as { matrixId?: unknown; matrixName?: unknown };
    return {
      ...(typeof data.matrixId === "string" ? { matrixId: data.matrixId } : {}),
      ...(typeof data.matrixName === "string" ? { matrixName: data.matrixName } : {}),
    };
  }
  return {};
}

export function buildSoakReport(runs: SoakRunEvidence[], batchId: string): SoakReport | null {
  const current = runs.filter((run) => run.batchId === batchId && run.targetProfile);
  if (!current.length) return null;
  const targetProfiles = [
    ...new Map(current.map((run) => [run.targetProfile!.id, run.targetProfile!])).values(),
  ].sort((left, right) => left.name.localeCompare(right.name));
  const isPending = (run: SoakRunEvidence) =>
    run.status === "queued" || run.status === "running" || run.status === "paused";
  const passed = current.filter(
    (run) =>
      run.review?.status !== "pending" &&
      run.review?.status !== "rejected" &&
      (run.outcome === "passed" || run.status === "ok" || run.status === "healed"),
  ).length;
  const productFailures = current.filter((run) => run.outcome === "product-failure").length;
  const uncertain = current.filter((run) => run.outcome === "uncertain").length;
  const pending = current.filter(isPending).length;
  const harnessFailures = current.length - passed - productFailures - uncertain - pending;
  const policy = current.find((run) => run.evidencePolicy)?.evidencePolicy;
  return {
    schemaVersion: 1,
    batchId,
    recipeId: current[0]!.action,
    ...matrixMetadata(current),
    generatedAt: Date.now(),
    repetitions: Math.max(1, ...current.map((run) => run.caseCount ?? 1)),
    total: current.length,
    complete: current.length - pending,
    pending,
    passed,
    productFailures,
    harnessFailures,
    uncertain,
    targetProfiles,
    ...(policy ? { collectionPolicy: policy } : {}),
    evidence: EVIDENCE_CHANNELS.map((channel) => evidenceReport(current, channel)),
  };
}
