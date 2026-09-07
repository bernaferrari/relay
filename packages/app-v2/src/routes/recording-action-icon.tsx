import { ArrowLeft, Camera, Clock, Hand, Keyboard, MoveUpRight, CircleDot } from "lucide-react";
import type { ReviewAction } from "./recording-review-presentation";

export function RecordingActionIcon({ action }: { action: ReviewAction }) {
  const Icon =
    action.stepCount === 0
      ? Camera
      : action.kind === "tap"
        ? Hand
        : action.kind === "swipe"
          ? MoveUpRight
          : action.kind === "type"
            ? Keyboard
            : action.kind === "key" && /back/iu.test(action.intent)
              ? ArrowLeft
              : action.kind === "key"
                ? Keyboard
                : action.kind === "wait-for"
                  ? Clock
                  : CircleDot;
  return <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
}
