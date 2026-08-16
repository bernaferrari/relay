import { For, Show, createMemo } from "solid-js";
import { cn } from "../lib/cn";
import {
  campaignCheckCounts,
  campaignCheckResults,
  type CampaignCheckResult,
  type CampaignCheckStatus,
} from "../lib/campaign-check-results";
import { formatReviewTime } from "../lib/run-review-model";
import type { JobInfo } from "../lib/api-types";
import { Icon, type IconName } from "./icon";

const STATUS_PRESENTATION: Record<
  CampaignCheckStatus,
  { label: string; icon: IconName; tone: string; surface: string }
> = {
  passed: {
    label: "Passed",
    icon: "check",
    tone: "text-text-success-base",
    surface: "bg-surface-success-weak",
  },
  failed: {
    label: "Failed",
    icon: "x",
    tone: "text-text-critical-base",
    surface: "bg-surface-critical-weak",
  },
  skipped: {
    label: "Skipped",
    icon: "slash",
    tone: "text-text-weak",
    surface: "bg-surface-base-active",
  },
  blocked: {
    label: "Blocked",
    icon: "alert",
    tone: "text-text-warning-base",
    surface: "bg-surface-warning-weak",
  },
};

function CheckDetail(props: {
  check: CampaignCheckResult;
  frameSource?: (frame: CampaignCheckResult["frames"][number]) => string;
  onOpenFrame?: (index: number) => void;
}) {
  const reasonLabel = () => (props.check.status === "blocked" ? "Dependency" : "Reason");
  return (
    <div class="grid gap-3 border-t border-border-weak-base px-3.5 py-3">
      <Show when={props.check.error}>
        <div class="grid gap-1 rounded-lg bg-surface-critical-weak px-3 py-2.5">
          <span class="text-micro font-semibold tracking-[0.08em] text-text-critical-base uppercase">
            Failure
          </span>
          <p class="m-0 whitespace-pre-wrap break-words text-caption/[1.5] text-text-strong">
            {props.check.error}
          </p>
        </div>
      </Show>
      <Show when={props.check.dependencyReason}>
        <div class="grid gap-1 rounded-lg bg-surface-warning-weak px-3 py-2.5">
          <span class="text-micro font-semibold tracking-[0.08em] text-text-warning-base uppercase">
            {reasonLabel()}
          </span>
          <p class="m-0 whitespace-pre-wrap break-words text-caption/[1.5] text-text-strong">
            {props.check.dependencyReason}
          </p>
        </div>
      </Show>
      <Show when={props.check.frames.length > 0}>
        <div class="grid gap-2">
          <strong class="text-micro font-medium text-text-weak">Failure screenshot</strong>
          <For each={props.check.frames}>
            {(evidenceFrame) => {
              const source = () => props.frameSource?.(evidenceFrame) ?? "";
              return (
                <button
                  type="button"
                  class="group grid min-h-11 grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 overflow-hidden rounded-lg border border-border-weak-base bg-background-base p-1.5 text-left transition-[border-color,background-color] hover:border-border-strong-base hover:bg-surface-base-hover focus-visible:outline-1 focus-visible:outline-border-strong-focus"
                  onClick={() => props.onOpenFrame?.(evidenceFrame.index)}
                  disabled={!props.onOpenFrame}
                >
                  <Show
                    when={source()}
                    fallback={
                      <span class="grid h-11 place-items-center rounded-md bg-surface-base">
                        <Icon name="camera" size={14} />
                      </span>
                    }
                  >
                    <img
                      src={source()}
                      alt=""
                      class="h-11 w-16 rounded-md bg-background-deep object-cover"
                    />
                  </Show>
                  <span class="min-w-0 truncate text-micro text-text-base">
                    {evidenceFrame.frame.caption ?? "Captured failure"}
                  </span>
                  <Show when={props.onOpenFrame}>
                    <Icon name="arrow-right" size={12} class="mr-1 text-text-weaker" />
                  </Show>
                </button>
              );
            }}
          </For>
        </div>
      </Show>
      <For each={props.check.evidence}>
        {(artifact) => (
          <details class="group rounded-lg border border-border-weak-base bg-background-base">
            <summary class="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-micro font-medium text-text-base focus-visible:outline-1 focus-visible:outline-border-strong-focus [&::-webkit-details-marker]:hidden">
              Structured evidence
              <Icon
                name="chevron-down"
                size={12}
                class="transition-transform group-open:rotate-180"
              />
            </summary>
            <pre class="m-0 max-h-64 overflow-auto border-t border-border-weak-base p-3 font-mono text-micro/[1.5] text-text-weak">
              {JSON.stringify(artifact.data, null, 2)}
            </pre>
          </details>
        )}
      </For>
      {props.check.frames.length || props.check.evidence.length ? null : (
        <p class="m-0 text-micro/[1.45] text-text-weaker">
          No additional screenshot or structured evidence was captured for this check.
        </p>
      )}
    </div>
  );
}

