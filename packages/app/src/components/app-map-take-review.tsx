import type { AuthoringInteraction, JourneyGraphScreen, JourneyVideoClip } from "@relay/protocol";
import type { RecordingTake } from "../context/recorder";
import type { TakeDestination } from "../lib/journey-graph";
import { RecordedTakePlayer, TakeReviewSidebar } from "./journey-capture-review";

export type AppMapTakeReviewProps = {
  take: RecordingTake;
  selectedIndex: number;
  sourceTitle: string;
  screens: JourneyGraphScreen[];
  destination: TakeDestination;
  replayState: "idle" | "running" | "passed" | "failed";
  replayError?: string;
  onSelect: (index: number) => void;
  onDestination: (destination: TakeDestination) => void;
  onKeep: () => void;
  onDiscard: () => void;
  onReplay: () => void;
  onRewrite: () => void;
  onRemove: (index: number) => void | Promise<void>;
  onReorderActions: (actionIds: string[]) => void | Promise<void>;
  onReplaceAction: (actionId: string, interaction: AuthoringInteraction) => void | Promise<void>;
  onRemoveAction: (actionId: string) => void | Promise<void>;
  onReviewInvalidated: () => void;
  onClip: (clip: JourneyVideoClip) => void | Promise<void>;
};

/** The take review is a focused mode with one decision surface and one evidence surface. */
export function AppMapTakeReview(props: AppMapTakeReviewProps) {
  return (
    <>
      <TakeReviewSidebar
        take={props.take}
        selectedIndex={props.selectedIndex}
        sourceTitle={props.sourceTitle}
        screens={props.screens}
        destination={props.destination}
        onSelect={props.onSelect}
        onDestination={props.onDestination}
        onKeep={props.onKeep}
        onDiscard={props.onDiscard}
        onReplay={props.onReplay}
        onRewrite={props.onRewrite}
        onReorderActions={props.onReorderActions}
        onReplaceAction={props.onReplaceAction}
        onRemoveAction={props.onRemoveAction}
        onReviewInvalidated={props.onReviewInvalidated}
        replayState={props.replayState}
        {...(props.replayError ? { replayError: props.replayError } : {})}
        onRemove={props.onRemove}
      />
      <section
        class="relative min-h-0 min-w-0 overflow-hidden border-l border-[var(--v2-border-border-muted)] max-[760px]:border-t max-[760px]:border-l-0"
        aria-label="Recorded action playback"
      >
        <RecordedTakePlayer
          take={props.take}
          selectedIndex={props.selectedIndex}
          onSelect={props.onSelect}
          screenshotFor={(_, index) => props.take.stepEvidenceUrls[index] ?? ""}
          videoSrc={props.take.videoEvidenceUrl}
          clip={props.take.videoClip}
          onClip={props.onClip}
        />
      </section>
    </>
  );
}
