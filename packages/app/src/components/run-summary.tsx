import { For, Show, type JSX } from "solid-js";
import type { JobInfo } from "../context/server";
import { fmtAgo, fmtDur, titleize } from "../lib/job";
import { cn } from "../lib/cn";
import { Icon } from "./icon";
import { platformLabel } from "../lib/target-presentation";
import { productSecondary, productStatus } from "../lib/ui";

type RunSummaryProps = {
  job: JobInfo;
  clock: number;
  previous: JobInfo | null;
  onOpenRecipe: (id: string) => void;
};

/**
 * The readable part of a run report. Technical identifiers stay behind the
 * details disclosure in the parent; this surface answers “what happened?”
 * without turning every fact into a heavy card.
 */
export function RunSummary(props: RunSummaryProps): JSX.Element {
  const job = () => props.job;
  const previous = () => props.previous;
  const outcome = () =>
    readableOutcome(job().outcome ?? (job().status === "error" ? "harness-failure" : "passed"));

  const resultTone = () =>
    job().status === "ok" || job().status === "healed"
      ? "bg-icon-success-base"
      : job().status === "error" || job().status === "cancelled"
        ? "bg-icon-critical-base"
        : "bg-surface-brand-base shadow-[0_0_0_3px_color-mix(in_srgb,var(--surface-brand-base)_14%,transparent)]";

  return (
    <div class="grid min-w-0 overflow-hidden">
      <div class="flex min-w-0 items-center justify-between gap-3 border-b border-border-weak-base py-px pb-3.5">
        <div class="grid min-w-0 gap-1">
          <span class="text-[11px]/[1.25] text-text-weaker">Run result</span>
          <div class="flex min-w-0 items-center gap-1.5 text-[15px]/[1.25] font-semibold text-text-strong">
            <span class={cn("size-[7px] shrink-0 rounded-full", resultTone())} aria-hidden="true" />
            <strong class="font-semibold">{outcome()}</strong>
          </div>
        </div>
        <span class={productStatus(String(job().status))}>{readableStatus(job().status)}</span>
      </div>
      <Show when={job().error && job().status === "error"}>
        <p class="m-0 overflow-wrap-anywhere px-0.5 py-2.5 text-[12.5px]/[1.5] text-text-weak">
          {friendlyError(job().error!)}
        </p>
      </Show>
      <div class="pt-4 pb-1 text-[11px]/[1.25] font-semibold tracking-[0.06em] uppercase text-text-weaker">
        What happened
      </div>
      <dl class="m-0 grid grid-cols-1">
        <Show when={job().failureCategory}>
          <Fact label="Why it stopped" value={readableFailure(job().failureCategory!)} />
        </Show>
        <Fact label="Duration" value={fmtDur(job(), props.clock) || "—"} />
        <Fact label="Target" value={job().targetProfile?.name ?? job().serial ?? "—"} />
        <Show when={job().appVersion}>
          <Fact label="App version" value={`v${job().appVersion}`} />
        </Show>
        <Show when={job().targetProfile}>
          {(profile) => (
            <Fact
              label="Platform"
              value={`${platformLabel(profile().platform)}${profile().osVersion ? ` · ${profile().osVersion}` : ""}`}
            />
          )}
        </Show>
        <Show when={(job().attempts ?? 1) > 1}>
          <Fact label="Attempts" value={String(job().attempts)} />
        </Show>
        <Show when={job().caseCount && job().caseCount! > 1}>
          <Fact label="Data case" value={`${(job().caseIndex ?? 0) + 1} of ${job().caseCount}`} />
        </Show>
      </dl>
      <Show when={previous()}>
        {(prior) => (
          <div class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-border-weak-base py-2.5">
            <div class="grid gap-0.5">
              <span class="text-[11px]/[1.25] text-text-weaker">Since the last run</span>
              <small class="text-[10px]/[1.25] text-text-weaker">
                {fmtAgo(prior().startedAt ?? prior().queuedAt, props.clock)}
              </small>
            </div>
            <div class="grid justify-items-end gap-0.5 text-right">
              <strong class="text-[12.5px]/[1.25] font-semibold text-text-strong">
                {durationDelta(job(), prior())}
              </strong>
              <Show when={scoreDelta(job(), prior())}>
                {(delta) => <small class="text-[10px] text-text-weaker">{delta()}</small>}
              </Show>
            </div>
          </div>
        )}
      </Show>
      <Show when={Object.keys(job().resolvedInputs ?? {}).length > 0}>
        <div class="grid min-w-0 gap-2 border-b border-border-weak-base py-2.5">
          <span class="text-[11px]/[1.25] text-text-weaker">Inputs used for this run</span>
          <For each={Object.entries(job().resolvedInputs ?? {})}>
            {([name, value]) => (
              <code class="grid min-w-0 grid-cols-[minmax(0,0.4fr)_minmax(0,1fr)] gap-2 font-mono text-[10.5px]/[1.5] text-text-weak">
                <b class="min-w-0 overflow-hidden text-ellipsis text-text-strong">{name}</b>
                <span class="min-w-0 overflow-hidden overflow-wrap-anywhere">{value}</span>
              </code>
            )}
          </For>
        </div>
      </Show>
      <div class="mt-3.5 mb-px flex items-center justify-end gap-2">
        <button
          type="button"
          class={productSecondary}
          onClick={() => props.onOpenRecipe(job().action)}
        >
          <span>Fix in test</span>
          <Icon name="arrow-right" size={13} />
        </button>
      </div>
    </div>
  );
}

