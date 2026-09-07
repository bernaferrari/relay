import type { ProductRunStartInput, ProductRunState } from "@relay/product/run-journey";
import {
  compileTestStarts,
  type BoundExecutionIdentity,
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
  status: "started" | "blocked" | "untouched" | "mismatched";
  state?: ProductRunState;
};

export type OwnedTestRunResult = ProductRunState & {
  children: OwnedTestStartChild[];
  batchId?: string;
};

export type CombineProfileTarget = {
  profileId: string;
  targetProfileId: string;
  engine: BoundExecutionIdentity["engine"];
  account: BoundExecutionIdentity["account"];
  target: {
    targetKind: "browser";
    browserTargetId: string;
  };
};

export type CombineStartBody = {
  appMapId: string;
  testId: string;
  executionMode: "all";
  profileTargets: CombineProfileTarget[];
  sourceRevision?: ProductRunStartInput["sourceRevision"];
};

export type CombineCampaignCaseMatch = {
  cellId?: string;
  executionCaseId?: string;
  status?: string;
  targetProfileId?: string;
  runId?: string;
  engine?: BoundExecutionIdentity["engine"];
  account?: BoundExecutionIdentity["account"];
  target?: { targetId?: string };
  sourceRevision?: ProductRunStartInput["sourceRevision"];
};

export type CombineStartResult = {
  campaign?: {
    id?: string;
    cases?: readonly CombineCampaignCaseMatch[];
  };
  batch?: { id?: string };
};

export function boundExecutionIdentity(request: ProductRunStartInput): BoundExecutionIdentity {
  const targetId = request.targetId?.trim();
  if (!targetId) throw new TypeError("Each pair needs a Browser.");
  if (!request.engine) throw new TypeError("Each pair needs a browser engine.");
  if (!request.account) {
    throw new TypeError("Each pair needs an account fixture or attested signed-out state.");
  }
  return {
    targetId,
    engine: request.engine,
    account: request.account,
    ...(request.targetProfileId?.trim() ? { targetProfileId: request.targetProfileId.trim() } : {}),
  };
}

/** Pass the compiled identity through. Do not pick optional fields. */
export function profileTargetsFromStarts(
  requests: readonly ProductRunStartInput[],
): CombineProfileTarget[] {
  return requests.map((request) => {
    const identity = boundExecutionIdentity(request);
    const profileId = identity.targetProfileId;
    if (!profileId) {
      throw new TypeError(
        "Each Browser and Account pair needs a saved profile before Relay can start one Batch.",
      );
    }
    return {
      profileId,
      targetProfileId: profileId,
      engine: identity.engine,
      account: identity.account,
      target: { targetKind: "browser", browserTargetId: identity.targetId },
    };
  });
}

