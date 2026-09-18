import { destIdentityVisualFrames, listedFramePath } from "./execution-summary-capture-review.js";

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

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
export function analysisCaseFrames(value: unknown): { path: string; caption?: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const frame = object(entry);
    const path =
      listedFramePath(frame?.framePath) ?? listedFramePath(frame?.path) ?? listedFramePath(entry);
    if (!path) return [];
    const caption = typeof frame?.caption === "string" ? frame.caption : undefined;
    return [{ path, ...(caption ? { caption } : {}) }];
  });
}

export function summarizeLocaleAnalysis(response: Record<string, unknown>): unknown {
  const analysis = object(response.analysis);
  if (!analysis) return response;
  const findings = Array.isArray(analysis.findings) ? analysis.findings : [];
  const cases = Array.isArray(response.cases) ? response.cases : [];
  const listed = cases.flatMap((value) => analysisCaseFrames(object(value)?.frames));
  const destIdentity = destIdentityVisualFrames(listed);
  const destPaths = new Set(destIdentity.map((frame) => frame.path));
  const leftover = new Set(
    destPaths.size
      ? listed.filter((frame) => !destPaths.has(frame.path)).map((frame) => frame.path)
      : [],
  );
  const originalFramePaths = new Map<string, unknown>();
  const framePaths = new Map<string, unknown>();
  const summarized = cases.map((value) => {
    const item = object(value);
    const frames = Array.isArray(item?.frames) ? item.frames : [];
    const visible = destPaths.size
      ? frames.filter((entry) => {
          const path = listedFramePath(object(entry)?.framePath) ?? listedFramePath(entry);
          return !path || destPaths.has(path);
        })
      : frames;
    for (const entry of frames) {
      const frame = object(entry);
      if (frame)
        originalFramePaths.set(
          `${String(item?.locale)}\n${String(frame.canonicalKey)}`,
          frame.framePath,
        );
    }
    for (const entry of visible) {
      const frame = object(entry);
      if (frame)
        framePaths.set(`${String(item?.locale)}\n${String(frame.canonicalKey)}`, frame.framePath);
    }
    return {
      jobId: item?.jobId,
      locale: item?.locale,
      status: item?.status,
      frameCount: visible.length,
      inspectedFrames: visible.filter((entry) => object(entry)?.inspected === true).length,
    };
  });
  const projectedFindings = findings
    .slice(0, MAX_SUMMARIZED_FINDINGS)
    .filter((value) => {
      const finding = object(value);
      const source = originalFramePaths.get(
        `${String(finding?.locale)}\n${String(finding?.canonicalKey)}`,
      );
      return typeof source !== "string" || !leftover.has(source);
    })
    .map((value) =>
      projectFinding(
        value,
        framePaths.get(`${String(object(value)?.locale)}\n${String(object(value)?.canonicalKey)}`),
      ),
    );
  return {
    batchId: response.batchId,
    locales: response.locales,
    coverage: response.coverage,
    ...(destIdentity.length ? { destIdentity } : {}),
    cases: summarized,
    analysis: {
      baselineLocale: analysis.baselineLocale,
      critical: analysis.critical,
      warnings: analysis.warnings,
      affectedScreens: analysis.affectedScreens,
      findingCount: findings.length,
      findings: projectedFindings,
    },
  };
}

export function summarizePackExport(response: Record<string, unknown>): unknown {
  const manifest = object(response.manifest);
  if (!manifest) return response;
  const analysis = object(manifest.analysis);
  const byCanonicalKey = object(manifest.byCanonicalKey);
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  const cases = Array.isArray(manifest.cases) ? manifest.cases : [];
  const listed = cases.flatMap((value) => analysisCaseFrames(object(value)?.frames));
  const destIdentity = destIdentityVisualFrames(listed);
  const destPaths = new Set(destIdentity.map((frame) => frame.path));
  const leftover = new Set(
    destPaths.size
      ? listed.filter((frame) => !destPaths.has(frame.path)).map((frame) => frame.path)
      : [],
  );
  return {
    ...(typeof response.rootDir === "string" ? { rootDir: response.rootDir } : {}),
    ...(Array.isArray(response.jobIds) ? { jobIds: response.jobIds } : {}),
    ...(destIdentity.length ? { destIdentity } : {}),
    manifest: {
      batchId: manifest.batchId,
      title: manifest.title,
      locales: manifest.locales,
      generatedAt: manifest.generatedAt,
      analysisCoverage: manifest.analysisCoverage,
      ...(object(manifest.content)
        ? {
            content: {
              method: object(manifest.content)?.method,
              inspectedPages: object(manifest.content)?.inspectedPages,
              uniquePages: object(manifest.content)?.uniquePages,
              duplicateGroupCount: Array.isArray(object(manifest.content)?.duplicateGroups)
                ? (object(manifest.content)!.duplicateGroups as unknown[]).length
                : 0,
              comparison: "comparison.html",
            },
          }
        : {}),
      cases: cases.map((value) => {
        const item = object(value);
        const frames = Array.isArray(item?.frames) ? item.frames : [];
        const visible = destPaths.size
          ? frames.filter((entry) => {
              const path = listedFramePath(object(entry)?.framePath) ?? listedFramePath(entry);
              return !path || destPaths.has(path);
            })
          : frames;
        return {
          locale: item?.locale,
          status: item?.status,
          frameCount: visible.length,
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
              findings: findings
                .slice(0, MAX_SUMMARIZED_FINDINGS)
                .filter((value) => {
                  const finding = object(value);
                  const source = object(byCanonicalKey?.[String(finding?.canonicalKey)])?.[
                    String(finding?.locale)
                  ];
                  return typeof source !== "string" || !leftover.has(source);
                })
                .map((value) => {
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
