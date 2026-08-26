import { createHash } from "node:crypto";
import type { CombineEvidenceAnalysis, CombineEvidenceFinding } from "@relay/protocol";
import type { CombineEvidenceControl, CombineEvidenceScreen, CombineEvidenceSession } from "./combine-evidence-session.js";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}


function normalizedEvidenceLabel(value: string | undefined): string {
  return (value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

/**
 * A single token that reads as code rather than as copy.
 *
 * Accessibility trees leak raw identifiers into the label slot — `RightButtonBar`
 * on a Grok toolbar, `imagine.animateYourPhotos.cell` on a suggestion row. They
 * are identical in every language because nobody ever wrote them for a reader,
 * so a translation check reports each one once per locale: forty languages of a
 * defect that does not exist, sitting on top of the ones that do.
 *
 * Only unspaced tokens qualify, and only by dotted path or by an internal case
 * hump. Real copy is spaced or plainly cased; the words this does swallow —
 * `iPhone`, `macOS` — are brand names no translator would have touched either.
 */
function identifierShapedLabel(label: string): boolean {
  if (/\s/u.test(label)) return false;
  return /^\p{L}[\p{L}\p{N}]*(?:\.[\p{L}\p{N}]+)+$/u.test(label) || /\p{Ll}\p{Lu}/u.test(label);
}

function meaningfulEvidenceLabel(value: string | undefined): boolean {
  const label = (value ?? "").trim();
  if (label.length < 4 || !/\p{L}/u.test(label)) return false;
  if (/^(?:https?:\/\/|www\.|[\d\W_]+$)/iu.test(label)) return false;
  return !identifierShapedLabel(label);
}

/**
 * The keys this group can be compared on, decided over every locale in it
 * rather than over the baseline's copy alone.
 *
 * `meaningfulEvidenceLabel` reads one label at a time, and applying it only to the
 * baseline made the comparable set a function of which language the sweep
 * started in: "Ask" is three letters and "Chiedi" is six, so the same control
 * was compared when the baseline was Italian and skipped when it was English.
 *
 * One locale's readable copy is enough, which is both order-independent and
 * what the floor was built for: the labels it exists to swallow are raw
 * identifiers, and those are identical in every language, so no locale ever
 * reads one as copy.
 */
function comparableStableKeys(group: readonly CombineEvidenceScreen[]): Set<string> {
  const observed = new Map<string, string[]>();
  for (const screen of group) {
    for (const [key, label] of Object.entries(screen.localizedLabels ?? {})) {
      // A role+label key is locale-bound by construction: it cannot name the
      // same control in two languages.
      if (key.startsWith("label:")) continue;
      observed.set(key, [...(observed.get(key) ?? []), label]);
    }
  }
  const comparable = new Set<string>();
  for (const [key, labels] of observed) {
    if (labels.some(meaningfulEvidenceLabel)) comparable.add(key);
  }
  return comparable;
}

function localeFamily(locale: string): string {
  return locale.trim().toLocaleLowerCase().split(/[-_]/u)[0] ?? locale;
}

function evidenceFindingId(parts: string[]): string {
  return digest(`relay-corpus-finding:v1:${parts.join("\u0000")}`).slice(0, 20);
}

/** The platform already gave up on the string: it ends in an ellipsis. */
function looksTruncated(value: string): boolean {
  return /(?:\u2026|\.{3})\s*$/u.test(value.trim());
}

/** How much more room the translation needs than the original copy. */
function lengthGrowth(baseline: string, observed: string): number {
  const from = baseline.trim().length;
  if (from === 0) return 0;
  return observed.trim().length / from;
}

type Box = NonNullable<CombineEvidenceControl["rect"]>;

function boxesByStableKey(screen: CombineEvidenceScreen): Map<string, Box> {
  const boxes = new Map<string, Box>();
  for (const control of screen.controls ?? []) {
    if (control.rect) boxes.set(control.stableKey, control.rect);
  }
  return boxes;
}

/**
 * The control kept the same box across the two passes.
 *
 * Sub-pixel and single-point differences are layout noise, so a box only counts
 * as "grew" once it gains real room for the extra characters.
 */
function sameBox(baseline: Box, observed: Box): boolean {
  return (
    Math.abs(observed.width - baseline.width) <= 1 &&
    Math.abs(observed.height - baseline.height) <= 1
  );
}

/**
 * A translated string that probably does not fit.
 *
 * Two independent signals, because neither platform reports clipping directly:
 * an accessibility label that already carries an ellipsis is the platform
 * telling us it truncated, and a materially longer string inside an unchanged
 * box is geometry telling us the same thing. Anything weaker stays unreported —
 * a locale review that cries wolf is worse than one that says less.
 */
const CLIPPED_GROWTH_RATIO = 1.4;

function clippedTextFinding(input: {
  baselineLabel: string;
  observedLabel: string;
  baselineRect?: Box;
  observedRect?: Box;
}): { confidence: "high" | "medium"; detail: string } | undefined {
  const { baselineLabel, observedLabel, baselineRect, observedRect } = input;
  if (looksTruncated(observedLabel) && !looksTruncated(baselineLabel)) {
    return {
      confidence: "high",
      detail: `“${observedLabel.trim()}” is cut off; “${baselineLabel.trim()}” fits.`,
    };
  }
  if (!baselineRect || !observedRect || !sameBox(baselineRect, observedRect)) return undefined;
  const growth = lengthGrowth(baselineLabel, observedLabel);
  if (growth < CLIPPED_GROWTH_RATIO) return undefined;
  return {
    confidence: "medium",
    detail:
      `“${observedLabel.trim()}” is ${Math.round((growth - 1) * 100)}% longer than ` +
      `“${baselineLabel.trim()}” but was given the same ${Math.round(observedRect.width)}×` +
      `${Math.round(observedRect.height)} box.`,
  };
}

/** Explainable checks over locale-stable screen and control evidence. No model
 * call is required, and possible linguistic defects remain explicitly
 * qualified so the report does not overstate certainty. */
export function analyzeCombineEvidence(
  session: CombineEvidenceSession,
): CombineEvidenceAnalysis {
  const baselineLocale = session.scope.mapLocale ?? session.scope.locales[0]!;
  const groups = new Map<string, CombineEvidenceScreen[]>();
  for (const screen of session.screens) {
    const group = groups.get(screen.canonicalKey) ?? [];
    group.push(screen);
    groups.set(screen.canonicalKey, group);
  }
  const findings: CombineEvidenceFinding[] = [];
  const add = (finding: Omit<CombineEvidenceFinding, "id">): void => {
    findings.push({
      ...finding,
      id: evidenceFindingId([
        finding.code,
        finding.canonicalKey,
        finding.locale,
        finding.stableKey ?? "",
      ]),
    });
  };

  for (const [canonicalKey, group] of groups) {
    const baseline = group.find((screen) => screen.locale === baselineLocale);
    const comparableKeys = comparableStableKeys(group);
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
      const stableBaselineLabels = Object.entries(baselineLabels).filter(([key]) =>
        comparableKeys.has(key),
      );
      const commonLabels = stableBaselineLabels.filter(([key]) => key in currentLabels);
      const unchangedLabels = commonLabels.filter(
        ([key, label]) =>
          normalizedEvidenceLabel(currentLabels[key]) === normalizedEvidenceLabel(label),
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

      const baselineBoxes = boxesByStableKey(baseline);
      const currentBoxes = boxesByStableKey(current);

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
        if (normalizedEvidenceLabel(observed) === normalizedEvidenceLabel(expected)) {
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
          continue;
        }
        const clipped = clippedTextFinding({
          baselineLabel: expected,
          observedLabel: observed,
          ...(baselineBoxes.get(stableKey) ? { baselineRect: baselineBoxes.get(stableKey)! } : {}),
          ...(currentBoxes.get(stableKey) ? { observedRect: currentBoxes.get(stableKey)! } : {}),
        });
        if (clipped) {
          add({
            code: "POSSIBLE_TEXT_CLIPPED",
            severity: "warning",
            confidence: clipped.confidence,
            canonicalKey,
            screenLabel,
            locale,
            baselineLocale,
            stableKey,
            expected,
            observed,
            detail: `${screenLabel}: ${clipped.detail}`,
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

