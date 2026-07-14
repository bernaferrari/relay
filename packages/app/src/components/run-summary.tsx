import { For, Show, type JSX } from "solid-js";
import type { JobInfo } from "../context/server";
import { fmtAgo, fmtDur, titleize } from "../lib/job";
import { cn } from "../lib/cn";
import { Icon } from "./icon";
import { platformLabel } from "../lib/target-presentation";

type RunSummaryProps = {
  job: JobInfo;
  clock: number;
  previous: JobInfo | null;
  onOpenRecipe: (id: string) => void;
  onRetry: (id: string) => void;
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

  return (
    <div class="relay-report-summary">
      <div class="relay-report-summary__overview">
        <div class="relay-report-summary__overview-copy">
          <span class="relay-report-summary__eyebrow">Run result</span>
          <div class="relay-report-summary__result-line">
            <span
              class={cn(
                "relay-report-summary__result-dot",
                job().status === "ok" || job().status === "healed"
                  ? "is-success"
                  : job().status === "error" || job().status === "cancelled"
                    ? "is-failure"
                    : "is-progress",
              )}
              aria-hidden="true"
            />
            <strong>{outcome()}</strong>
          </div>
        </div>
        <span class={cn("relay-status", `is-${job().status}`)}>{readableStatus(job().status)}</span>
      </div>
      <Show when={job().error && job().status === "error"}>
        <p class="relay-report-summary__message">{friendlyError(job().error!)}</p>
      </Show>
      <div class="relay-report-summary__section-label">What happened</div>
      <dl class="relay-report-summary__facts">
        <Show when={job().failureCategory}>
          <div>
            <dt>Why it stopped</dt>
            <dd>{readableFailure(job().failureCategory!)}</dd>
          </div>
        </Show>
        <div>
          <dt>Duration</dt>
          <dd>{fmtDur(job(), props.clock) || "—"}</dd>
        </div>
        <div>
          <dt>Target</dt>
          <dd>{job().targetProfile?.name ?? job().serial ?? "—"}</dd>
        </div>
        <Show when={job().appVersion}>
          <div>
            <dt>App version</dt>
            <dd>v{job().appVersion}</dd>
          </div>
        </Show>
        <Show when={job().targetProfile}>
          {(profile) => (
            <div>
              <dt>Platform</dt>
              <dd>
                {platformLabel(profile().platform)}
                {profile().osVersion ? ` · ${profile().osVersion}` : ""}
              </dd>
            </div>
          )}
        </Show>
        <Show when={(job().attempts ?? 1) > 1}>
          <div>
            <dt>Attempts</dt>
            <dd>{job().attempts}</dd>
          </div>
        </Show>
        <Show when={job().caseCount && job().caseCount! > 1}>
          <div>
            <dt>Data case</dt>
            <dd>
              {(job().caseIndex ?? 0) + 1} of {job().caseCount}
            </dd>
          </div>
        </Show>
      </dl>
      <Show when={previous()}>
        {(prior) => (
          <div class="relay-report-summary__comparison">
            <div>
              <span>Since the last run</span>
              <small>{fmtAgo(prior().startedAt ?? prior().queuedAt, props.clock)}</small>
            </div>
            <div>
              <strong>{durationDelta(job(), prior())}</strong>
              <Show when={scoreDelta(job(), prior())}>{(delta) => <small>{delta()}</small>}</Show>
            </div>
          </div>
        )}
      </Show>
      <Show when={Object.keys(job().resolvedInputs ?? {}).length > 0}>
        <div class="relay-report-summary__inputs">
          <span>Inputs used for this run</span>
          <For each={Object.entries(job().resolvedInputs ?? {})}>
            {([name, value]) => (
              <code>
                <b>{name}</b>
                <span>{value}</span>
              </code>
            )}
          </For>
        </div>
      </Show>
      <div class="relay-report-summary__actions">
        <Show when={job().status === "error" || job().status === "cancelled"}>
          <button type="button" class="relay-primary" onClick={() => props.onRetry(job().id)}>
            <Icon name="refresh" size={13} /> Retry run
          </button>
        </Show>
        <button
          type="button"
          class="relay-secondary relay-report-summary__open"
          onClick={() => props.onOpenRecipe(job().action)}
        >
          <span>Fix in test</span>
          <Icon name="arrow-right" size={13} />
        </button>
      </div>
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

function readableFailure(value: string): string {
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

function friendlyError(value: string): string {
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
