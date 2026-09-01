function appMapTestIdentity(run) {
  const artifact = run?.artifacts?.find(
    (candidate) =>
      (candidate?.kind === "app-map-test-plan" || candidate?.kind === "app-map-flow-plan") &&
      candidate.data &&
      typeof candidate.data === "object" &&
      !Array.isArray(candidate.data),
  );
  const plan = artifact?.data;
  return {
    appMapId: typeof plan?.appMapId === "string" ? plan.appMapId : null,
    testId:
      plan?.test && typeof plan.test === "object" && typeof plan.test.id === "string"
        ? plan.test.id
        : null,
  };
}

function summarizeRun(runResult) {
  if (!runResult || runResult.status !== "verified") {
    return runResult
      ? { status: runResult.status, ...(runResult.error ? { error: runResult.error } : {}) }
      : { status: "not-supplied" };
  }
  const run = runResult.run;
  return {
    status: "verified",
    path: runResult.path,
    bytes: runResult.bytes,
    digest: runResult.digest,
    runId: run.id,
    inputDigest: run.inputDigest,
    platform: run.platform ?? run.targetProfile?.platform ?? null,
    sourceRevision: run.sourceRevision ?? null,
    targetProfile: run.targetProfile ?? null,
    executionTarget: run.executionTarget ?? null,
    appMapTest: appMapTestIdentity(run),
    operationId: run.executionProvenance?.operationId ?? null,
    requestId: run.executionProvenance?.requestId ?? null,
  };
}

function summarizeTracePack(tracePack) {
  if (!tracePack || tracePack.status !== "verified") {
    return tracePack
      ? {
          status: tracePack.status,
          ...(tracePack.digest ? { digest: tracePack.digest } : {}),
          ...(tracePack.error ? { error: tracePack.error } : {}),
        }
      : { status: "not-supplied" };
  }
  const projection = tracePack.projection;
  return {
    status: "verified",
    path: tracePack.path,
    bytes: tracePack.bytes,
    digest: tracePack.digest,
    canonicalDigest: tracePack.canonicalDigest,
    runId: projection.run.id,
    inputDigest: projection.run.inputDigest,
    platform: projection.run.platform,
    sourceRevision: projection.run.sourceRevision,
    targetProfile: projection.run.targetProfile,
    executionTarget: projection.run.executionTarget,
    appMapTest: projection.plan,
    historicalVerdict: projection.historicalVerdict,
  };
}

/** Keep the report inspectable without embedding retained Run payloads. */
export function summarizeExactProofInputs(exact) {
  return {
    status: exact.status,
    baseSha: exact.baseSha,
    oldSha: exact.oldSha,
    repairedSha: exact.repairedSha,
    oldRun: summarizeRun(exact.oldRun),
    repairedRun: summarizeRun(exact.repairedRun),
    oldTracePack: summarizeTracePack(exact.oldTracePack),
    repairedTracePack: summarizeTracePack(exact.repairedTracePack),
    retained: exact.retained,
    blockers: exact.blockers,
  };
}
