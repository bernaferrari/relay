import { For, Show, createMemo } from "solid-js";
import { cn } from "../lib/cn";
import {
  campaignCheckCounts,
  campaignCheckResults,
  type CampaignCheckResult,
  type CampaignCheckStatus,
} from "../lib/campaign-check-results";
import {
  navigationTransitionHealthFromJob,
  type NavigationTransitionRepairEntry,
} from "../lib/navigation-transition-health";
import { campaignRecoveryInterventionFromJob } from "../lib/campaign-recovery-intervention";
import { campaignPerformanceFromJob } from "../lib/campaign-performance";
import { formatReviewTime } from "../lib/run-review-model";
import type { JobInfo } from "../lib/api-types";
import { Icon, type IconName } from "./icon";
import { NavigationTransitionHealth } from "./navigation-transition-health";
import { CampaignRecoveryIntervention } from "./campaign-recovery-intervention";
import { CampaignPerformanceReportView } from "./campaign-performance-report";

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
  onRetryCheck?: (checkId: string) => void;
  onRepairTest?: (checkId: string) => void;
  retrying?: boolean;
}) {
  const reasonLabel = () => (props.check.status === "blocked" ? "Dependency" : "Reason");
  const accessibilityDescription = () => {
    const observed = props.check.repair?.observed;
    if (!observed) return undefined;
    const count =
      observed.nodeCount === undefined ? "unknown node count" : `${observed.nodeCount} nodes`;
    if (observed.accessibilityAvailable === true) return `Accessibility tree available · ${count}`;
    if (observed.accessibilityAvailable === false)
      return `Accessibility tree unavailable · ${count} captured`;
    return `Accessibility availability not recorded · ${count} captured`;
  };
  return (
    <div class="grid gap-3 border-t border-border-weak-base px-3.5 py-3">
      <Show when={props.check.error && !props.check.repair}>
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
      <Show when={props.check.repair}>
        {(repair) => (
          <section class="grid gap-3" aria-label={`Repair evidence for ${props.check.title}`}>
            <div class="grid gap-2">
              <h4 class="m-0 text-micro font-semibold text-text-strong">What Relay saw</h4>
              <For each={props.check.frames}>
                {(evidenceFrame) => {
                  const source = () => props.frameSource?.(evidenceFrame) ?? "";
                  const caption = () => evidenceFrame.frame.caption ?? "Captured failure";
                  return (
                    <button
                      type="button"
                      class="group grid min-h-11 touch-manipulation grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 overflow-hidden rounded-lg border border-border-weak-base bg-background-base p-1.5 text-left transition-[border-color,background-color] motion-reduce:transition-none hover:border-border-strong-base hover:bg-surface-base-hover focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-border-strong-focus disabled:cursor-default"
                      onClick={() => props.onOpenFrame?.(evidenceFrame.index)}
                      disabled={!props.onOpenFrame}
                      aria-label={`Open failure screenshot: ${caption()}`}
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
                      <span class="min-w-0 break-words text-caption/[1.4] text-text-base">
                        {caption()}
                      </span>
                      <Show when={props.onOpenFrame}>
                        <Icon name="arrow-right" size={12} class="mr-1 text-text-weaker" />
                      </Show>
                    </button>
                  );
                }}
              </For>
              <dl class="m-0 grid gap-1 rounded-lg bg-surface-base px-3 py-2.5 text-caption/[1.45]">
                <Show when={repair().observed.app || repair().observed.header}>
                  <div class="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
                    <dt class="text-text-weaker">Location</dt>
                    <dd class="m-0 break-words text-text-base">
                      {[repair().observed.app, repair().observed.header]
                        .filter(Boolean)
                        .join(" · ")}
                    </dd>
                  </div>
                </Show>
                <Show when={repair().observed.identity}>
                  <div class="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
                    <dt class="text-text-weaker">Identity</dt>
                    <dd class="m-0 break-all font-mono text-micro text-text-base">
                      {repair().observed.identity}
                    </dd>
                  </div>
                </Show>
                <div class="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
                  <dt class="text-text-weaker">Accessibility</dt>
                  <dd class="m-0 break-words text-text-base">{accessibilityDescription()}</dd>
                </div>
              </dl>
            </div>
            <div class="grid gap-2">
              <h4 class="m-0 text-micro font-semibold text-text-strong">What Relay tried</h4>
              <Show
                when={repair().attempts.length > 0}
                fallback={
                  <p class="m-0 text-caption/[1.45] text-text-weaker">
                    No locator attempts were recorded for this failure.
                  </p>
                }
              >
                <ol class="m-0 grid list-decimal gap-2 pl-5">
                  <For each={repair().attempts}>
                    {(attempt) => (
                      <li class="pl-1 text-caption/[1.45] text-text-base marker:text-text-weaker">
                        <div class="grid gap-0.5">
                          <span class="break-words">
                            <strong class="font-medium text-text-strong">{attempt.method}</strong>
                            {` · ${attempt.outcome === "used" ? "Used" : "Rejected"} · ${attempt.target}`}
                          </span>
                          <Show when={attempt.detail}>
                            <span class="whitespace-pre-wrap break-words text-text-critical-base">
                              {attempt.detail}
                            </span>
                          </Show>
                          <Show when={attempt.bounds || attempt.point}>
                            <span class="break-words font-mono text-micro text-text-weaker">
                              {[
                                attempt.bounds ? `Bounds ${attempt.bounds}` : undefined,
                                attempt.point ? `Tap ${attempt.point}` : undefined,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </Show>
                          <Show when={attempt.note}>
                            <span class="break-words text-text-weaker">{attempt.note}</span>
                          </Show>
                        </div>
                      </li>
                    )}
                  </For>
                </ol>
              </Show>
              <Show when={repair().attemptsTruncated}>
                <p class="m-0 text-micro/[1.4] text-text-weaker">
                  Additional locator evidence remains in Raw evidence.
                </p>
              </Show>
            </div>
            <div class="grid gap-1">
              <h4 class="m-0 text-micro font-semibold text-text-strong">What happened</h4>
              <p class="m-0 whitespace-pre-wrap break-words text-caption/[1.5] text-text-base">
                {repair().failureReason ?? "The check failed without a recorded failure reason."}
              </p>
            </div>
            <div class="grid gap-1 rounded-lg bg-surface-warning-weak px-3 py-2.5">
              <h4 class="m-0 text-micro font-semibold text-text-warning-base">Next step</h4>
              <p class="m-0 break-words text-caption/[1.5] text-text-strong">{repair().nextStep}</p>
              <div class="mt-1 flex flex-wrap items-center gap-2">
                <span class="text-micro text-text-weaker">Default: continue and report</span>
                <Show when={props.onRetryCheck}>
                  <button
                    type="button"
                    class="min-h-9 touch-manipulation rounded-lg border border-border-strong-base bg-background-base px-3 text-caption font-medium text-text-strong hover:bg-surface-base-hover focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-border-strong-focus disabled:cursor-wait disabled:opacity-60"
                    disabled={props.retrying}
                    onClick={() => props.onRetryCheck?.(props.check.id)}
                    aria-label={`Retry only failed check: ${props.check.title}`}
                  >
                    {props.retrying ? "Starting…" : "Retry this check"}
                  </button>
                </Show>
                <Show when={props.onRepairTest}>
                  <button
                    type="button"
                    class="min-h-9 touch-manipulation rounded-lg px-3 text-caption font-medium text-text-base hover:bg-surface-base-hover focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-border-strong-focus"
                    onClick={() => props.onRepairTest?.(props.check.id)}
                  >
                    Repair Test
                  </button>
                </Show>
              </div>
            </div>
          </section>
        )}
      </Show>
      <Show when={props.check.frames.length > 0 && !props.check.repair}>
        <div class="grid gap-2">
          <strong class="text-micro font-medium text-text-weak">Failure screenshot</strong>
          <For each={props.check.frames}>
            {(evidenceFrame) => (
              <button
                type="button"
                class="min-h-11 touch-manipulation rounded-lg border border-border-weak-base bg-background-base px-3 text-left text-caption text-text-base focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-border-strong-focus"
                onClick={() => props.onOpenFrame?.(evidenceFrame.index)}
                disabled={!props.onOpenFrame}
              >
                {evidenceFrame.frame.caption ?? "Captured failure"}
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.check.evidence.length > 0}>
        <details class="group rounded-lg border border-border-weak-base bg-background-base">
          <summary class="flex min-h-11 touch-manipulation cursor-pointer list-none items-center justify-between gap-2 px-3 text-caption font-medium text-text-base focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-border-strong-focus [&::-webkit-details-marker]:hidden">
            Raw evidence
            <Icon
              name="chevron-down"
              size={12}
              class="transition-transform motion-reduce:transition-none group-open:rotate-180"
            />
          </summary>
          <pre class="m-0 max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-border-weak-base p-3 font-mono text-micro/[1.5] text-text-weak">
            {JSON.stringify(props.check.evidence, null, 2)}
          </pre>
        </details>
      </Show>
      {props.check.frames.length || props.check.evidence.length ? null : (
        <p class="m-0 text-caption/[1.45] text-text-weaker">
          No additional screenshot or evidence was captured for this check.
        </p>
      )}
    </div>
  );
}

export function CampaignCheckResults(props: {
  job: JobInfo;
  frameSource?: (frame: CampaignCheckResult["frames"][number]) => string;
  onOpenFrame?: (index: number) => void;
  onRetryCheck?: (checkId: string) => void;
  onRepairTest?: (checkId: string) => void;
  onReviewNavigationRepair?: (repair: NavigationTransitionRepairEntry) => void;
  onResume?: (jobId: string) => void;
  retryingCheckId?: string;
}) {
  const checks = createMemo(() => campaignCheckResults(props.job));
  const counts = createMemo(() => campaignCheckCounts(checks()));
  const navigation = createMemo(() => navigationTransitionHealthFromJob(props.job));
  const intervention = createMemo(() => campaignRecoveryInterventionFromJob(props.job));
  const performance = createMemo(() => campaignPerformanceFromJob(props.job));
  return (
    <Show
      when={
        checks().length > 0 ||
        navigation().rows.length > 0 ||
        intervention() ||
        performance().checkCount > 0 ||
        performance().cacheHits + performance().cacheMisses + performance().cacheBypassed > 0
      }
    >
      <section class="grid gap-4" aria-label="Run checks">
        <CampaignPerformanceReportView report={performance()} />
        <Show when={intervention()}>
          {(model) => (
            <CampaignRecoveryIntervention
              intervention={model()}
              frameSource={(frame) =>
                props.frameSource?.({ index: model().screenshot.frameIndex!, frame }) ?? ""
              }
              onOpenFrame={props.onOpenFrame}
              onReviewRepair={props.onReviewNavigationRepair}
              onTeachTransition={props.onRepairTest}
              onResume={props.onResume}
            />
          )}
        </Show>
        <Show when={navigation().rows.length > 0}>
          <NavigationTransitionHealth
            model={navigation()}
            onReviewRepair={props.onReviewNavigationRepair}
          />
        </Show>
        <Show when={checks().length > 0}>
          <div class="grid gap-2.5">
            <header class="flex flex-wrap items-start justify-between gap-2">
              <div>
                <strong
                  id="campaign-checks-heading"
                  class="block text-body font-semibold text-text-strong"
                >
                  Campaign checks
                </strong>
                <span class="mt-0.5 block text-caption/[1.4] text-text-weaker">
                  Independent checks keep their own outcome and evidence.
                </span>
              </div>
              <div
                class="flex flex-wrap justify-end gap-x-2 gap-y-1 text-micro tabular-nums text-text-weaker"
                aria-label="Check totals"
              >
                <For
                  each={(
                    ["passed", "failed", "skipped", "blocked"] as CampaignCheckStatus[]
                  ).filter((item) => counts()[item] > 0)}
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
                          <span
                            class={cn("mt-0.5 block text-micro font-medium", presentation().tone)}
                          >
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
                        onRetryCheck={props.onRetryCheck}
                        onRepairTest={props.onRepairTest}
                        retrying={props.retryingCheckId === check.id}
                      />
                    </details>
                  );
                }}
              </For>
            </div>
          </div>
        </Show>
      </section>
    </Show>
  );
}