function Fact(props: { label: string; value: string }): JSX.Element {
  return (
    <div class="flex min-h-[38px] min-w-0 items-baseline justify-between gap-4 border-b border-border-weak-base py-2">
      <dt class="min-w-0 text-[11.5px]/[1.3] text-text-weaker">{props.label}</dt>
      <dd class="m-0 max-w-[68%] min-w-0 overflow-hidden text-right text-[13px]/[1.3] font-medium text-ellipsis whitespace-nowrap text-text-strong">
        {props.value}
      </dd>
    </div>
  );
}

function readableStatus(value: JobInfo["status"]): string {
  switch (value) {
    case "ok":
      return "Passed";
    case "healed":
      return "Passed with recovery";
    case "error":
      return "Error";
    case "cancelled":
      return "Stopped";
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "paused":
      return "Paused";
  }
}

function readableOutcome(value: string): string {
  switch (value) {
    case "passed":
      return "Passed";
    case "harness-failure":
      return "Could not run";
    case "product-failure":
      return "App issue";
    case "uncertain":
      return "Needs review";
    default:
      return titleize(value);
  }
}

export function readableFailure(value: string): string {
  const labels: Record<string, string> = {
    environment: "Setup",
    "target-state": "App state",
    locator: "Target not found",
    action: "Action",
    completion: "Response timeout",
    extraction: "Could not read response",
    "deterministic-assertion": "Expected check",
    "semantic-assertion": "Answer check",
    "visual-assertion": "Visual check",
    "judge-uncertainty": "Needs review",
    "harness-defect": "Test system",
  };
  return labels[value] ?? titleize(value);
}

export function friendlyError(value: string): string {
  const message = value.trim();
  if (/already bound|already in use|session .* bound/i.test(message)) {
    return "This target is already in use by another session. Stop that session or choose a different target.";
  }
  if (/server.*offline|connection refused|failed to fetch|network request failed/i.test(message)) {
    return "Relay could not reach the target service. Start it, then try again.";
  }
  if (/unknown target|target.*not found|no such device/i.test(message)) {
    return "The selected target is no longer available. Choose another target and try again.";
  }
  if (/timed out|timeout/i.test(message)) {
    return "The target did not respond in time. Check the app state and try again.";
  }
  return message;
}

function durationDelta(current: JobInfo, previous: JobInfo): string {
  const currentMs = runDuration(current);
  const previousMs = runDuration(previous);
  if (currentMs === null || previousMs === null) return "Time unavailable";
  const difference = currentMs - previousMs;
  if (Math.abs(difference) < 50) return "About the same speed";
  const amount =
    Math.abs(difference) < 1000
      ? `${Math.round(Math.abs(difference))}ms`
      : `${(Math.abs(difference) / 1000).toFixed(1)}s`;
  return `${amount} ${difference > 0 ? "slower" : "faster"}`;
}

function scoreDelta(current: JobInfo, previous: JobInfo): string | null {
  const currentScore = semanticScore(current);
  const previousScore = semanticScore(previous);
  if (currentScore === null || previousScore === null) return null;
  const delta = Math.round((currentScore - previousScore) * 100);
  if (delta === 0) return "Same quality score";
  return `${Math.abs(delta)} quality points ${delta > 0 ? "higher" : "lower"}`;
}

function runDuration(job: JobInfo): number | null {
  if (job.startedAt && job.finishedAt) {
    return Math.max(0, job.finishedAt - job.startedAt);
  }
  return null;
}

function semanticScore(job: JobInfo): number | null {
  const scores =
    job.artifacts
      ?.filter((item) => item.kind === "semantic-evaluation")
      .flatMap((item) => {
        if (typeof item.data !== "object" || item.data === null) return [];
        const score = Reflect.get(item.data, "score");
        return typeof score === "number" && Number.isFinite(score) ? [score] : [];
      }) ?? [];
  return scores.length > 0 ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;
}
