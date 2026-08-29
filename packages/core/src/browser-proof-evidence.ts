import {
  BROWSER_PROOF_EVIDENCE_ARTIFACT_KIND,
  BROWSER_PROOF_REQUIRED_CHANNELS,
  parseBrowserProofEvidence,
  type BrowserProofEvidence,
} from "@relay/protocol";
import type { PersistedRun } from "./runs.js";

type BrowserRunIdentity = Pick<
  PersistedRun,
  | "id"
  | "platform"
  | "serial"
  | "executionTarget"
  | "targetProfile"
  | "browserCaseProfile"
  | "sourceRevision"
> & { artifacts: PersistedRun["artifacts"] };

export type BrowserProofEvidenceInspection = Readonly<{
  evidence?: BrowserProofEvidence;
  missing: readonly string[];
}>;

export type BrowserProofEvidenceReferenceCheck = Readonly<{
  missing: readonly string[];
}>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]),
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

export function isBrowserProofRun(
  run: Pick<BrowserRunIdentity, "platform" | "executionTarget" | "browserCaseProfile">,
): boolean {
  return (
    run.platform === "browser" ||
    run.executionTarget?.platform === "browser" ||
    run.browserCaseProfile !== undefined
  );
}

function browserEvidenceArtifact(run: BrowserRunIdentity) {
  return run.artifacts.filter(({ kind }) => kind === BROWSER_PROOF_EVIDENCE_ARTIFACT_KIND);
}

/** Validate the browser envelope against the immutable Run identity. A valid
 * browser artifact from another Run, target, build, or environment is not
 * evidence for this Run. */
export function inspectBrowserProofEvidence(
  run: BrowserRunIdentity,
): BrowserProofEvidenceInspection {
  if (!isBrowserProofRun(run)) return { missing: [] };
  const artifacts = browserEvidenceArtifact(run);
  if (artifacts.length === 0) return { missing: ["browser-evidence:missing"] };
  if (artifacts.length !== 1) return { missing: ["browser-evidence:duplicate"] };

  let evidence: BrowserProofEvidence;
  try {
    evidence = parseBrowserProofEvidence(artifacts[0]!.data);
  } catch {
    return { missing: ["browser-evidence:invalid"] };
  }
  const missing: string[] = [];
  if (evidence.runId !== run.id) missing.push("browser-evidence:run-binding");
  const targetId = run.executionTarget?.targetId ?? run.serial;
  if (!targetId || evidence.target.targetId !== targetId) {
    missing.push("browser-evidence:target-binding");
  }
  if (!run.targetProfile?.id || evidence.target.targetProfileId !== run.targetProfile.id) {
    missing.push("browser-evidence:target-profile-binding");
  }
  const sourceRevision = run.sourceRevision;
  if (
    !sourceRevision ||
    evidence.build.sourceSha !== sourceRevision.sha ||
    sourceRevision.artifactDigest === undefined ||
    evidence.build.artifactDigest !== sourceRevision.artifactDigest
  ) {
    missing.push("browser-evidence:build-binding");
  }
  if (!run.browserCaseProfile) {
    missing.push("browser-evidence:environment-missing");
  } else if (!sameValue(evidence.environment, run.browserCaseProfile)) {
    missing.push("browser-evidence:environment-binding");
  }
  if (
    evidence.browser.engine !== evidence.environment.engine ||
    (evidence.environment.revision !== undefined &&
      evidence.browser.version !== evidence.environment.revision)
  ) {
    missing.push("browser-evidence:engine-binding");
  }
  missing.push(...evidence.completeness.missing.map((channel) => `browser:${channel}`));
  return { evidence, missing };
}

/** Return every path that a captured browser channel claims to contain. The
 * TracePack exporter resolves these against its embedded artifact closure. */
export function browserProofEvidenceArtifactRefs(
  evidence: BrowserProofEvidence,
): readonly string[] {
  return [
    ...BROWSER_PROOF_REQUIRED_CHANNELS.flatMap(
      (channel) => evidence.channels[channel].artifactRefs,
    ),
    ...(evidence.traceReference ? [evidence.traceReference.path] : []),
  ];
}

export function checkBrowserProofEvidenceReferences(
  evidence: BrowserProofEvidence,
  embeddedPaths: ReadonlySet<string>,
): BrowserProofEvidenceReferenceCheck {
  const missing = [...new Set(browserProofEvidenceArtifactRefs(evidence))]
    .filter((path) => !embeddedPaths.has(path))
    .map((path) => `browser-evidence:artifact-missing:${path}`);
  return { missing };
}
