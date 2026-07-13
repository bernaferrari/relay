import type { JobInfo, PersistedRun, TraceFrameRef, Frame } from "../context/server";
import type { RunChip } from "../context/workbench";
import { stepStatusFromRun } from "./run-gates";
import type { ScreenNode } from "./screen-graph";

export type FrameCanvasItem = {
  id: string;
  index: number;
  caption: string;
  src: string;
  status: ScreenNode["status"];
  edgeLabel?: string;
};

export function frameCanvasItems(input: {
  reviewed: RunChip | null;
  liveFrames: readonly Frame[];
  activeJob: JobInfo | null;
  persistedFrameUrl: (run: PersistedRun, frame: TraceFrameRef) => string;
}): FrameCanvasItem[] {
  const { reviewed, liveFrames, activeJob, persistedFrameUrl } = input;
  if (reviewed?.kind === "disk" && reviewed.run.frames?.length) {
    return reviewed.run.frames.map((frame, index) => {
      const caption = frame.caption || `Step ${index + 1}`;
      return {
        id: `disk-${reviewed.run.id}-${index}`,
        index,
        caption,
        src: persistedFrameUrl(reviewed.run, frame),
        status: stepStatusFromRun(reviewed.run.steps, index) as ScreenNode["status"],
        edgeLabel: index === 0 ? undefined : shortLabel(caption),
      };
    });
  }

  if (reviewed?.kind === "live" && liveFrames.length) {
    return liveFrames.map((frame, index) => liveItem(frame, index, reviewed.job.steps));
  }

  return liveFrames.map((frame, index) =>
    liveItem(frame, index, activeJob?.steps, activeJob ? undefined : "idle"),
  );
}

function liveItem(
  frame: Frame,
  index: number,
  steps: JobInfo["steps"],
  fallback: ScreenNode["status"] = "idle",
): FrameCanvasItem {
  const caption = frame.caption || `Frame ${index + 1}`;
  return {
    id: frame.id,
    index,
    caption,
    src: frameToSrc(frame),
    status: (steps ? stepStatusFromRun(steps, index) : fallback) as ScreenNode["status"],
    edgeLabel: index === 0 ? undefined : shortLabel(caption),
  };
}

export function shortLabel(caption: string): string {
  const value = caption.trim();
  if (!value) return "next";
  if (/^step\s*\d+/i.test(value)) return value;
  if (value.length <= 18) return value;
  return `${value.slice(0, 16).trimEnd()}…`;
}

export function frameToSrc(frame: Frame): string {
  if (frame.base64) return `data:${frame.mime || "image/png"};base64,${frame.base64}`;
  return "";
}
