import type { RelayOperationPort } from "./operation-port.js";
import type { RunTestSnapshot, WorkflowRef } from "./types.js";
import type { RunWorkflowReference } from "./workflow-ref.js";
import { parseCanonicalJob, snapshotFromJob } from "./job-projection.js";
import { workflowErrorDetail as errorDetail } from "./workflow-problems.js";

export async function readRunJob(
  operations: RelayOperationPort,
  ref: WorkflowRef,
  reference: RunWorkflowReference,
): Promise<RunTestSnapshot> {
  try {
    const output = await operations.invoke("job.get", { jobId: reference.jobId });
    const job = parseCanonicalJob(output.job);
    if (!job || job.id !== reference.jobId) {
      throw new TypeError("Job response does not identify the workflow job");
    }
    return snapshotFromJob({ ref, frozen: reference.frozen, job });
  } catch (error) {
    return {
      schemaVersion: 1,
      kind: "run-test",
      title: `Run ${reference.frozen.testId}`,
      phase: "needs-attention",
      version: "unavailable",
      ref,
      frozen: reference.frozen,
      execution: { jobId: reference.jobId },
      progress: { label: "Relay could not inspect the canonical job" },
      allowedNextActions: ["inspect"],
      problems: [
        {
          code: "malformed-response",
          title: "Relay could not inspect this run",
          detail: errorDetail(error),
          recovery:
            "Restore Relay connectivity or repair the response contract, then inspect again.",
          retryable: true,
        },
      ],
      evidenceRefs: [],
    };
  }
}
