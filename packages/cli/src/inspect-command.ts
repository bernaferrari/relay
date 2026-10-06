import { ApiError } from "@relay/client";
import { summarizeExecutionOperationResult } from "@relay/protocol";
import { invokeOperation, type OperationInvoker } from "./invoke.js";

/** The everyday lookup accepts both canonical Runs and durable workflows. */
export async function inspectRunOrWorkflow(
  client: OperationInvoker,
  runOrWorkflowId: string,
  signal: AbortSignal,
  inspectWorkflow: (workflowId: string) => Promise<unknown>,
): Promise<unknown> {
  try {
    const result = await invokeOperation(client, "run.get", { runId: runOrWorkflowId }, signal);
    return summarizeExecutionOperationResult("run.get", result);
  } catch (error) {
    // A denied or unavailable Run is never evidence that this is a workflow.
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
  }
  return inspectWorkflow(runOrWorkflowId);
}
