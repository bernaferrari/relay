import type { TestJob } from "../session/session.js";
import { automaticVideoAllowed } from "../evidence/evidence-policy.js";

/** Legacy campaign Runs used screenshots alone. Explicit full mode requests
 * video even when the Run also has individual screenshot review checkpoints. */
export function runVideoAllowed(job: Pick<TestJob, "evidencePolicy" | "recipeSnapshot">): boolean {
  return (
    automaticVideoAllowed(job.evidencePolicy) &&
    (job.evidencePolicy.mode === "full" ||
      !job.recipeSnapshot?.steps.some((step) => Boolean(step.check)))
  );
}
