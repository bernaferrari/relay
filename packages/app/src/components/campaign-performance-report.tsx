import { For, Show } from "solid-js";
import { formatReviewTime } from "../lib/run-review-model";
import type { CampaignPerformanceReport } from "../lib/campaign-performance";

export function CampaignPerformanceReportView(props: { report: CampaignPerformanceReport }) {
  const hasTiming = () =>
    props.report.totalDurationMs !== undefined || props.report.coverageDurationMs > 0;
  return (
    <Show
      when={
        props.report.checkCount > 0 ||
        props.report.cacheHits + props.report.cacheMisses + props.report.cacheBypassed > 0
      }
    >
      <section class="grid gap-2.5" aria-label="Campaign performance">
        <header>
          <strong class="block text-body font-semibold text-text-strong">Performance</strong>
          <span class="mt-0.5 block text-caption/[1.4] text-text-weaker">
            Exact check timing and avoidable work from this run.
          </span>
        </header>
        <dl class="m-0 grid grid-cols-2 gap-2 rounded-xl border border-border-weak-base bg-surface-base px-3.5 py-3 text-caption sm:grid-cols-4">
          <div>
            <dt class="m-0 text-micro text-text-weaker">Total</dt>
            <dd class="m-0 font-mono tabular-nums text-text-strong">
              {hasTiming()
                ? formatReviewTime(props.report.totalDurationMs ?? props.report.coverageDurationMs)
                : "—"}
            </dd>
          </div>
          <div>
            <dt class="m-0 text-micro text-text-weaker">Coverage</dt>
            <dd class="m-0 font-mono tabular-nums text-text-strong">
              {props.report.coverageDurationMs
                ? formatReviewTime(props.report.coverageDurationMs)
                : "—"}
            </dd>
          </div>
          <div>
            <dt class="m-0 text-micro text-text-weaker">Cache</dt>
            <dd class="m-0 font-mono tabular-nums text-text-strong">
              {props.report.cacheHits} hit · {props.report.cacheBypassed} fresh
            </dd>
          </div>
          <div>
            <dt class="m-0 text-micro text-text-weaker">Viewports</dt>
            <dd class="m-0 font-mono tabular-nums text-text-strong">
              {props.report.viewportCount}
            </dd>
          </div>
        </dl>
        <Show when={props.report.slowest.length > 0}>
          <ol class="m-0 grid list-none gap-1 p-0" aria-label="Slowest checks">
            <For each={props.report.slowest}>
              {(check, index) => (
                <li class="flex items-center justify-between gap-2 rounded-lg bg-surface-base px-3 py-2 text-caption">
                  <span class="min-w-0 truncate text-text-strong">
                    {index() + 1}. {check.title}
                  </span>
                  <span class="shrink-0 font-mono tabular-nums text-text-weaker">
                    {formatReviewTime(check.durationMs)}
                  </span>
                </li>
              )}
            </For>
          </ol>
        </Show>
        <Show when={props.report.recommendations.length > 0}>
          <ul class="m-0 grid list-none gap-1.5 p-0" aria-label="Avoidable work">
            <For each={props.report.recommendations}>
              {(item) => (
                <li class="rounded-lg border border-border-weak-base bg-background-base px-3 py-2">
                  <strong class="block text-caption font-medium text-text-strong">
                    {item.title}
                  </strong>
                  <p class="m-0 mt-0.5 text-caption/[1.45] text-text-weak">{item.detail}</p>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>
    </Show>
  );
}
