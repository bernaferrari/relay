import { createHash } from "node:crypto";
import type {
  CorpusAnalysisReport,
  CorpusCoverageReport,
  CorpusFinding,
  CorpusScreen,
  CorpusSession,
} from "@relay/protocol";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function buildCorpusCoverage(session: CorpusSession): CorpusCoverageReport {
  const locales = session.scope.locales;
  const byKey = new Map<string, CorpusScreen[]>();
  for (const screen of session.screens) {
    const group = byKey.get(screen.canonicalKey) ?? [];
    group.push(screen);
    byKey.set(screen.canonicalKey, group);
  }
  const screens = [...byKey.entries()].map(([canonicalKey, group]) => {
    const observedLocales = [...new Set(group.map((screen) => screen.locale))];
    const missingLocales = locales.filter((locale) => !observedLocales.includes(locale));
    const label =
      group.find((screen) => screen.title)?.title ??
      group[0]?.path.at(-1) ??
      canonicalKey.slice(0, 12);
    return {
      id: canonicalKey.slice(0, 16),
      label,
      canonicalKey,
      observedLocales,
      missingLocales,
      screenIds: group.map((screen) => screen.id),
    };
  });
  screens.sort((left, right) => left.label.localeCompare(right.label));
  const complete = screens.filter((item) => item.missingLocales.length === 0).length;
  const missing = screens.filter((item) => item.observedLocales.length === 0).length;
  const partial = screens.length - complete - missing;
  return {
    sessionId: session.id,
    name: session.name,
    generatedAt: Date.now(),
    locales: [...locales],
    screens,
    complete,
    partial,
    missing,
  };
}

