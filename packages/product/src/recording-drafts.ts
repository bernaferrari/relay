import { createRelayOperationPort, type RelayInvokeClient } from "@relay/workflows/operation-port";

/** A saved review of canonical recording evidence, not an approved Test. */
export type ProductRecordingDraft = {
  workflowId: string;
  appMapId: string;
  name: string;
  stepCount: number;
  updatedAt: number;
};

/** Discover reviews independently of a renderer's single active pointer. Each
 * link is checked against its durable workflow; a session ID is never a route
 * handle. Reads do not adopt a journey or change its current recording. */
export async function listProductRecordingDrafts(input: {
  client: RelayInvokeClient;
  actorId: string;
}): Promise<readonly ProductRecordingDraft[]> {
  const operations = createRelayOperationPort(input.client);
  const { sessions } = await operations.invoke("authoring.session.list", {
    includeHistory: true,
    latestRevisionOnly: true,
  });
  const candidates = sessions.filter(
    (session) =>
      session.actorId === input.actorId &&
      session.state === "reviewing" &&
      !session.archive &&
      session.workflowMutation,
  );
  const drafts: ProductRecordingDraft[] = [];
  let next = 0;
  // Bound concurrent canonical reads even when a workspace has many reviews.
  await Promise.all(
    Array.from({ length: Math.min(4, candidates.length) }, async () => {
      for (;;) {
        const session = candidates[next++];
        if (!session) return;
        const workflowId = session.workflowMutation!.workflowId;
        const { workflow } = await operations.invoke("workflow.get", { workflowId });
        const record = workflow.record;
        if (record.createdBy !== input.actorId && record.lastActorId !== input.actorId) continue;
        if (
          record.kind !== "author-test" ||
          record.workflowId !== workflowId ||
          record.resource?.kind !== "authoring-session" ||
          record.resource.id !== session.id
        )
          throw new Error("A saved recording could not be matched to its review.");
        if (record.status === "terminal" || record.status === "expired") continue;
        const revision = session.take?.revisions.find(
          (revision) => revision.revision === session.take?.currentRevision,
        );
        drafts.push({
          workflowId,
          appMapId: session.appMapId,
          name: session.testName?.trim() || "Untitled recording",
          stepCount: revision?.actions.length ?? 0,
          updatedAt: session.updatedAt,
        });
      }
    }),
  );
  return drafts.sort(
    (left, right) =>
      right.updatedAt - left.updatedAt || left.workflowId.localeCompare(right.workflowId),
  );
}