export function CampaignCheckResults(props: {
  job: JobInfo;
  frameSource?: (frame: CampaignCheckResult["frames"][number]) => string;
  onOpenFrame?: (index: number) => void;
}) {
  const checks = createMemo(() => campaignCheckResults(props.job));
  const counts = createMemo(() => campaignCheckCounts(checks()));
  return (
    <Show when={checks().length > 0}>
      <section class="grid gap-2.5" aria-labelledby="campaign-checks-heading">
        <header class="flex flex-wrap items-start justify-between gap-2">
          <div>
            <strong
              id="campaign-checks-heading"
              class="block text-body font-semibold text-text-strong"
            >
              Campaign checks
            </strong>
            <span class="mt-0.5 block text-micro/[1.4] text-text-weaker">
              Independent checks keep their own outcome and evidence.
            </span>
          </div>
          <div
            class="flex flex-wrap justify-end gap-x-2 gap-y-1 text-micro tabular-nums text-text-weaker"
            aria-label="Check totals"
          >
            <For
              each={(["passed", "failed", "skipped", "blocked"] as CampaignCheckStatus[]).filter(
                (item) => counts()[item] > 0,
              )}
            >
              {(item) => (
                <span>
                  {counts()[item]} {STATUS_PRESENTATION[item].label.toLocaleLowerCase()}
                </span>
              )}
            </For>
          </div>
        </header>
        <div class="overflow-hidden rounded-xl border border-border-weak-base bg-surface-base">
          <For each={checks()}>
            {(check) => {
              const presentation = () => STATUS_PRESENTATION[check.status];
              return (
                <details
                  class="group border-b border-border-weak-base last:border-0"
                  open={["failed", "blocked"].includes(check.status)}
                >
                  <summary class="grid min-h-12 cursor-pointer list-none grid-cols-[28px_minmax(0,1fr)_auto_16px] items-center gap-2.5 px-3.5 py-2.5 hover:bg-surface-raised-base-hover focus-visible:outline-1 focus-visible:outline-border-strong-focus [&::-webkit-details-marker]:hidden">
                    <span
                      class={cn(
                        "grid size-7 place-items-center rounded-lg",
                        presentation().surface,
                        presentation().tone,
                      )}
                      aria-hidden="true"
                    >
                      <Icon name={presentation().icon} size={13} />
                    </span>
                    <span class="min-w-0">
                      <strong class="block truncate text-caption font-medium text-text-strong">
                        {check.title}
                      </strong>
                      <span class={cn("mt-0.5 block text-micro font-medium", presentation().tone)}>
                        {presentation().label}
                      </span>
                    </span>
                    <Show when={check.durationMs !== undefined}>
                      <span class="font-mono text-micro tabular-nums text-text-weaker">
                        {formatReviewTime(check.durationMs!)}
                      </span>
                    </Show>
                    <Icon
                      name="chevron-down"
                      size={12}
                      class="text-text-weaker transition-transform group-open:rotate-180"
                    />
                  </summary>
                  <CheckDetail
                    check={check}
                    frameSource={props.frameSource}
                    onOpenFrame={props.onOpenFrame}
                  />
                </details>
              );
            }}
          </For>
        </div>
        <Show
          when={checks().some((check) => check.status === "failed" || check.status === "blocked")}
        >
          <p class="m-0 text-micro/[1.45] text-text-weaker">
            Retry in the report header replays the saved run. Relay only offers a narrower retry
            when the execution contract identifies a safe retry target.
          </p>
        </Show>
      </section>
    </Show>
  );
}
