import { stepErr } from "./recipe-validation-support.js";

const STEP_METADATA_FIELDS = [
  "id",
  "coverage",
  "group",
  "evidence",
  "note",
  "reviewedExternalEffects",
  "optional",
  "check",
  "when",
  "leftoverSkip",
] as const;

const ORDINARY_STEP_FIELDS: Record<string, readonly string[]> = {
  tap: [
    "kind",
    "target",
    "expectedApp",
    "fallbackTargets",
    "navigationContract",
    "gesture",
    "tapCount",
    "intervalMs",
    "durationMs",
    ...STEP_METADATA_FIELDS,
  ],
  type: ["kind", "text", "target", "mode", ...STEP_METADATA_FIELDS],
  key: ["kind", "key", ...STEP_METADATA_FIELDS],
  sleep: ["kind", "ms", ...STEP_METADATA_FIELDS],
  swipe: ["kind", "from", "to", "durationMs", ...STEP_METADATA_FIELDS],
  "wait-for": ["kind", "target", "timeoutMs", ...STEP_METADATA_FIELDS],
  scroll: ["kind", "direction", "amount", "until", "maxAttempts", ...STEP_METADATA_FIELDS],
  expect: ["kind", "target", "condition", "timeoutMs", ...STEP_METADATA_FIELDS],
  screenshot: ["kind", "caption", "review", ...STEP_METADATA_FIELDS],
  "assert-layout": ["kind", "relation", "first", "second", "timeoutMs", ...STEP_METADATA_FIELDS],
  "capture-surface": [
    "kind",
    "screenId",
    "screenTitle",
    "variantId",
    "surfaceId",
    "baselineCaptureId",
    "reason",
    "maxScrolls",
    "forceRecapture",
    "baselineTrust",
    "baselineTrustReason",
    "documentOrigin",
    "documentOriginProof",
    "reviewedDocumentOrigin",
    "baseline",
    ...STEP_METADATA_FIELDS,
  ],
  tour: [
    "kind",
    "depth",
    "screenshot",
    "captureOrigin",
    "originVerifiedBySetup",
    "maxStops",
    "excludeLanguageRows",
    "originScreenId",
    "originTitle",
    "originFingerprint",
    "originAliases",
    "originObservations",
    "preludeStartFingerprint",
    "preludeStartAliases",
    "preludeSteps",
    "fallbackStops",
    "landmarkStops",
    "returnAfterLast",
    "scrollSearch",
    ...STEP_METADATA_FIELDS,
  ],
};

export function assertKnownStepFields(
  raw: Record<string, unknown>,
  index: number,
  kind: string,
): void {
  const allowed = ORDINARY_STEP_FIELDS[kind];
  if (!allowed) return;
  const known = new Set<string>(allowed);
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) throw stepErr(index, `unknown field: ${key}`);
  }
}
