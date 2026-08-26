import { createSignal, type Accessor } from "solid-js";
import type {
  AppMap,
  AuthoringCommitDestination,
  AuthoringInteraction,
  AuthoringSession,
} from "@relay/protocol";
import type { RelayClient } from "@relay/client";
import { mergeAuthoringSessionProjections } from "./authoring-session-projection";

export function createServerAuthoringController(input: {
  client: () => Promise<RelayClient>;
  serverUrl: Accessor<string>;
  selectedAppMapId: Accessor<string | null>;
  selectedDevice: Accessor<string | null>;
  refreshAppMaps: () => Promise<AppMap[]>;
}) {
  const [authoringSessions, setAuthoringSessions] = createSignal<AuthoringSession[]>([]);
  let projectionVersion = 0;
  let refreshVersion = 0;

  function project(session: AuthoringSession): AuthoringSession {
    projectionVersion += 1;
    setAuthoringSessions((current) => [
      session,
      ...current.filter((item) => item.id !== session.id),
    ]);
    return session;
  }

  async function refreshAuthoringSessions(): Promise<AuthoringSession[]> {
    const client = await input.client();
    const currentRefreshVersion = ++refreshVersion;
    const currentProjectionVersion = projectionVersion;
    // The archive contains immutable screenshots and accessibility trees. The
    // live workspace only needs open sessions for its current document and
    // target; downloading the complete archive made Record parse megabytes of
    // unrelated evidence.
    const result = await client.invoke("authoring.session.list", {
      activeOnly: true,
      ...(input.selectedAppMapId() ? { appMapId: input.selectedAppMapId()! } : {}),
      ...(input.selectedDevice() ? { targetId: input.selectedDevice()! } : {}),
    });
    if (currentRefreshVersion !== refreshVersion) return result.sessions;
    setAuthoringSessions((current) =>
      currentProjectionVersion === projectionVersion
        ? result.sessions
        : mergeAuthoringSessionProjections(current, result.sessions),
    );
    return result.sessions;
  }

  async function createAuthoringSession(inputValue: {
    appMapId: string;
    target:
      | { kind: "device"; platform: "android" | "ios"; targetId: string }
      | { kind: "browser"; platform: "browser"; targetId: string };
    leaseId: string;
    expectedAppMapRevision: number;
    sourceScreenId?: string;
    pendingConnectionId?: string;
    group?: string;
  }): Promise<AuthoringSession> {
    return project(
      (await (await input.client()).invoke("authoring.session.create", inputValue)).session,
    );
  }

  async function observeAuthoringSession(id: string): Promise<AuthoringSession> {
    return project(
      (
        await (
          await input.client()
        ).invoke(
          "authoring.session.observe",
          { sessionId: id },
          {
            signal: AbortSignal.timeout(120_000),
          },
        )
      ).session,
    );
  }

  async function captureAuthoringScreen(id: string): Promise<AuthoringSession> {
    return project(
      (
        await (
          await input.client()
        ).invoke(
          "authoring.session.capture",
          { sessionId: id },
          {
            signal: AbortSignal.timeout(120_000),
          },
        )
      ).session,
    );
  }

  async function startAuthoringSession(id: string): Promise<AuthoringSession> {
    return project(
      (
        await (
          await input.client()
        ).invoke(
          "authoring.session.start",
          { sessionId: id },
          {
            signal: AbortSignal.timeout(120_000),
          },
        )
      ).session,
    );
  }

  async function interactAuthoringSession(
    id: string,
    interaction: AuthoringInteraction,
  ): Promise<AuthoringSession> {
    return project(
      (
        await (
          await input.client()
        ).invoke("authoring.session.interact", { sessionId: id, interaction })
      ).session,
    );
  }

  async function stopAuthoringSession(id: string): Promise<AuthoringSession> {
    return project(
      (
        await (
          await input.client()
        ).invoke(
          "authoring.session.stop",
          { sessionId: id },
          {
            signal: AbortSignal.timeout(120_000),
          },
        )
      ).session,
    );
  }

  async function trimAuthoringTake(
    id: string,
    inputValue: { fromMs?: number; toMs?: number; actionIds?: string[] },
  ): Promise<AuthoringSession> {
    return project(
      (await (await input.client()).invoke("authoring.take.trim", { sessionId: id, ...inputValue }))
        .session,
    );
  }

  async function reorderAuthoringTake(id: string, actionIds: string[]): Promise<AuthoringSession> {
    return project(
      (await (await input.client()).invoke("authoring.take.reorder", { sessionId: id, actionIds }))
        .session,
    );
  }

  async function replaceAuthoringAction(
    id: string,
    actionId: string,
    interaction: AuthoringInteraction,
  ): Promise<AuthoringSession> {
    return project(
      (
        await (
          await input.client()
        ).invoke("authoring.take.replace", {
          sessionId: id,
          actionId,
          interaction,
        })
      ).session,
    );
  }

  async function replayAuthoringTake(id: string): Promise<AuthoringSession> {
    // Attached Apple hardware may serialize action, snapshot, and screenshot
    // evidence through one runner, so replay uses the honest long-operation
    // budget shared by observation and Stop.
    return project(
      (
        await (
          await input.client()
        ).invoke(
          "authoring.take.replay",
          { sessionId: id },
          {
            signal: AbortSignal.timeout(120_000),
          },
        )
      ).session,
    );
  }

  async function commitAuthoringSession(
    id: string,
    inputValue: { destination?: AuthoringCommitDestination },
  ): Promise<AuthoringSession> {
    const session = project(
      (
        await (
          await input.client()
        ).invoke("authoring.session.commit", {
          sessionId: id,
          ...inputValue,
        })
      ).session,
    );
    await input.refreshAppMaps();
    return session;
  }

  function projectTerminalSession(session: AuthoringSession): AuthoringSession {
    project(session);
    setAuthoringSessions((current) => {
      const without = current.filter((item) => item.id !== session.id);
      return [...without, session].sort((left, right) => right.updatedAt - left.updatedAt);
    });
    return session;
  }

  async function discardAuthoringSession(id: string): Promise<AuthoringSession> {
    return projectTerminalSession(
      (await (await input.client()).invoke("authoring.session.discard", { sessionId: id })).session,
    );
  }

  async function cancelAuthoringSession(id: string): Promise<AuthoringSession> {
    return projectTerminalSession(
      (await (await input.client()).invoke("authoring.session.cancel", { sessionId: id })).session,
    );
  }

  function authoringEvidenceUrl(uri: string, mime?: string): string {
    const sha256 = uri.match(/^relay-evidence:\/\/([a-f0-9]{64})$/)?.[1];
    if (!sha256) return "";
    const query = mime ? `?mime=${encodeURIComponent(mime)}` : "";
    return `${input.serverUrl()}/authoring-evidence/${sha256}${query}`;
  }

  return {
    authoringSessions,
    refreshAuthoringSessions,
    createAuthoringSession,
    observeAuthoringSession,
    captureAuthoringScreen,
    startAuthoringSession,
    interactAuthoringSession,
    stopAuthoringSession,
    trimAuthoringTake,
    reorderAuthoringTake,
    replaceAuthoringAction,
    replayAuthoringTake,
    commitAuthoringSession,
    discardAuthoringSession,
    cancelAuthoringSession,
    authoringEvidenceUrl,
  };
}
