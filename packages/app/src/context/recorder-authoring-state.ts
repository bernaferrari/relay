import { createEffect, createMemo, createSignal, type Accessor } from "solid-js";
import type { AuthorTestSnapshot } from "@relay/workflows";
import type { createAuthorTestWorkflowCoordinator } from "../lib/author-test-workflow-coordinator";
import type { useServer } from "./server";
import {
  authoringWorkflowNeedsAttention,
  projectTake,
  projectedRecordingIssue,
  selectProjectedAuthoringSession,
} from "./recorder-projection";

export function createRecorderAuthoringState(input: {
  server: ReturnType<typeof useServer>;
  workflow: ReturnType<typeof createAuthorTestWorkflowCoordinator>;
  workflowSnapshot: Accessor<AuthorTestSnapshot | undefined>;
  localArming: Accessor<boolean>;
  pendingGroup: Accessor<string>;
}) {
  const activeSession = createMemo(() =>
    selectProjectedAuthoringSession(input.server.authoringSessions(), {
      appMapId: input.server.selectedAppMapId(),
      targetId: input.server.selectedDevice(),
      actorId: input.server.actorId(),
    }),
  );
  const [restoring, setRestoring] = createSignal(false);
  let hydrationToken = 0;
  let hydratedSessionId: string | undefined;
  createEffect(() => {
    const sessionId = activeSession()?.id;
    const token = ++hydrationToken;
    if (!sessionId) {
      hydratedSessionId = undefined;
      setRestoring(false);
      return;
    }
    if (sessionId === hydratedSessionId) return;
    hydratedSessionId = sessionId;
    setRestoring(true);
    void input.workflow
      .hydrate(sessionId)
      .catch(() => undefined)
      .finally(() => {
        if (token === hydrationToken) setRestoring(false);
      });
  });
  const needsAttention = createMemo(() =>
    authoringWorkflowNeedsAttention(activeSession(), input.workflowSnapshot()),
  );
  return {
    activeSession,
    ownsActiveSession: () => activeSession()?.actorId === input.server.actorId(),
    take: createMemo(() => {
      const session = activeSession();
      return session ? projectTake(session, input.server.authoringEvidenceUrl) : null;
    }),
    needsAttention,
    restoring,
    recording: createMemo(
      () => activeSession()?.state === "recording" && !restoring() && !needsAttention(),
    ),
    arming: createMemo(
      () => input.localArming() || restoring() || activeSession()?.state === "preparing",
    ),
    issue: createMemo(() => projectedRecordingIssue(activeSession(), input.workflowSnapshot())),
    group: createMemo(() => activeSession()?.group ?? input.pendingGroup()),
  };
}
