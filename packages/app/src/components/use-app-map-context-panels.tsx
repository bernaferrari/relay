import type { AppMap } from "@relay/protocol";
import { createMemo, Show, type Accessor, type Setter } from "solid-js";
import { useRecipeDraft } from "../context/recipe-draft";
import { useServer } from "../context/server";
import { useAppMapAgentExploration } from "../lib/use-app-map-agent-exploration";
import { useAppMapProposalReview } from "../lib/use-app-map-proposal-review";
import { AppMapAgentPanel } from "./app-map-agent-panel";
import { AppMapHistoryPanel } from "./app-map-history-panel";
import { AppMapProposalReview } from "./app-map-proposal-review";

type ContextSurface = "agent" | "history" | "proposals" | null;

/** Owns mutually-exclusive App Map drawers and their long-lived async state. */
export function useAppMapContextPanels(options: {
  activeAppMap: Accessor<AppMap | undefined>;
  surface: Accessor<ContextSurface>;
  setSurface: Setter<ContextSurface>;
  openDevicePicker: () => void;
}) {
  const server = useServer();
  const draft = useRecipeDraft();
  const surfaceOpen = (candidate: Exclude<ContextSurface, null>) => options.surface() === candidate;
  const setSurfaceOpen = (candidate: Exclude<ContextSurface, null>, open: boolean) =>
    options.setSurface((current) => (open ? candidate : current === candidate ? null : current));
  const agentOpen = () => surfaceOpen("agent");
  const historyOpen = () => surfaceOpen("history");
  const proposalReviewOpen = () => surfaceOpen("proposals");
  const setAgentOpen = (open: boolean) => setSurfaceOpen("agent", open);
  const setHistoryOpen = (open: boolean) => setSurfaceOpen("history", open);
  const setProposalReviewOpen = (open: boolean) => setSurfaceOpen("proposals", open);

  // Closing the drawer only hides exploration; it must not cancel a long run.
  const exploration = useAppMapAgentExploration(options.activeAppMap);
  const { proposalBusyId, proposalError, decideProposal } = useAppMapProposalReview(
    options.activeAppMap,
  );
  const pendingProposals = createMemo(() =>
    Object.values(options.activeAppMap()?.proposals ?? {})
      .filter((proposal) => proposal.status === "pending")
      .sort((left, right) => left.createdAt - right.createdAt),
  );

  const Panels = () => (
    <>
      <Show when={proposalReviewOpen() && options.activeAppMap()}>
        {(appMap) => (
          <AppMapProposalReview
            appMap={appMap()}
            proposals={pendingProposals()}
            busyId={proposalBusyId()}
            error={proposalError()}
            evidenceUrl={(uri) => server.authoringEvidenceUrl(uri, "image/png")}
            onApprove={(proposalId) => void decideProposal(proposalId, "approve")}
            onReject={(proposalId) => void decideProposal(proposalId, "reject")}
            onRequestChanges={(proposalId, reason) =>
              void decideProposal(proposalId, "reject", reason)
            }
            onClose={() => setProposalReviewOpen(false)}
          />
        )}
      </Show>
      <Show when={agentOpen() && options.activeAppMap()}>
        <AppMapAgentPanel
          exploration={exploration}
          onOpenTargets={() => {
            setAgentOpen(false);
            options.openDevicePicker();
          }}
          onClose={() => {
            setAgentOpen(false);
            queueMicrotask(() =>
              document.querySelector<HTMLButtonElement>('[aria-label="Map with AI"]')?.focus(),
            );
          }}
          onProposalReady={() => {
            setAgentOpen(false);
            setProposalReviewOpen(true);
          }}
          keepBusyId={proposalBusyId()}
          onKeep={(proposalId) => void decideProposal(proposalId, "approve")}
          onSkip={(proposalId) => void decideProposal(proposalId, "reject")}
        />
      </Show>
      <Show when={historyOpen()}>
        <AppMapHistoryPanel
          loading={draft.historyLoading()}
          entries={draft.savedHistory()}
          activity={Object.values(options.activeAppMap()?.activity ?? {}).sort(
            (left, right) => right.at - left.at,
          )}
          onClose={() => setHistoryOpen(false)}
          onRestore={(updatedAt) => {
            void draft.restoreSavedHistory(updatedAt);
            setHistoryOpen(false);
          }}
        />
      </Show>
    </>
  );

  return {
    surface: options.surface,
    clear: () => options.setSurface(null),
    agentOpen,
    historyOpen,
    proposalReviewOpen,
    setAgentOpen,
    setHistoryOpen,
    setProposalReviewOpen,
    exploration,
    pendingProposals,
    Panels,
  };
}
