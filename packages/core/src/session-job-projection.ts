import { classifyRunOutcome } from "./outcomes.js";
import { redactPrivateValue } from "./private-inputs.js";
import type { TestJob } from "./session-contract.js";

export function setOutcome(job: TestJob): void {
  const classified = classifyRunOutcome(job);
  job.outcome = classified.outcome;
  job.failureCategory = classified.failureCategory;
}

/** The runtime keeps private values only in memory for step resolution. Every
 * HTTP, MCP, event, and JSON boundary receives this redacted projection. */
export function jobForTransport(job: TestJob): TestJob {
  return redactPrivateValue(
    Object.fromEntries(Object.entries(job).filter(([key]) => key !== "toJSON")),
    job.resolvedInputs,
    job.sensitiveInputNames ?? [],
  ) as TestJob;
}
