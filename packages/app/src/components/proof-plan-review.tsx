import { For, Show, createMemo, createUniqueId, type JSX } from "solid-js";
import type { ChangeVerification, VerificationCell } from "@relay/protocol";
import { cn } from "../lib/cn";
import { eyebrow, mono } from "../lib/ui";

export type ProofPlanSummary = Readonly<{
  total: number;
  required: number;
  advisory: number;
  estimatedDurationMs: number | undefined;
}>;

export function proofPlanSummary(proof: ChangeVerification): ProofPlanSummary {
  const cells = proof.selection.cells ?? [];
  const durations = cells.map(({ estimatedDurationMs }) => estimatedDurationMs);
  return {
    total: cells.length,
    required: cells.filter(({ requirement }) => requirement === "required").length,
    advisory: cells.filter(({ requirement }) => requirement === "advisory").length,
    estimatedDurationMs:
      durations.length > 0 && durations.every((duration) => duration !== undefined)
        ? durations.reduce<number>((total, duration) => total + duration!, 0)
        : undefined,
  };
}

export function ProofPlanReview(props: {
  proof: ChangeVerification;
  onOpenMap: (appMapId: string) => void;
}) {
  const headingId = createUniqueId();
  const cells = () => props.proof.selection.cells ?? [];
  const summary = createMemo(() => proofPlanSummary(props.proof));
  const targetCases = createMemo(
    () => new Map(props.proof.selection.targetCases.map((target) => [target.id, target])),
  );
  const builds = createMemo(() => new Map(props.proof.builds.map((build) => [build.id, build])));

  return (
    <section class="grid gap-3" aria-labelledby={headingId}>
      <div class="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div class="grid gap-1">
          <h3 id={headingId} class={cn(eyebrow, "m-0")}>
            Verification plan
          </h3>
          <p class="m-0 text-body text-text-base">
            {cellCountLabel(summary())} · {durationLabel(summary().estimatedDurationMs)}
          </p>
        </div>
        <p class="m-0 text-caption text-text-weak">
          {summary().required} required · {summary().advisory} advisory
        </p>
      </div>

      <Show
        when={cells().length > 0}
        fallback={
          <p class="m-0 rounded-xl bg-surface-base px-3 py-3 text-body/[1.45] text-text-weak ring-1 ring-inset ring-border-weak-base">
            The exact journey, build, and target cells have not been frozen yet.
          </p>
        }
      >
        <ol
          class="m-0 grid list-none gap-2 p-0"
          aria-label="Verification plan cells"
          data-proof-plan-cells
        >
          <For each={cells()}>
            {(cell, index) => {
              const target = () => targetCases().get(cell.targetCaseId);
              const build = () => builds().get(cell.buildId);
              const isPilot = () => props.proof.selection.pilotCellId === cell.id;
              return (
                <li
                  class="grid gap-3 rounded-xl bg-surface-base p-3 ring-1 ring-inset ring-border-weak-base"
                  aria-label={`${isPilot() ? "Pilot " : ""}${cell.requirement} cell ${index() + 1}: ${cell.journey.testId}`}
                >
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <div class="flex flex-wrap items-center gap-1.5">
                      <Show when={isPilot()}>
                        <PlanTag tone="pilot">Pilot</PlanTag>
                      </Show>
                      <PlanTag tone={cell.requirement}>{capitalize(cell.requirement)}</PlanTag>
                    </div>
                    <span class={cn("text-caption tabular-nums text-text-weak", mono)}>
                      {durationLabel(cell.estimatedDurationMs)}
                    </span>
                  </div>

                  <dl class="m-0 grid grid-cols-3 gap-3 max-[700px]:grid-cols-1">
                    <PlanBinding label="Journey">
                      <button
                        type="button"
                        class="-mx-2 -my-1 grid min-h-11 w-[calc(100%+1rem)] content-center rounded-lg px-2 py-1 text-left text-body font-semibold text-text-interactive-base transition-colors hover:bg-surface-raised-base-hover hover:underline"
                        onClick={() => props.onOpenMap(cell.journey.appMapId)}
                      >
                        <span class="break-words">{cell.journey.testId}</span>
                        <small class="break-words text-micro font-normal text-text-weak">
                          {cell.journey.appMapId}
                          {cell.journey.appMapRevision
                            ? ` · revision ${cell.journey.appMapRevision}`
                            : ""}
                        </small>
                      </button>
                    </PlanBinding>
                    <PlanBinding label="Build">
                      <strong class="break-words text-body font-semibold text-text-strong">
                        {cell.buildId}
                      </strong>
                      <small class="break-words text-micro text-text-weak">
                        {build()
                          ? `${build()!.platform} · ${build()!.configuration}`
                          : "Unavailable"}
                      </small>
                    </PlanBinding>
                    <PlanBinding label="Target">
                      <strong class="break-words text-body font-semibold text-text-strong">
                        {cell.targetCaseId}
                      </strong>
                      <small class="break-words text-micro text-text-weak">
                        {target() ? targetLabel(target()!) : "Unavailable"}
                      </small>
                    </PlanBinding>
                  </dl>

                  <p class="m-0 max-w-[65ch] text-caption/[1.45] text-text-base">
                    {cell.selectionReason}
                  </p>
                  <span class="text-micro font-medium text-text-weak">
                    Cleanup {cell.cleanupRequired ? "must be proved" : "is not required"}
                  </span>
                </li>
              );
            }}
          </For>
        </ol>
      </Show>

      <details class="rounded-xl bg-surface-base px-3 py-2.5 text-caption text-text-weak ring-1 ring-inset ring-border-weak-base">
        <summary class="min-h-11 cursor-pointer select-none py-3 font-medium text-text-base">
          Technical plan identity
        </summary>
        <dl class={cn("m-0 grid gap-2 pb-1 pt-2", mono)}>
          <DigestFact label="Policy digest" value={props.proof.policyDigest} />
          <DigestFact label="Plan digest" value={props.proof.planDigest} />
          <DigestFact label="Decision digest" value={props.proof.decisionDigest} />
          <For each={cells()}>
            {(cell) => (
              <div class="grid gap-1 border-t border-border-weak-base pt-2">
                <dt class="break-all text-caption font-semibold text-text-base">{cell.id}</dt>
                <dd class="m-0">
                  <dl class="m-0 grid gap-1">
                    <DigestFact label="Route variant" value={cell.routeVariantDigest} />
                    <DigestFact label="Evidence policy" value={cell.evidencePolicyDigest} />
                    <DigestFact label="Execution risk" value={cell.executionRiskDigest} />
                    <DigestFact
                      label="Build artifact"
                      value={builds().get(cell.buildId)?.artifactDigest}
                    />
                  </dl>
                </dd>
              </div>
            )}
          </For>
        </dl>
      </details>
    </section>
  );
}

