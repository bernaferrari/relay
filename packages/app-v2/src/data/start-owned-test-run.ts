import type { ProductRunStartInput, ProductRunState } from "@relay/product/run-journey";
import {
  compileTestStarts,
  type PairedConfigurationWorkspace,
  type PairedStartProfile,
} from "./paired-configuration";

export function testStartRequests(input: {
  usePairedWorkspace?: boolean;
  workspace: PairedConfigurationWorkspace;
  testId: string;
  appMapId: string;
  targetId: string;
  targetProfileId?: string;
  sourceRevision?: ProductRunStartInput["sourceRevision"];
  startup?: ProductRunStartInput["startup"];
  profiles?: readonly PairedStartProfile[];
}): ProductRunStartInput[] {
  if (input.usePairedWorkspace) {
    return compileTestStarts({
      testId: input.testId,
      appMapId: input.appMapId,
      workspace: input.workspace,
      sourceRevision: input.sourceRevision,
      startup: input.startup,
      profiles: input.profiles,
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

export type OwnedTestStartChild = {
  request: ProductRunStartInput;
  status: "started" | "blocked" | "untouched";
  state?: ProductRunState;
};

export type OwnedTestRunResult = ProductRunState & {
  children: OwnedTestStartChild[];
};

async function adoptStartedChild(input: {
  started: ProductRunState;
  inspect: (workflowId: string) => Promise<ProductRunState>;
  remember: (state: ProductRunState, workflowId: string, runId: string) => Promise<void>;
}): Promise<ProductRunState> {
  const workflowId = input.started.workflow?.workflowId;
  if (!workflowId) {
    if (input.started.recovery) return input.started;
    throw new TypeError("Relay could not start this Run.");
  }
  const canonical = await input.inspect(workflowId);
  const runId = canonical.run?.runId ?? input.started.run?.runId;
  if (!runId) {
    if (canonical.recovery) return canonical;
    throw new TypeError("Relay could not open the new Run.");
  }
  const durable = canonical.run?.runId ? canonical : { ...canonical, run: input.started.run };
  await input.remember(durable, workflowId, runId);
  return durable;
}

export async function startOwnedTestRun(input: {
  requests: readonly ProductRunStartInput[];
  start: (request: ProductRunStartInput) => Promise<ProductRunState>;
  inspect: (workflowId: string) => Promise<ProductRunState>;
  remember: (state: ProductRunState, workflowId: string, runId: string) => Promise<void>;
}): Promise<OwnedTestRunResult> {
  const requests = input.requests;
  if (!requests.length) throw new TypeError("Save at least one Browser and Account pair.");
  const children: OwnedTestStartChild[] = requests.map((request) => ({
    request,
    status: "untouched",
  }));
  const firstStarted = await input.start(requests[0]!);
  if (firstStarted.recovery) {
    children[0] = { request: requests[0]!, status: "blocked", state: firstStarted };
    return { ...firstStarted, children };
  }
  const first = await adoptStartedChild({
    started: firstStarted,
    inspect: input.inspect,
    remember: input.remember,
  });
  if (first.recovery) {
    children[0] = { request: requests[0]!, status: "blocked", state: first };
    return { ...first, children };
  }
  children[0] = { request: requests[0]!, status: "started", state: first };
  for (let index = 1; index < requests.length; index += 1) {
    const request = requests[index]!;
    const started = await input.start(request);
    if (started.recovery) {
      children[index] = { request, status: "blocked", state: started };
      continue;
    }
    children[index] = {
      request,
      status: "started",
      state: await adoptStartedChild({
        started,
        inspect: input.inspect,
        remember: input.remember,
      }),
    };
  }
  return { ...first, children };
}
