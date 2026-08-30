import { captureBrowserProofEvidence } from "./browser-proof-evidence-runtime.js";
import { now } from "./events.js";
import { ensureRunDir } from "./runs.js";
import type { TestJob } from "./session.js";

/** Finalize the browser-owned evidence bundle without coupling the generic
 * collector lifecycle to Playwright's proof-context implementation. */
export async function stopBrowserProofEvidence(
  job: TestJob,
  log: (line: string) => void,
): Promise<void> {
  if (job.targetKind !== "browser" || !job.browserTargetId) return;
  const targetProfile = job.targetProfile;
  const environment = job.browserCaseProfile ?? targetProfile?.browserCaseProfile;
  const sourceRevision = job.sourceRevision;
  if (!targetProfile?.id || !environment || !sourceRevision?.artifactDigest) {
    log("warn: browser proof evidence unavailable: frozen target/build identity is incomplete");
    return;
  }
  try {
    const evidence = await captureBrowserProofEvidence({
      targetId: job.browserTargetId,
      runId: job.id,
      targetProfileId: targetProfile.id,
      sourceSha: sourceRevision.sha,
      artifactDigest: sourceRevision.artifactDigest,
      environment,
      runDir: await ensureRunDir(job),
      evidencePolicy: job.evidencePolicy,
    });
    job.artifacts.push({
      kind: "browser-proof-evidence",
      capturedAt: now(),
      data: evidence,
    });
    log(
      evidence.completeness.status === "complete"
        ? "evidence: browser proof channels captured"
        : `warn: browser proof evidence partial (${evidence.completeness.missing.join(", ")})`,
    );
  } catch (error) {
    log(
      `warn: browser proof evidence unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