function PlanBinding(props: { label: string; children: JSX.Element }) {
  return (
    <div class="grid min-w-0 content-start gap-0.5">
      <dt class={cn(eyebrow, "text-text-weaker")}>{props.label}</dt>
      <dd class="m-0 grid min-w-0">{props.children}</dd>
    </div>
  );
}

function PlanTag(props: {
  tone: VerificationCell["requirement"] | "pilot";
  children: JSX.Element;
}) {
  return (
    <span
      class={cn(
        "inline-flex h-[22px] items-center rounded-md px-2 text-caption font-semibold ring-1 ring-inset",
        props.tone === "required"
          ? "bg-surface-interactive-weak text-text-interactive-base ring-border-interactive-base/40"
          : props.tone === "advisory"
            ? "bg-surface-warning-weak text-text-warning-base ring-border-warning-base/40"
            : "bg-surface-raised-strong text-text-base ring-border-weak-base",
      )}
    >
      {props.children}
    </span>
  );
}

function DigestFact(props: { label: string; value: string | undefined }) {
  return (
    <div class="grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] gap-2 max-[560px]:grid-cols-1 max-[560px]:gap-0.5">
      <dt class="text-text-weaker">{props.label}</dt>
      <dd class="m-0 break-all text-text-base">{props.value ?? "Not recorded"}</dd>
    </div>
  );
}

function cellCountLabel(summary: ProofPlanSummary): string {
  return `${summary.total} verification ${summary.total === 1 ? "cell" : "cells"}`;
}

function durationLabel(milliseconds: number | undefined): string {
  if (milliseconds === undefined) return "Duration confirmed at run time";
  if (milliseconds < 60_000) return "Under 1 minute";
  const minutes = Math.max(1, Math.round(milliseconds / 60_000));
  return minutes === 1 ? "About 1 minute" : `About ${minutes} minutes`;
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function targetLabel(targetCase: ChangeVerification["selection"]["targetCases"][number]): string {
  const profile = targetCase.targetProfile;
  const browser = profile.browserCaseProfile;
  if (browser) {
    return `${browser.engine} · ${browser.viewport.width} × ${browser.viewport.height} · ${browser.locale}`;
  }
  return [profile.platform, profile.model, profile.osVersion].filter(Boolean).join(" · ");
}
