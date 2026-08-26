import type { Accessor } from "solid-js";
import type { RelayClient } from "@relay/client";
import type {
  DiscoveryControl,
  DiscoveryCoverageReport,
  DiscoveryDecisionProvenance,
  DiscoveryExplorationTimeline,
  DiscoverySession,
  OperationInput,
} from "@relay/protocol";
import {
  approveDiscoverySuggestion as approveDiscoverySuggestionRemote,
  backtrackDiscovery as backtrackDiscoveryRemote,
  captureDiscoveryScreen,
  cancelDiscoveryExplore,
  createDiscoverySession,
  discoveryScreenUrl as buildDiscoveryScreenUrl,
  getDiscoveryCoverage,
  getDiscoveryExplorationTimeline,
  getDiscoverySuggestion,
  listDiscoverySessions,
  renameDiscoverySession,
  setDiscoveryStatus,
  startDiscoveryExplore,
  type DiscoveryApprovalOutcome,
  type DiscoveryBacktrackOutcome,
} from "./server-discovery-remote";

type DiscoveryControllerDependencies = {
  client: () => Promise<RelayClient>;
  health: Accessor<string>;
  serverUrl: Accessor<string>;
  discoverySessions: Accessor<DiscoverySession[]>;
  setDiscoverySessions: (sessions: DiscoverySession[]) => void;
  activeDiscoverySessionId: Accessor<string | null>;
  setActiveDiscoverySessionId: (id: string | null) => void;
};

export function createServerDiscoveryController(deps: DiscoveryControllerDependencies) {
  async function refreshDiscoverySessions(): Promise<void> {
    if (deps.health() === "offline") return;
    const data = await listDiscoverySessions(await deps.client());
    deps.setDiscoverySessions(data.sessions ?? []);
    if (
      deps.activeDiscoverySessionId() &&
      !data.sessions.some((session) => session.id === deps.activeDiscoverySessionId())
    ) {
      deps.setActiveDiscoverySessionId(null);
    }
  }

  async function createDiscoverySessionRemote(
    input: OperationInput<"discovery.create">,
  ): Promise<DiscoverySession> {
    const session = await createDiscoverySession(await deps.client(), input);
    await refreshDiscoverySessions();
    deps.setActiveDiscoverySessionId(session.id);
    return session;
  }

  async function setDiscoveryStatusRemote(
    id: string,
    status: DiscoverySession["status"],
  ): Promise<DiscoverySession> {
    const session = await setDiscoveryStatus(await deps.client(), id, status);
    await refreshDiscoverySessions();
    if (status === "running") deps.setActiveDiscoverySessionId(session.id);
    else if (deps.activeDiscoverySessionId() === session.id) deps.setActiveDiscoverySessionId(null);
    return session;
  }

  async function renameDiscoverySessionRemote(id: string, name: string): Promise<DiscoverySession> {
    const session = await renameDiscoverySession(await deps.client(), id, name);
    await refreshDiscoverySessions();
    return session;
  }

  async function captureDiscoveryScreenRemote(id: string): Promise<DiscoverySession> {
    const session = await captureDiscoveryScreen(await deps.client(), id);
    await refreshDiscoverySessions();
    return session;
  }

  function discoveryScreenUrl(sessionId: string, screenId: string): string {
    return buildDiscoveryScreenUrl(deps.serverUrl(), sessionId, screenId);
  }

  async function startDiscoveryExploreRemote(id: string): Promise<DiscoverySession> {
    const session = await startDiscoveryExplore(await deps.client(), id);
    await refreshDiscoverySessions();
    deps.setActiveDiscoverySessionId(session.id);
    return session;
  }

  async function cancelDiscoveryExploreRemote(id: string): Promise<DiscoverySession> {
    const session = await cancelDiscoveryExplore(await deps.client(), id);
    await refreshDiscoverySessions();
    if (deps.activeDiscoverySessionId() === session.id) deps.setActiveDiscoverySessionId(null);
    return session;
  }

  async function discoverySuggestion(id: string): Promise<{
    screenId: string;
    control: DiscoveryControl;
  } | null> {
    return getDiscoverySuggestion(await deps.client(), id);
  }

  async function loadDiscoveryCoverage(id: string): Promise<DiscoveryCoverageReport> {
    return getDiscoveryCoverage(await deps.client(), id);
  }

  async function loadDiscoveryExplorationTimeline(
    id: string,
  ): Promise<DiscoveryExplorationTimeline> {
    return getDiscoveryExplorationTimeline(await deps.client(), id);
  }

  async function approveDiscoverySuggestion(input: {
    sessionId: string;
    control: DiscoveryControl;
    decision?: DiscoveryDecisionProvenance;
  }): Promise<DiscoveryApprovalOutcome> {
    const outcome = await approveDiscoverySuggestionRemote(await deps.client(), input);
    if (outcome.status === "ios-outcome-unknown") {
      // The returned review pointer is sufficient even if a background list
      // refresh is unavailable. Do not let a read failure hide the explicit
      // one-command stop or tempt a caller to send the action again.
      void refreshDiscoverySessions().catch(() => undefined);
      return outcome;
    }
    await refreshDiscoverySessions();
    return outcome;
  }

  async function backtrackDiscovery(id: string): Promise<DiscoveryBacktrackOutcome> {
    const outcome = await backtrackDiscoveryRemote(await deps.client(), id);
    if (outcome.status === "ios-outcome-unknown") {
      void refreshDiscoverySessions().catch(() => undefined);
      return outcome;
    }
    await refreshDiscoverySessions();
    return outcome;
  }

  return {
    refreshDiscoverySessions,
    createDiscoverySession: createDiscoverySessionRemote,
    setDiscoveryStatus: setDiscoveryStatusRemote,
    renameDiscoverySession: renameDiscoverySessionRemote,
    captureDiscoveryScreen: captureDiscoveryScreenRemote,
    startDiscoveryExplore: startDiscoveryExploreRemote,
    cancelDiscoveryExplore: cancelDiscoveryExploreRemote,
    discoveryScreenUrl,
    discoverySuggestion,
    loadDiscoveryCoverage,
    loadDiscoveryExplorationTimeline,
    approveDiscoverySuggestion,
    backtrackDiscovery,
  };
}
