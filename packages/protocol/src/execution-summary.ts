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

/** How many findings a pack export hands a caller before it has to open the pack. */
const MAX_SUMMARIZED_FINDINGS = 40;

/**
 * A pack export is the readable half of a matrix run, so its findings must
 * survive the job projection instead of being dropped with the rest of the
 * response. Each one keeps the frame it came from so a caller can look.
 */
function projectFinding(value: unknown, frame: unknown): unknown {
  const finding = object(value);
  if (!finding) return value;
  return {
    code: finding.code,
    severity: finding.severity,
    confidence: finding.confidence,
    locale: finding.locale,
    screenLabel: finding.screenLabel,
    detail: finding.detail,
    ...(typeof frame === "string" ? { frame } : {}),
  };
}

/**
 * A live analysis carries one entry per frame per case, which is a grid's worth
 * of paths for a caller that asked what broke. Keep the verdicts and the counts
 * that say how much could be read; the frames stay in the runs.
 */
function summarizeLocaleAnalysis(response: Record<string, unknown>): unknown {
  const analysis = object(response.analysis);
  if (!analysis) return response;
  const findings = Array.isArray(analysis.findings) ? analysis.findings : [];
  const cases = Array.isArray(response.cases) ? response.cases : [];
  const framePaths = new Map<string, unknown>();
  const summarized = cases.map((value) => {
    const item = object(value);
    const frames = Array.isArray(item?.frames) ? item.frames : [];
    for (const entry of frames) {
      const frame = object(entry);
      if (frame)
        framePaths.set(`${String(item?.locale)}\n${String(frame.canonicalKey)}`, frame.framePath);
    }
    return {
      jobId: item?.jobId,
      locale: item?.locale,
      status: item?.status,
      frameCount: frames.length,
      inspectedFrames: frames.filter((entry) => object(entry)?.inspected === true).length,
    };
  });
  return {
    batchId: response.batchId,
    locales: response.locales,
    coverage: response.coverage,
    cases: summarized,
    analysis: {
      baselineLocale: analysis.baselineLocale,
      critical: analysis.critical,
      warnings: analysis.warnings,
      affectedScreens: analysis.affectedScreens,
      findingCount: findings.length,
      findings: findings
        .slice(0, MAX_SUMMARIZED_FINDINGS)
        .map((value) =>
          projectFinding(
            value,
            framePaths.get(
              `${String(object(value)?.locale)}\n${String(object(value)?.canonicalKey)}`,
            ),
          ),
        ),
    },
  };
}

function summarizePackExport(response: Record<string, unknown>): unknown {
  const manifest = object(response.manifest);
  if (!manifest) return response;
  const analysis = object(manifest.analysis);
  const byCanonicalKey = object(manifest.byCanonicalKey);
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  const cases = Array.isArray(manifest.cases) ? manifest.cases : [];
  return {
    ...(typeof response.rootDir === "string" ? { rootDir: response.rootDir } : {}),
    ...(Array.isArray(response.jobIds) ? { jobIds: response.jobIds } : {}),
    manifest: {
      batchId: manifest.batchId,
      title: manifest.title,
      locales: manifest.locales,
      generatedAt: manifest.generatedAt,
      analysisCoverage: manifest.analysisCoverage,
      cases: cases.map((value) => {
        const item = object(value);
        return {
          locale: item?.locale,
          status: item?.status,
          frameCount: Array.isArray(item?.frames) ? item.frames.length : 0,
          ...(typeof item?.expectedFrames === "number"
            ? { expectedFrames: item.expectedFrames }
            : {}),
        };
      }),
      ...(analysis
        ? {
            analysis: {
              baselineLocale: analysis.baselineLocale,
              critical: analysis.critical,
              warnings: analysis.warnings,
              affectedScreens: analysis.affectedScreens,
              findingCount: findings.length,
              findings: findings.slice(0, MAX_SUMMARIZED_FINDINGS).map((value) => {
                const finding = object(value);
                if (!finding) return value;
                const locales = object(byCanonicalKey?.[String(finding.canonicalKey)]);
                return projectFinding(finding, locales?.[String(finding.locale)]);
              }),
            },
          }
        : {}),
    },
  };
}

/** Bounded command/MCP projection for execution jobs. Full traces remain in
 * run resources and TracePacks where they can be queried deliberately. */
export function summarizeExecutionOperationResult(operationId: string, result: unknown): unknown {
  if (operationId !== "app-map.flow.run" && !operationId.startsWith("job.")) return result;
  const response = object(result);
  if (!response) return result;
  if (operationId.endsWith(".export")) return summarizePackExport(response);
  if (operationId.endsWith(".analysis")) return summarizeLocaleAnalysis(response);
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