function childStatusFromCase(status: string | undefined): OwnedTestStartChild["status"] {
  if (!status) return "untouched";
  if (status === "blocked" || status === "failed") return "blocked";
  if (status === "pending") return "untouched";
  return "started";
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function executionCellIdentity(input: {
  targetId?: string;
  engine?: BoundExecutionIdentity["engine"];
  account?: BoundExecutionIdentity["account"];
  sourceRevision?: ProductRunStartInput["sourceRevision"];
}): string {
  return canonicalJson({
    targetId: input.targetId ?? "",
    engine: input.engine ?? "",
    account: input.account ?? null,
    sourceRevision: input.sourceRevision ?? null,
  });
}

/** Complete returned identity only. Omitted account/engine is not a wildcard. */
export function campaignCaseMatchesRequest(
  item: CombineCampaignCaseMatch,
  request: ProductRunStartInput,
): boolean {
  const targetId = item.target?.targetId?.trim();
  if (!targetId || targetId !== request.targetId) return false;
  if (!item.engine || !item.account) return false;
  if (item.engine !== request.engine) return false;
  if (canonicalJson(item.account) !== canonicalJson(request.account ?? null)) return false;
  if (
    item.sourceRevision &&
    canonicalJson(item.sourceRevision) !== canonicalJson(request.sourceRevision ?? null)
  ) {
    return false;
  }
  return true;
}

export function pairedBatchFields(requests: readonly ProductRunStartInput[]): {
  sourceRevision?: ProductRunStartInput["sourceRevision"];
} {
  if (requests.some((request) => request.startup)) {
    throw new TypeError(
      "This Batch cannot represent a starting state. Run those pairs as separate Tests.",
    );
  }
  const revisions = new Set(
    requests.map((request) => JSON.stringify(request.sourceRevision ?? null)),
  );
  if (revisions.size > 1) {
    throw new TypeError("Every pair in this Batch must use the same build.");
  }
  const sourceRevision = requests[0]?.sourceRevision;
  return sourceRevision ? { sourceRevision } : {};
}

/** One Combine campaign owns every compiled pair. Do not start children locally. */
export async function startPairedTestBatch(input: {
  requests: readonly ProductRunStartInput[];
  combineStart: (body: CombineStartBody) => Promise<CombineStartResult>;
}): Promise<OwnedTestRunResult> {
  const first = input.requests[0];
  if (!first?.appMapId) throw new TypeError("Save at least one Browser and Account pair.");
  const profileTargets = profileTargetsFromStarts(input.requests);
  const fields = pairedBatchFields(input.requests);
  const started = await input.combineStart({
    appMapId: first.appMapId,
    testId: first.testId,
    executionMode: "all",
    profileTargets,
    ...fields,
  });
  const batchId = started.campaign?.id ?? started.batch?.id;
  if (!batchId) throw new TypeError("Relay did not create a durable Batch for these pairs.");
  const cases = started.campaign?.cases ?? [];
  const executionCaseCounts = new Map<string, number>();
  for (const item of cases) {
    const id = item.executionCaseId?.trim();
    if (!id) continue;
    executionCaseCounts.set(id, (executionCaseCounts.get(id) ?? 0) + 1);
  }
  const unused = cases.filter((item) => {
    const id = item.executionCaseId?.trim();
    return !id || executionCaseCounts.get(id) === 1;
  });
  const children: OwnedTestStartChild[] = input.requests.map((request) => {
    const matchIndex = unused.findIndex((item) => campaignCaseMatchesRequest(item, request));
    const item = matchIndex >= 0 ? unused.splice(matchIndex, 1)[0] : undefined;
    if (!item) {
      return {
        request,
        status: "mismatched",
        state: {
          status: "idle",
          recovery: {
            code: "transport",
            title: "This pair has no matching Batch cell",
            detail: "Relay did not return a child for this exact Browser, account, and engine.",
            recovery: "Inspect the Batch. Do not treat another pair's result as this one.",
            retryable: true,
          },
        },
      };
    }
    const status = childStatusFromCase(item.status);
    return {
      request,
      status,
      ...(item.runId
        ? { state: { status: "queued", run: { jobId: item.runId, runId: item.runId } } }
        : {}),
    };
  });
  if (!cases.length) {
    return {
      status: "idle",
      batchId,
      recovery: {
        code: "transport",
        title: "The Batch has no scheduled cells",
        detail: "Relay created a Batch without scheduled children for these pairs.",
        recovery: "Inspect the Batch before treating any pair as started.",
        retryable: true,
      },
      children: input.requests.map((request) => ({ request, status: "untouched" as const })),
    };
  }
  return { status: "queued", batchId, children };
}

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
  startBatch?: (requests: readonly ProductRunStartInput[]) => Promise<OwnedTestRunResult>;
}): Promise<OwnedTestRunResult> {
  const requests = input.requests;
  if (!requests.length) throw new TypeError("Save at least one Browser and Account pair.");
  if (requests.length > 1) {
    if (!input.startBatch) {
      throw new TypeError("Multiple Browser and Account pairs need one durable Batch.");
    }
    return input.startBatch(requests);
  }
  const started = await input.start(requests[0]!);
  if (started.recovery) {
    return { ...started, children: [{ request: requests[0]!, status: "blocked", state: started }] };
  }
  const durable = await adoptStartedChild({
    started,
    inspect: input.inspect,
    remember: input.remember,
  });
  if (durable.recovery) {
    return { ...durable, children: [{ request: requests[0]!, status: "blocked", state: durable }] };
  }
  return { ...durable, children: [{ request: requests[0]!, status: "started", state: durable }] };
}
