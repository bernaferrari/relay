/**
 * Runtime capability behind the bounded Android document-origin restore.
 *
 * `ValidatedFrozenDocumentOrigin` is intentionally opaque in TypeScript, but
 * type assertions disappear in JS. Keep the real issuance marker private to
 * this module so captureScrollableSurvey cannot be convinced by a hand-built
 * first viewport. The evidence loader is the only production issuer.
 */
import type {
  ScrollSurveyCapture,
  ValidatedFrozenDocumentOrigin,
} from "./scrollable-survey-types.js";

const issuedFrozenDocumentOrigins = new WeakSet<object>();

/** The capability contains raw pixels/tree facts used for origin comparison.
 * A WeakSet alone proves where its outer object came from, not that an
 * untrusted caller has not changed a nested field after issuance. Snapshot
 * payloads are structured-cloneable data, so recursively freeze the clone
 * before it enters the issuer set. */
function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

export function mintValidatedFrozenDocumentOrigin(
  capture: ScrollSurveyCapture,
): ValidatedFrozenDocumentOrigin {
  const capability = deepFreeze({
    screenshot: structuredClone(capture.screenshot),
    snapshot: structuredClone(capture.snapshot),
  });
  issuedFrozenDocumentOrigins.add(capability);
  // This internal module is the only production cast. The public survey checks
  // the WeakSet before it authorizes either fast movement or durable issuance.
  return capability as ValidatedFrozenDocumentOrigin;
}

export function isMintedValidatedFrozenDocumentOrigin(
  value: unknown,
): value is ValidatedFrozenDocumentOrigin {
  return typeof value === "object" && value !== null && issuedFrozenDocumentOrigins.has(value);
}
