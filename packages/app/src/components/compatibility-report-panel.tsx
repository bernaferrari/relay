import { For, Show } from "solid-js";
import type { CompatibilityReport } from "@relay/protocol";
import { cn } from "../lib/cn";
import { eyebrow, productStatus } from "../lib/ui";

function formatPassDelta(value: number | null): string {
  if (value == null) return "no pass-rate comparison yet";
  const points = Math.round(value * 100);
  return `${points > 0 ? "+" : ""}${points} pts`;
}

function formatDurationDelta(value: number | null): string {
  if (value == null) return "no duration comparison yet";
  const seconds = value / 1000;
  return `${seconds > 0 ? "+" : ""}${seconds.toFixed(1)}s`;
}

export function CompatibilityReportPanel(props: {
  report: CompatibilityReport | null;
  selectedProfileId: string;
}) {
  return (
    <Show
      when={props.report}
      fallback={
        <div class="rounded-xl border border-dashed border-[var(--border-weak-base)] px-3 py-4 text-center text-caption text-[var(--text-weak)]">
          Preparing the comparison…
        </div>
      }
    >
      {(report) => (
        <div class="grid gap-3">
          <header class="flex items-start justify-between gap-3">
            <div>
              <span class={eyebrow}>Compatibility matrix</span>
              <strong class="mt-0.5 block text-body text-[var(--text-strong)]">
                {report().matrixName ?? "Target comparison"}
              </strong>
              <small class="mt-0.5 block text-micro text-[var(--text-weak)]">
                {report().profiles.length} target{report().profiles.length === 1 ? "" : "s"} ·{" "}
                {report().total} evidence run{report().total === 1 ? "" : "s"}
              </small>
            </div>
            <span class="shrink-0 rounded-full border border-[var(--border-weak-base)] px-[7px] py-1 text-micro tracking-[0.08em] text-[var(--text-weak)] uppercase">
              Same test setup
            </span>
          </header>
          <div class="grid gap-2">
            <For each={report().profiles}>
              {(profile) => (
                <article
                  class={cn(
                    "grid gap-2.5 rounded-xl border border-[var(--border-weak-base)] bg-[color-mix(in_srgb,var(--surface-base)_55%,transparent)] p-3",
                    profile.profile.id === props.selectedProfileId &&
                      "border-border-interactive-base bg-surface-interactive-weak",
                  )}
                >
                  <header class="flex items-start justify-between gap-3">
                    <div>
                      <strong class="block text-body text-[var(--text-strong)]">
                        {profile.profile.name}
                      </strong>
                      <small class="mt-0.5 block text-micro text-[var(--text-weak)]">
                        {profile.profile.platform}
                        {profile.profile.osVersion ? ` · ${profile.profile.osVersion}` : ""}
                      </small>
                    </div>
                    <span class={productStatus(profile.passRate === 1 ? "ok" : "error")}>
                      {profile.passRate == null
                        ? "Pending"
                        : `${Math.round(profile.passRate * 100)}%`}
                    </span>
                  </header>
                  <div class="grid grid-cols-2 gap-2">
                    <span class="grid gap-0.5 rounded-lg bg-[var(--background-base)] p-2">
                      <b class="text-micro font-medium tracking-[0.08em] text-[var(--text-weak)] uppercase">
                        Pass rate
                      </b>
                      <strong class="text-caption text-[var(--text-strong)]">
                        {profile.passRate == null
                          ? "No product verdict yet"
                          : `${Math.round(profile.passRate * 100)}%`}
                      </strong>
                    </span>
                    <span class="grid gap-0.5 rounded-lg bg-[var(--background-base)] p-2">
                      <b class="text-micro font-medium tracking-[0.08em] text-[var(--text-weak)] uppercase">
                        Median duration
                      </b>
                      <strong class="text-caption text-[var(--text-strong)]">
                        {profile.medianDurationMs == null
                          ? "—"
                          : `${(profile.medianDurationMs / 1000).toFixed(1)}s`}
                      </strong>
                    </span>
                  </div>
                  <p class="m-0 text-micro/[1.45] text-[var(--text-base)]">
                    {profile.passed} passed · {profile.productFailures} product ·{" "}
                    {profile.harnessFailures} harness
                    {profile.uncertain ? ` · ${profile.uncertain} uncertain` : ""}
                    {profile.pending ? ` · ${profile.pending} pending` : ""}
                  </p>
                  <Show when={profile.baseline}>
                    {(baseline) => (
                      <footer class="border-t border-[var(--border-weak-base)] pt-2 text-micro/[1.4] text-[var(--text-weak)]">
                        Versus {baseline().total} earlier run{baseline().total === 1 ? "" : "s"}:{" "}
                        {formatPassDelta(baseline().passRateDelta)} ·{" "}
                        {formatDurationDelta(baseline().durationDeltaMs)}
                      </footer>
                    )}
                  </Show>
                </article>
              )}
            </For>
          </div>
        </div>
      )}
    </Show>
  );
}
