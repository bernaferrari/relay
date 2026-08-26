/**
 * Pack findings, arranged the way a Combine grid reads them.
 *
 * The analysis is computed once by the server and travels inside the pack
 * manifest. This only groups it: one entry per cell, each finding already
 * paired with the frame it came from. No fetching, no styling, no layout.
 */
import type {
  CombineEvidenceFinding,
  LocaleRunAnalysisReport,
  LocaleRunPackManifest,
} from "@relay/protocol";
import type { LocaleCellAnalysis } from "./combine-verdict";

export type PackFinding = CombineEvidenceFinding & {
  /** Pack-relative PNG the finding was observed on, when the frame was kept. */
  frame?: string;
};

export type PackCellFindings = {
  locale: string;
  jobId: string;
  status: string;
  frames: string[];
  findings: PackFinding[];
  critical: number;
  warnings: number;
};

export type PackFindingsSummary = {
  baselineLocale: string;
  total: number;
  critical: number;
  warnings: number;
  affectedScreens: number;
  /** Frames captured without a UI tree: only their presence could be checked. */
  unreadFrames: number;
};

function withFrame(manifest: LocaleRunPackManifest, finding: CombineEvidenceFinding): PackFinding {
  const frame = manifest.byCanonicalKey[finding.canonicalKey]?.[finding.locale];
  return frame ? { ...finding, frame } : { ...finding };
}

export function packFindingsSummary(manifest: LocaleRunPackManifest): PackFindingsSummary {
  const { analysis, analysisCoverage } = manifest;
  return {
    baselineLocale: analysis.baselineLocale,
    total: analysis.findings.length,
    critical: analysis.critical,
    warnings: analysis.warnings,
    affectedScreens: analysis.affectedScreens,
    unreadFrames: Math.max(0, analysisCoverage.frames - analysisCoverage.inspectedFrames),
  };
}

/** One entry per matrix case, in pack order, including the clean ones. */
export function packFindingsByCase(manifest: LocaleRunPackManifest): PackCellFindings[] {
  const byLocale = new Map<string, PackFinding[]>();
  for (const finding of manifest.analysis.findings) {
    byLocale.set(finding.locale, [
      ...(byLocale.get(finding.locale) ?? []),
      withFrame(manifest, finding),
    ]);
  }
  return manifest.cases.map((item) => {
    const findings = byLocale.get(item.locale) ?? [];
    return {
      locale: item.locale,
      jobId: item.jobId,
      status: item.status,
      frames: item.frames,
      findings,
      critical: findings.filter((finding) => finding.severity === "critical").length,
      warnings: findings.filter((finding) => finding.severity === "warning").length,
    };
  });
}

/**
 * The grid's lookup: what the analysis says about one case's one screenshot.
 *
 * Cells are keyed by run and frame path rather than by position, because the
 * grid and the analyzer each decide for themselves which captures are the
 * authored ones. A cell the report does not mention returns nothing, and a
 * verdict of "not checked" is the honest answer for it.
 */
export function localeCellAnalysisIndex(
  report: LocaleRunAnalysisReport | null | undefined,
): (jobId: string, framePath: string | undefined) => LocaleCellAnalysis | undefined {
  if (!report) return () => undefined;
  const byLocale = new Map<string, CombineEvidenceFinding[]>();
  for (const finding of report.analysis.findings) {
    byLocale.set(finding.locale, [...(byLocale.get(finding.locale) ?? []), finding]);
  }
  const cells = new Map<string, CombineEvidenceFinding[]>();
  for (const item of report.cases) {
    const findings = byLocale.get(item.locale) ?? [];
    for (const frame of item.frames) {
      const own = findings.filter((finding) => finding.canonicalKey === frame.canonicalKey);
      // Text findings need a tree. A frame captured without one was only
      // checked for presence, so a clean result there is not yet a pass.
      if (!own.length && !frame.inspected) continue;
      cells.set(`${item.jobId}\n${frame.framePath}`, own);
    }
  }
  const baselineLabel = report.analysis.baselineLocale;
  return (jobId, framePath) => {
    if (!framePath) return undefined;
    const findings = cells.get(`${jobId}\n${framePath}`);
    if (!findings) return undefined;
    return baselineLabel ? { findings, baselineLabel } : { findings };
  };
}

/** Findings observed on one frame, for a screenshot a person already opened. */
export function packFindingsForFrame(
  manifest: LocaleRunPackManifest,
  framePath: string,
): PackFinding[] {
  return manifest.analysis.findings
    .filter(
      (finding) => manifest.byCanonicalKey[finding.canonicalKey]?.[finding.locale] === framePath,
    )
    .map((finding) => withFrame(manifest, finding));
}