function normalizedCorpusLabel(value: string | undefined): string {
  return (value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

function meaningfulCorpusLabel(value: string | undefined): boolean {
  const label = (value ?? "").trim();
  if (label.length < 4 || !/\p{L}/u.test(label)) return false;
  if (/^(?:https?:\/\/|www\.|[\d\W_]+$)/iu.test(label)) return false;
  return true;
}

function localeFamily(locale: string): string {
  return locale.trim().toLocaleLowerCase().split(/[-_]/u)[0] ?? locale;
}

function corpusFindingId(parts: string[]): string {
  return digest(`relay-corpus-finding:v1:${parts.join("\u0000")}`).slice(0, 20);
}

/** Explainable checks over locale-stable screen and control evidence. No model
 * call is required, and possible linguistic defects remain explicitly
 * qualified so the report does not overstate certainty. */
export function analyzeCorpus(session: CorpusSession): CorpusAnalysisReport {
  const baselineLocale = session.scope.mapLocale ?? session.scope.locales[0]!;
  const groups = new Map<string, CorpusScreen[]>();
  for (const screen of session.screens) {
    const group = groups.get(screen.canonicalKey) ?? [];
    group.push(screen);
    groups.set(screen.canonicalKey, group);
  }
  const findings: CorpusFinding[] = [];
  const add = (finding: Omit<CorpusFinding, "id">): void => {
    findings.push({
      ...finding,
      id: corpusFindingId([
        finding.code,
        finding.canonicalKey,
        finding.locale,
        finding.stableKey ?? "",
      ]),
    });
  };

  for (const [canonicalKey, group] of groups) {
    const baseline = group.find((screen) => screen.locale === baselineLocale);
    const screenLabel =
      baseline?.title ??
      baseline?.path.at(-1) ??
      group.find((screen) => screen.title)?.title ??
      group[0]?.path.at(-1) ??
      canonicalKey.slice(0, 12);

    for (const locale of session.scope.locales) {
      const current = group.find((screen) => screen.locale === locale);
      if (!current) {
        add({
          code: "SCREEN_MISSING",
          severity: "critical",
          confidence: "high",
          canonicalKey,
          screenLabel,
          locale,
          baselineLocale,
          detail: `${screenLabel} was not captured in ${locale}.`,
        });
        continue;
      }
      if (
        !baseline ||
        locale === baselineLocale ||
        localeFamily(locale) === localeFamily(baselineLocale)
      ) {
        continue;
      }

      const baselineLabels = baseline.localizedLabels ?? {};
      const currentLabels = current.localizedLabels ?? {};
      const stableBaselineLabels = Object.entries(baselineLabels).filter(
        ([key, label]) => !key.startsWith("label:") && meaningfulCorpusLabel(label),
      );
      const commonLabels = stableBaselineLabels.filter(([key]) => key in currentLabels);
      const unchangedLabels = commonLabels.filter(
        ([key, label]) =>
          normalizedCorpusLabel(currentLabels[key]) === normalizedCorpusLabel(label),
      );

      const sameScreenshot =
        Boolean(baseline.snapshotDigest) && baseline.snapshotDigest === current.snapshotDigest;
      if (
        (sameScreenshot || baseline.fingerprint === current.fingerprint) &&
        stableBaselineLabels.length > 0 &&
        commonLabels.length > 0 &&
        unchangedLabels.length === commonLabels.length
      ) {
        add({
          code: "POSSIBLE_LOCALE_NOT_APPLIED",
          severity: "critical",
          confidence: sameScreenshot ? "high" : "medium",
          canonicalKey,
          screenLabel,
          locale,
          baselineLocale,
          detail: sameScreenshot
            ? `${screenLabel} has the exact same screenshot and labels in ${baselineLocale} and ${locale}; the language may not have changed.`
            : `${screenLabel} has the same semantic content in ${baselineLocale} and ${locale}; the language may not have changed.`,
        });
        continue;
      }

      for (const [stableKey, expected] of stableBaselineLabels) {
        const observed = currentLabels[stableKey];
        if (observed === undefined) {
          add({
            code: "CONTROL_MISSING",
            severity: "warning",
            confidence: "medium",
            canonicalKey,
            screenLabel,
            locale,
            baselineLocale,
            stableKey,
            expected,
            detail: `${expected} is present in ${baselineLocale} but missing from ${locale}.`,
          });
          continue;
        }
        if (normalizedCorpusLabel(observed) === normalizedCorpusLabel(expected)) {
          add({
            code: "POSSIBLE_UNTRANSLATED_TEXT",
            severity: "warning",
            confidence: "medium",
            canonicalKey,
            screenLabel,
            locale,
            baselineLocale,
            stableKey,
            expected,
            observed,
            detail: `“${observed}” is unchanged from ${baselineLocale} on ${screenLabel}.`,
          });
        }
      }
    }
  }

  const severityOrder = { critical: 0, warning: 1 } as const;
  findings.sort(
    (left, right) =>
      severityOrder[left.severity] - severityOrder[right.severity] ||
      left.screenLabel.localeCompare(right.screenLabel) ||
      left.locale.localeCompare(right.locale) ||
      left.code.localeCompare(right.code),
  );
  return {
    schemaVersion: 1,
    sessionId: session.id,
    generatedAt: Date.now(),
    baselineLocale,
    findings,
    critical: findings.filter((finding) => finding.severity === "critical").length,
    warnings: findings.filter((finding) => finding.severity === "warning").length,
    affectedScreens: new Set(findings.map((finding) => finding.canonicalKey)).size,
  };
}

export function formatCorpusExport(session: CorpusSession, format: "json" | "markdown"): string {
  if (format === "json") return `${JSON.stringify(session, null, 2)}\n`;
  const coverage = buildCorpusCoverage(session);
  const analysis = analyzeCorpus(session);
  const lines = [
    `# ${session.name}`,
    "",
    `- Status: ${session.status}`,
    `- Target: ${session.targetProfile?.name ?? session.targetId}`,
    `- Locales: ${session.scope.locales.join(", ")}`,
    `- Screens: ${session.screens.length}`,
    `- Transitions: ${session.transitions.length}`,
    `- Coverage: ${coverage.complete} complete · ${coverage.partial} partial`,
    `- Findings: ${analysis.critical} critical · ${analysis.warnings} warnings`,
    "",
    "## Screens by locale",
  ];
  for (const locale of session.scope.locales) {
    lines.push("", `### ${locale}`);
    for (const screen of session.screens.filter((item) => item.locale === locale)) {
      const path = screen.path.length ? screen.path.join(" › ") : "Root";
      lines.push(
        `- d${screen.depth} ${path}${screen.title ? ` — ${screen.title}` : ""} (\`${screen.artifactPath ?? screen.screenshotPath ?? screen.id}\`)`,
      );
    }
  }
  if (analysis.findings.length) {
    lines.push("", "## Findings");
    for (const finding of analysis.findings) {
      lines.push(`- **${finding.severity}** · ${finding.locale} · ${finding.detail}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
