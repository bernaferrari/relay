import type { Accessor } from "solid-js";
import type { CanvasScreen } from "@relay/protocol";
import type { TakeDestination } from "../lib/app-map-canvas-graph";
import { useRecorder } from "../context/recorder";
import { AppMapTakeReview } from "./app-map-take-review";

type ReplayState = "idle" | "running" | "passed" | "failed";

export function AppMapTakeReviewMount(props: {
  selectedIndex: number;
  sourceTitle: string;
  screens: CanvasScreen[];
  destination: TakeDestination;
  onSelect: (index: number) => void;
  onDestination: (destination: TakeDestination) => void;
  onKeep: () => void;
  onDiscard: () => void;
  onReplay: () => void;
  onRewrite: () => void;
  takeReplay: Accessor<{ takeId: string | null; state: ReplayState; error?: string }>;
  setTakeReplay: (value: { takeId: string | null; state: ReplayState; error?: string }) => void;
  setReviewStepIndex: (updater: number | ((selected: number) => number)) => void;
}) {
  const recorder = useRecorder();
  const take = () => recorder.take()!;
  const replay = () => props.takeReplay();

  return (
    <AppMapTakeReview
      take={take()}
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
      onReorderActions={(actionIds) => recorder.reorderTakeActions(actionIds)}
      onReplaceAction={(actionId, interaction) => recorder.replaceTakeAction(actionId, interaction)}
      onRemoveAction={(actionId) => recorder.removeTakeAction(actionId)}
      onReviewInvalidated={() => props.setTakeReplay({ takeId: take().id, state: "idle" })}
      replayState={replay().takeId === take().id ? replay().state : "idle"}
      {...(replay().takeId === take().id && replay().error ? { replayError: replay().error } : {})}
      onRemove={(index) => {
        void recorder.removeTakeStep(index);
        props.setTakeReplay({ takeId: take().id, state: "idle" });
        props.setReviewStepIndex((selected) => (selected > index ? selected - 1 : selected));
      }}
      onClip={(clip) => {
        void recorder.setTakeVideoClip(clip);
        props.setTakeReplay({ takeId: take().id, state: "idle" });
      }}
    />
  );
}
