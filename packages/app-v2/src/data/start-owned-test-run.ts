import type { ProductRunStartInput, ProductRunState } from "@relay/product/run-journey";
import { compileTestStarts, type PairedConfigurationWorkspace } from "./paired-configuration";

export function testStartRequests(input: {
  usePairedWorkspace?: boolean;
  workspace: PairedConfigurationWorkspace;
  testId: string;
  appMapId: string;
  targetId: string;
  targetProfileId?: string;
  sourceRevision?: ProductRunStartInput["sourceRevision"];
  startup?: ProductRunStartInput["startup"];
}): ProductRunStartInput[] {
  if (input.usePairedWorkspace) {
    return compileTestStarts({
      testId: input.testId,
      appMapId: input.appMapId,
      workspace: input.workspace,
      sourceRevision: input.sourceRevision,
      startup: input.startup,
    });
  }
  return [
    {
      testId: input.testId,
      appMapId: input.appMapId,
      targetId: input.targetId,
      ...(input.targetProfileId ? { targetProfileId: input.targetProfileId } : {}),
      ...(input.sourceRevision ? { sourceRevision: input.sourceRevision } : {}),
      ...(input.startup ? { startup: input.startup } : {}),
    },
  ];
}

export async function startOwnedTestRun(input: {
  requests: readonly ProductRunStartInput[];
  start: (request: ProductRunStartInput) => Promise<ProductRunState>;
  inspect: (workflowId: string) => Promise<ProductRunState>;
  remember: (state: ProductRunState, workflowId: string, runId: string) => Promise<void>;
}): Promise<ProductRunState> {
  const first = input.requests[0];
  if (!first) throw new TypeError("Save at least one Browser and Account pair.");
  const started = await input.start(first);
  for (const request of input.requests.slice(1)) await input.start(request);
  const workflowId = started.workflow?.workflowId;
  if (!workflowId) {
    if (started.recovery) return started;
    throw new TypeError("Relay could not start this Run.");
  }
  const canonical = await input.inspect(workflowId);
  const runId = canonical.run?.runId ?? started.run?.runId;
  if (!runId) {
    if (canonical.recovery) return canonical;
    throw new TypeError("Relay could not open the new Run.");
  }
  const durable = canonical.run?.runId ? canonical : { ...canonical, run: started.run };
  await input.remember(durable, workflowId, runId);
  return durable;
}
