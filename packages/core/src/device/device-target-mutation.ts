import { getExecutingJobId } from "../execution/control.js";
import { runTargetMutation } from "../target/target-control.js";
import { targetIdentity } from "../target/target-context.js";

export function mutateCurrentTarget<T>(operation: () => Promise<T>): Promise<T> {
  return runTargetMutation(targetIdentity(), getExecutingJobId(), operation);
}
