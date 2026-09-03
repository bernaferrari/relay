import { For, Show } from "solid-js";
import { formatReviewTime } from "../lib/run-review-model";
import type { CampaignPerformanceReport } from "../lib/campaign-performance";

export function CampaignPerformanceReportView(props: { report: CampaignPerformanceReport }) {
  const hasTiming = () =>
    props.report.totalDurationMs !== undefined || props.report.coverageDurationMs > 0;
  const cacheEvents = () =>
    props.report.cacheHits + props.report.cacheMisses + props.report.cacheBypassed;
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
        <dl class="m-0 flex flex-wrap gap-x-8 gap-y-3 border-y border-border-weak-base py-3 text-caption">
          <div>
            <dt class="m-0 text-micro text-text-weaker">Run time</dt>
            <dd class="m-0 font-mono tabular-nums text-text-strong">
              {hasTiming()
                ? formatReviewTime(props.report.totalDurationMs ?? props.report.coverageDurationMs)
                : "—"}
            </dd>
          </div>
          <div>
            <dt class="m-0 text-micro text-text-weaker">Checks</dt>
            <dd class="m-0 font-mono tabular-nums text-text-strong">
              {props.report.coverageDurationMs
                ? formatReviewTime(props.report.coverageDurationMs)
                : "—"}
            </dd>
          </div>
          <Show when={cacheEvents() > 0}>
            <div>
              <dt class="m-0 text-micro text-text-weaker">Reused work</dt>
              <dd class="m-0 font-mono tabular-nums text-text-strong">
                {props.report.cacheHits} reused · {props.report.cacheMisses} rerun
              </dd>
            </div>
          </Show>
          <Show when={props.report.viewportCount > 0}>
            <div>
              <dt class="m-0 text-micro text-text-weaker">Viewports checked</dt>
              <dd class="m-0 font-mono tabular-nums text-text-strong">
                {props.report.viewportCount}
              </dd>
            </div>
          </Show>
        </dl>
        <Show when={props.report.slowest.length > 0}>
          <div class="grid gap-1.5">
            <strong class="text-caption font-semibold text-text-strong">Slowest checks</strong>
            <ol
              class="m-0 grid list-none border-y border-border-weak-base p-0"
              aria-label="Slowest checks"
            >
              <For each={props.report.slowest}>
                {(check, index) => (
                  <li class="flex items-center justify-between gap-2 border-b border-border-weak-base px-0.5 py-2 text-caption last:border-0">
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
          </div>
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
