/** Make an immutable run manifest the boundary for a user-visible pass. */
import type { PersistedRun } from "./runs.js";
import type { TestJob } from "./session-contract.js";

export type TerminalSessionPersistenceResult = {
  durable: boolean;
  /** The original verdict could not be committed, so a durable non-pass
   * replacement was written instead. */
  replacedWithNonPass?: boolean;
};

type TerminalSessionPersistenceDependencies = {
  persistRun(job: TestJob): Promise<PersistedRun>;
  projectPersistedRun(run: PersistedRun): Promise<unknown>;
  now(): number;
  setOutcome(job: TestJob): void;
};

function errorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  // File paths and low-level storage details belong in local diagnostics, not
  // in a persisted public job/report field.
  return detail.replaceAll(/(?:\/[^\s:]+)+/gu, "[path]").slice(0, 240);
}

async function projectPersistedRun(
  run: PersistedRun,
  log: (line: string) => void,
  project: (run: PersistedRun) => Promise<unknown>,
): Promise<void> {
  await project(run).catch((error) =>
    log(
      `warn: App Map run projection failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ),
  );
}

/**
 * Commit the terminal run before Relay exposes a passing result. If the first
 * commit failed after a device interaction, retry once with an explicit
 * non-pass verdict. A second failure leaves `persisted` false; the durable
 * worker journal then retains its target fence for explicit recovery.
 */
export async function commitTerminalSessionRun(
  job: TestJob,
  log: (line: string) => void,
  dependencies: TerminalSessionPersistenceDependencies,
): Promise<TerminalSessionPersistenceResult> {
  try {
    const persisted = await dependencies.persistRun(job);
    await projectPersistedRun(persisted, log, dependencies.projectPersistedRun);
    return { durable: true };
  } catch (firstError) {
    const firstMessage = errorMessage(firstError);
    const failedAt = dependencies.now();
    const error = "Immutable run evidence could not be committed; the execution is not a pass.";
    job.finishedAt ??= failedAt;
    job.status = "error";
    job.error = error;
    job.errorCode = "INTERNAL";
    job.result = "execution evidence was not durably committed";
    // The device may have completed a retry, but without an immutable record
    // Relay must not present that tentative device outcome as a healed pass.
    job.healed = undefined;
    job.healMessage = undefined;
    job.kind = "Replay";
    job.tone = "fail";
    job.logs.push(`==> FAIL: ${error}`);
    job.artifacts.push({
      kind: "run-manifest-commit-failure",
      capturedAt: failedAt,
      data: { schemaVersion: 1, code: "RUN_MANIFEST_COMMIT_FAILED" },
    });
    dependencies.setOutcome(job);
    log(
      `warn: initial immutable run commit failed (${firstMessage}); recording a non-pass verdict`,
    );

    try {
      const persisted = await dependencies.persistRun(job);
      await projectPersistedRun(persisted, log, dependencies.projectPersistedRun);
      return { durable: true, replacedWithNonPass: true };
    } catch (secondError) {
      log(
        `error: immutable run commit remains unavailable (${errorMessage(secondError)}); target stays fenced for recovery`,
      );
      return { durable: false };
    }
  }
}
