import { For, Show, createMemo, createUniqueId, type JSX } from "solid-js";
import type { ChangeVerification, VerificationCell } from "@relay/protocol";
import { cn } from "../lib/cn";
import { eyebrow, mono } from "../lib/ui";
import { humanizeIdentifier } from "../lib/humanize-identifier";

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
              const journeyName = () => journeyLabel(cell);
              const targetName = () => target()?.targetProfile.name ?? "Unassigned target";
              return (
                <li
                  class="grid gap-3 rounded-xl bg-surface-base p-3 ring-1 ring-inset ring-border-weak-base"
                  aria-label={`${isPilot() ? "Pilot " : ""}${cell.requirement} verification cell ${index() + 1}: ${journeyName()} on ${targetName()}`}
                  data-proof-plan-cell
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

                  <dl class="m-0 grid grid-cols-2 gap-x-4 gap-y-3 max-[700px]:grid-cols-1">
                    <PlanBinding label="Journey">
                      <button
                        type="button"
                        class="-mx-2 -my-1 grid min-h-11 w-[calc(100%+1rem)] content-center rounded-lg px-2 py-1 text-left text-body font-semibold text-text-interactive-base transition-colors hover:bg-surface-raised-base-hover hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                        onClick={() => props.onOpenMap(cell.journey.appMapId)}
                      >
                        <span class="break-words">{journeyName()}</span>
                        {/* Keep the handle available to existing keyboard/test tooling without
                         * making an internal identifier the primary product label. */}
                        <span class="sr-only">{cell.journey.testId}</span>
                        <small class="break-words text-micro font-normal text-text-weak">
                          App Map journey
                          {cell.journey.appMapRevision
                            ? ` · revision ${cell.journey.appMapRevision}`
                            : ""}
                        </small>
                      </button>
                    </PlanBinding>
                    <PlanBinding label="Build">
                      <strong class="break-words text-body font-semibold text-text-strong">
                        {buildLabel(build())}
                      </strong>
                      <small class="break-words text-micro text-text-weak">
                        {build() ? "Frozen artifact for this journey" : "Build is not available"}
                      </small>
                    </PlanBinding>
                    <PlanBinding label="Target">
                      <strong class="break-words text-body font-semibold text-text-strong">
                        {targetName()}
                      </strong>
                      <small class="break-words text-micro text-text-weak">
                        {target() ? targetLabel(target()!) : "Unavailable"}
                      </small>
                    </PlanBinding>
                    <PlanBinding label="Dimensions">
                      <strong class="break-words text-body font-semibold text-text-strong">
                        {dimensionsLabel(cell.dimensions)}
                      </strong>
                      <small class="break-words text-micro text-text-weak">
                        Exact values frozen for this cell
                      </small>
                    </PlanBinding>
                    <PlanBinding label="Risk">
                      <strong class="break-words text-body font-semibold text-text-strong">
                        {riskLabel(cell)}
                      </strong>
                      <small class="break-words text-micro text-text-weak">
                        {riskReason(cell)}
                      </small>
                    </PlanBinding>
                    <PlanBinding label="Required evidence">
                      <strong class="break-words text-body font-semibold text-text-strong">
                        {evidenceLabel(cell, target())}
                      </strong>
                      <small class="break-words text-micro text-text-weak">
                        {cell.estimatedDurationMs
                          ? `${durationLabel(cell.estimatedDurationMs)} for this evidence`
                          : "Collection policy is checked before run"}
                      </small>
                    </PlanBinding>
                    <PlanBinding label="Visual context">
                      <strong class="break-words text-body font-semibold text-text-strong">
                        {visualContext(target())}
                      </strong>
                      <small class="break-words text-micro text-text-weak">
                        Destination checkpoint from {journeyName()}
                      </small>
                    </PlanBinding>
                  </dl>

                  <div class="grid gap-1 border-t border-border-weak-base pt-3">
                    <strong class="text-caption font-semibold text-text-strong">
                      Why this cell
                    </strong>
                    <p class="m-0 max-w-[65ch] text-caption/[1.45] text-text-base">
                      {cell.selectionReason}
                    </p>
                  </div>
                  <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-micro font-medium text-text-weak">
                    <span>{isPilot() ? "Required pilot" : requirementLabel(cell.requirement)}</span>
                    <span>
                      Cleanup {cell.cleanupRequired ? "must be proved" : "is not required"}
                    </span>
                  </div>
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
                    <DigestFact label="App Map" value={cell.journey.appMapId} />
                    <DigestFact label="Journey" value={cell.journey.testId} />
                    <DigestFact label="Target case" value={cell.targetCaseId} />
                    <DigestFact label="Build" value={cell.buildId} />
                    <DigestFact label="Dimensions" value={JSON.stringify(cell.dimensions)} />
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

function journeyLabel(cell: VerificationCell): string {
  return humanizeIdentifier(cell.journey.testId) ?? "Unnamed journey";
}

function buildLabel(build: ChangeVerification["builds"][number] | undefined): string {
  if (!build) return "Build unavailable";
  const platform = build.platform === "web" ? "Web" : capitalize(build.platform);
  return `${platform} ${build.configuration} build`;
}

function requirementLabel(requirement: VerificationCell["requirement"]): string {
  return requirement === "required" ? "Required coverage" : "Advisory coverage";
}

function dimensionLabel(key: string): string {
  return humanizeIdentifier(key) ?? "Dimension";
}

const languageLabels: Record<string, string> = {
  ar: "Arabic",
  de: "German",
  en: "English",
  es: "Spanish",
  fr: "French",
  he: "Hebrew",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  nl: "Dutch",
  pt: "Portuguese",
  "pt-BR": "Portuguese (Brazil)",
  ro: "Romanian",
  ru: "Russian",
  tr: "Turkish",
  zh: "Chinese",
};

function dimensionValueLabel(key: string, value: string): string {
  if (/language|locale/i.test(key)) {
    const language = languageLabels[value] ?? languageLabels[value.split(/[-_]/u)[0]!];
    if (language) return language;
  }
  return humanizeIdentifier(value) ?? value;
}

function dimensionsLabel(dimensions: Readonly<Record<string, string>>): string {
  const entries = Object.entries(dimensions);
  if (!entries.length) return "Default route";
  return entries
    .map(([key, value]) => `${dimensionLabel(key)}: ${dimensionValueLabel(key, value)}`)
    .join(" · ");
}

function riskLabel(cell: VerificationCell): string {
  return cell.executionRisk ? capitalize(cell.executionRisk.level) : "Risk checked before run";
}

function riskReason(cell: VerificationCell): string {
  const reason = cell.executionRisk?.reasons[0]?.explanation;
  if (reason) return reason;
  if (cell.executionRisk?.cleanupRequired || cell.cleanupRequired) {
    return "Cleanup is part of the reviewed run contract";
  }
  return "No additional execution effects recorded";
}

function evidenceLabel(
  cell: VerificationCell,
  target: ChangeVerification["selection"]["targetCases"][number] | undefined,
): string {
  const dimensionValues = Object.entries(cell.dimensions).map(([key, value]) => `${key}:${value}`);
  const visual = dimensionValues.some((entry) => /visual|screenshot|every-screen/u.test(entry));
  const capabilities = target?.targetProfile.capabilities ?? [];
  if (visual && capabilities.includes("screenshot")) return "Visual screenshots + checks";
  if (capabilities.includes("screenshot") && capabilities.includes("snapshot")) {
    return "Screenshots + semantic checks";
  }
  if (capabilities.includes("screenshot")) return "Screenshot evidence";
  if (capabilities.includes("snapshot")) return "Semantic checks";
  return "Run evidence required";
}

function visualContext(
  target: ChangeVerification["selection"]["targetCases"][number] | undefined,
): string {
  if (!target) return "Target context unavailable";
  const profile = target.targetProfile;
  const browser = profile.browserCaseProfile;
  if (browser) {
    const viewport = `${browser.viewport.width} × ${browser.viewport.height}`;
    const color = browser.colorScheme === "dark" ? "dark theme" : "light theme";
    const input = browser.touch || browser.mobile ? "touch layout" : "pointer layout";
    return `${viewport} · ${color} · ${input}`;
  }
  return (
    [profile.platform, profile.model, profile.osVersion].filter(Boolean).join(" · ") ||
    "Device profile"
  );
}

function targetLabel(targetCase: ChangeVerification["selection"]["targetCases"][number]): string {
  const profile = targetCase.targetProfile;
  const browser = profile.browserCaseProfile;
  if (browser) {
    return `${browser.engine} · ${browser.viewport.width} × ${browser.viewport.height} · ${browser.locale}`;
  }
  return [profile.platform, profile.model, profile.osVersion].filter(Boolean).join(" · ");
}
