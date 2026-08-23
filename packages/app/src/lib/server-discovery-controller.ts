import type { Accessor } from "solid-js";
import type {
  DiscoveryAgentContext,
  DiscoveryControl,
  DiscoveryCoverageReport,
  DiscoveryDecisionProvenance,
  DiscoveryJourney,
  DiscoveryScope,
  DiscoverySession,
} from "@relay/protocol";
import { toast } from "../context/toast";
import type { ServerRequest } from "./server-matrix-remote";
import {
  approveDiscoverySuggestion as approveDiscoverySuggestionRemote,
  backtrackDiscovery as backtrackDiscoveryRemote,
  captureDiscoveryScreen,
  cancelDiscoveryExplore,
  createDiscoverySession,
  discoveryScreenUrl as buildDiscoveryScreenUrl,
  getDiscoveryCoverage,
  getDiscoveryJourney,
  getDiscoverySuggestion,
  listDiscoverySessions,
  renameDiscoverySession,
  setDiscoveryStatus,
  startDiscoveryExplore,
  type DiscoveryApprovalOutcome,
  type DiscoveryBacktrackOutcome,
} from "./server-discovery-remote";

type DiscoveryControllerDependencies = {
  request: ServerRequest;
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
    const data = await listDiscoverySessions(deps.request);
    deps.setDiscoverySessions(data.sessions ?? []);
    if (
      deps.activeDiscoverySessionId() &&
      !data.sessions.some((session) => session.id === deps.activeDiscoverySessionId())
    ) {
      deps.setActiveDiscoverySessionId(null);
    }
  }

  async function createDiscoverySessionRemote(input: {
    name: string;
    targetId: string;
    scope?: Partial<DiscoveryScope>;
    agent?: Omit<DiscoveryAgentContext, "createdBy">;
  }): Promise<DiscoverySession> {
    const session = await createDiscoverySession(deps.request, input);
    await refreshDiscoverySessions();
    deps.setActiveDiscoverySessionId(session.id);
    return session;
  }

  async function setDiscoveryStatusRemote(
    id: string,
    status: DiscoverySession["status"],
  ): Promise<DiscoverySession> {
    const session = await setDiscoveryStatus(deps.request, id, status);
    await refreshDiscoverySessions();
    if (status === "running") deps.setActiveDiscoverySessionId(session.id);
    else if (deps.activeDiscoverySessionId() === session.id) deps.setActiveDiscoverySessionId(null);
    return session;
  }

  async function renameDiscoverySessionRemote(id: string, name: string): Promise<DiscoverySession> {
    const session = await renameDiscoverySession(deps.request, id, name);
    await refreshDiscoverySessions();
    return session;
  }

  async function captureDiscoveryScreenRemote(id: string): Promise<DiscoverySession> {
    const session = await captureDiscoveryScreen(deps.request, id);
    await refreshDiscoverySessions();
    return session;
  }

  function discoveryScreenUrl(sessionId: string, screenId: string): string {
    return buildDiscoveryScreenUrl(deps.serverUrl(), sessionId, screenId);
  }

  async function startDiscoveryExploreRemote(id: string): Promise<DiscoverySession> {
    const session = await startDiscoveryExplore(deps.request, id);
    await refreshDiscoverySessions();
    deps.setActiveDiscoverySessionId(session.id);
    return session;
  }

  async function cancelDiscoveryExploreRemote(id: string): Promise<DiscoverySession> {
    const session = await cancelDiscoveryExplore(deps.request, id);
    await refreshDiscoverySessions();
    if (deps.activeDiscoverySessionId() === session.id) deps.setActiveDiscoverySessionId(null);
    return session;
  }

  async function discoverySuggestion(id: string): Promise<{
    screenId: string;
    control: DiscoveryControl;
  } | null> {
    return getDiscoverySuggestion(deps.request, id);
  }

  async function loadDiscoveryCoverage(id: string): Promise<DiscoveryCoverageReport> {
    return getDiscoveryCoverage(deps.request, id);
  }

  async function loadDiscoveryJourney(id: string): Promise<DiscoveryJourney> {
    return getDiscoveryJourney(deps.request, id);
  }

  async function approveDiscoverySuggestion(input: {
    sessionId: string;
    control: DiscoveryControl;
    decision?: DiscoveryDecisionProvenance;
  }): Promise<DiscoveryApprovalOutcome> {
    const outcome = await approveDiscoverySuggestionRemote(deps.request, input);
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
    const outcome = await backtrackDiscoveryRemote(deps.request, id);
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
    loadDiscoveryJourney,
    approveDiscoverySuggestion,
    backtrackDiscovery,
  };
}
