function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function summarizeJob(value: unknown): unknown {
  const job = object(value);
  if (!job || typeof job.id !== "string" || typeof job.status !== "string") return value;
  const steps = Array.isArray(job.steps) ? job.steps : undefined;
  const frames = Array.isArray(job.frames) ? job.frames : undefined;
  const artifacts = Array.isArray(job.artifacts) ? job.artifacts : undefined;
  const checks = artifacts?.flatMap((value) => {
    const artifact = object(value);
    const data = object(artifact?.data);
    if (
      artifact?.kind !== "campaign-check-result" ||
      typeof data?.id !== "string" ||
      typeof data.title !== "string" ||
      (data.status !== "passed" && data.status !== "failed" && data.status !== "blocked") ||
      typeof data.startedAt !== "number" ||
      typeof data.finishedAt !== "number"
    ) {
      return [];
    }
    return [
      {
        id: data.id,
        title: data.title,
        status: data.status,
        startedAt: data.startedAt,
        finishedAt: data.finishedAt,
        durationMs: Math.max(0, data.finishedAt - data.startedAt),
        ...(typeof data.error === "string" ? { error: data.error } : {}),
        ...(typeof data.dependencyReason === "string"
          ? { dependencyReason: data.dependencyReason }
          : {}),
      },
    ];
  });
  const logs = Array.isArray(job.logs)
    ? job.logs.filter((entry): entry is string => typeof entry === "string").slice(-24)
    : Array.isArray(job.lastLogs)
      ? job.lastLogs.filter((entry): entry is string => typeof entry === "string").slice(-24)
      : [];
  const optional = [
    "title",
    "action",
    "platform",
    "serial",
    "outcome",
    "error",
    "errorCode",
    "failureCategory",
    "queuedAt",
    "startedAt",
    "finishedAt",
    "durationMs",
    "batchId",
    "caseIndex",
    "caseCount",
  ] as const;
  return {
    id: job.id,
    status: job.status,
    ...Object.fromEntries(
      optional.flatMap((key) =>
        typeof job[key] === "string" || typeof job[key] === "number" ? [[key, job[key]]] : [],
      ),
    ),
    ...(steps
      ? {
          stepCount: steps.length,
          failedSteps: steps
            .map(object)
            .filter((step) => step?.status === "error")
            .map((step) => ({ id: step!.id, title: step!.title, log: step!.log })),
        }
      : {}),
    ...(frames ? { frameCount: frames.length } : {}),
    ...(artifacts ? { artifactCount: artifacts.length } : {}),
    ...(checks?.length ? { checks } : {}),
    ...(logs.length ? { logs } : {}),
  };
}

/** Bounded command/MCP projection for execution jobs. Full traces remain in
 * run resources and TracePacks where they can be queried deliberately. */
export function summarizeExecutionOperationResult(operationId: string, result: unknown): unknown {
  if (operationId !== "app-map.flow.run" && !operationId.startsWith("job.")) return result;
  const response = object(result);
  if (!response) return result;
  const job = response.job === undefined ? undefined : summarizeJob(response.job);
  const jobs = Array.isArray(response.jobs) ? response.jobs.map(summarizeJob) : undefined;
  const plan = object(response.plan);
  const flow = object(plan?.flow);
  const connections = Array.isArray(plan?.connections) ? plan.connections : undefined;
  return {
    ...(job !== undefined ? { job } : {}),
    ...(jobs !== undefined ? { jobs } : {}),
    ...(plan
      ? {
          plan: {
            appMapId: plan.appMapId,
            appMapRevision: plan.appMapRevision,
            ...(flow ? { flow: { id: flow.id, name: flow.name } } : {}),
            connectionCount: connections?.length ?? 0,
            terminal: plan.terminal,
          },
        }
      : {}),
    ...(response.matrix !== undefined ? { matrix: response.matrix } : {}),
  };
}
