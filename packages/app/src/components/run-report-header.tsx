import { Show, type JSX } from "solid-js";
import { Button } from "@relay/ui/button";
import type { JobInfo } from "../context/server";
import { cn } from "../lib/cn";
import { fmtAgo, fmtDur } from "../lib/job";
import { runDisplayTitle } from "../lib/run-presentation";
import { eyebrow, mono } from "../lib/ui";
import { Icon } from "./icon";
import { RunShareMenu } from "./run-share-menu";

export function RunReportHeader(props: {
  job: JobInfo;
  clock: number;
  targetLabel: string;
  batchRunCount: number;
  appMapId: string | null;
  appMapAvailable: boolean;
  onOpenSource: () => void;
  onRetry: () => void;
  onReplay: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}): JSX.Element {
  return (
    <header class="grid shrink-0 gap-2.5 px-5 pt-4 pb-3.5">
      <div class="grid min-w-0 gap-1">
        <span class={eyebrow}>Execution review</span>
        <strong class="line-clamp-2 text-display/[1.15] font-semibold tracking-[-0.025em] text-text-strong">
          {runDisplayTitle(props.job)}
        </strong>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <RunShareMenu run={props.job} batchRunCount={props.batchRunCount} />
        <Button
          variant="secondary"
          size="sm"
          class="text-caption"
          disabled={Boolean(props.appMapId) && !props.appMapAvailable}
          data-tip={props.appMapAvailable ? "View this Run in its App Map" : undefined}
          onClick={props.onOpenSource}
        >
          <Icon name={props.appMapAvailable ? "edit" : "info"} size={12} />{" "}
          {props.appMapId ? (props.appMapAvailable ? "View map" : "Map deleted") : "Open test"}
        </Button>
        <Show when={props.job.status === "error" || props.job.status === "cancelled"}>
          <Button variant="primary" size="sm" class="text-caption" onClick={props.onRetry}>
            <Icon name="refresh" size={12} /> Retry
          </Button>
        </Show>
        <Show
          when={
            props.job.persisted && ["ok", "error", "healed", "cancelled"].includes(props.job.status)
          }
        >
          <Button
            variant="secondary"
            size="sm"
            class="text-caption"
            data-tip="Run the exact frozen plan and saved non-private inputs again"
            onClick={props.onReplay}
          >
            <Icon name="refresh" size={12} /> Replay recorded plan
          </Button>
        </Show>
        <Show when={["running", "paused"].includes(props.job.status)}>
          <Button
            variant="secondary"
            size="sm"
            class="text-caption"
            onClick={props.job.status === "paused" ? props.onResume : props.onPause}
          >
            <Icon name={props.job.status === "paused" ? "play" : "pause"} size={12} />
            {props.job.status === "paused" ? "Resume" : "Pause"}
          </Button>
          <Button variant="danger" size="sm" class="text-caption" onClick={props.onStop}>
            <Icon name="square" size={11} /> Stop
          </Button>
        </Show>
      </div>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 text-caption text-text-weak">
        <span class={cn(mono, "text-text-weaker")} data-tip="When this Run finished">
          {fmtAgo(props.job.finishedAt ?? props.job.startedAt ?? props.job.queuedAt, props.clock) ||
            "just now"}
        </span>
        <Show when={fmtDur(props.job, props.clock)}>
          <span class={cn(mono, "text-text-weaker")} data-tip="Run duration">
            · {fmtDur(props.job, props.clock)}
          </span>
        </Show>
        <span class="inline-flex min-w-0 items-center gap-1.5 text-text-base">
          <Icon name="smartphone" size={11} class="shrink-0 text-text-weaker" />
          <span
            class="truncate"
            data-tip={props.job.serial ? `Target identifier: ${props.job.serial}` : undefined}
          >
            {props.targetLabel}
          </span>
        </span>
      </div>
    </header>
  );
}
