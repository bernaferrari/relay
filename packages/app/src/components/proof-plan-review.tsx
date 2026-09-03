import { For, Show, createMemo, createUniqueId, type JSX } from "solid-js";
import type { ChangeVerification, VerificationCell } from "@relay/protocol";
import { cn } from "../lib/cn";
import { eyebrow } from "../lib/ui";
import { humanizeIdentifier, humanizeTitle } from "../lib/humanize-identifier";

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
            {cellCountLabel(summary())} · {summary().required} required · {summary().advisory}{" "}
            advisory
          </p>
        </div>
        <p class="m-0 text-caption text-text-weak">
          {durationLabel(summary().estimatedDurationMs)}
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
              const targetName = () =>
                target()?.targetProfile.name
                  ? capitalize(humanizeTitle(target()!.targetProfile.name))
                  : "Unassigned target";
              return (
                <li
                  class="grid gap-4 rounded-xl bg-surface-base p-4 ring-1 ring-inset ring-border-weak-base"
                  aria-label={`${isPilot() ? "Pilot " : ""}${cell.requirement} verification cell ${index() + 1}: ${journeyName()} on ${targetName()}`}
                  data-proof-plan-cell
                >
                  <div class="flex min-w-0 items-start justify-between gap-4 max-[560px]:flex-col max-[560px]:gap-2">
                    <div class="grid min-w-0 gap-2">
                      <div class="flex flex-wrap items-center gap-1.5">
                        <Show when={isPilot()}>
                          <PlanTag tone="pilot">Pilot</PlanTag>
                        </Show>
                        <PlanTag tone={cell.requirement}>{capitalize(cell.requirement)}</PlanTag>
                      </div>
                      <button
                        type="button"
                        class="-mx-2 grid min-h-11 w-[calc(100%+1rem)] content-center rounded-lg px-2 text-left text-title font-semibold tracking-[-0.01em] text-text-interactive-base transition-colors hover:bg-surface-raised-base-hover hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                        onClick={() => props.onOpenMap(cell.journey.appMapId)}
                      >
                        <span class="break-words">{journeyName()}</span>
                        <span class="sr-only">{cell.journey.testId}</span>
                      </button>
                      <p class="m-0 break-words text-body text-text-base" data-proof-target-summary>
                        On <strong class="font-semibold text-text-strong">{targetName()}</strong>
                        {target() ? ` · ${targetLabel(target()!)}` : " · Target unavailable"}
                      </p>
                    </div>
                    <Show when={knownDurationLabel(cell.estimatedDurationMs)}>
                      {(duration) => (
                        <span class="shrink-0 text-caption tabular-nums text-text-weak">
                          {duration()}
                        </span>
                      )}
                    </Show>
                  </div>

                  <dl class="m-0 grid grid-cols-2 gap-x-6 gap-y-3 max-[700px]:grid-cols-1">
                    <PlanBinding label="Build">{buildLabel(build())}</PlanBinding>
                    <PlanBinding label="Coverage">{dimensionsLabel(cell.dimensions)}</PlanBinding>
                    <PlanBinding label="Evidence">{evidenceLabel(cell, target())}</PlanBinding>
                    <PlanBinding label="Risk and cleanup">
                      {riskLabel(cell)} · Cleanup{" "}
                      {cell.cleanupRequired ? "required" : "not required"}
                    </PlanBinding>
                  </dl>

                  <div class="grid gap-1 border-t border-border-weak-base pt-3">
                    <strong class="text-caption font-semibold text-text-strong">
                      Why selected
                    </strong>
                    <p class="m-0 max-w-[65ch] text-caption/[1.45] text-text-base">
                      {cell.selectionReason}
                    </p>
                    <Show when={riskReason(cell)}>
                      {(reason) => (
                        <p class="m-0 max-w-[65ch] text-caption/[1.45] text-text-weak">
                          {reason()}
                        </p>
                      )}
                    </Show>
                  </div>
                </li>
              );
            }}
          </For>
        </ol>
      </Show>
    </section>
  );
}

function PlanBinding(props: { label: string; children: JSX.Element }) {
  return (
    <div class="grid min-w-0 content-start gap-1">
      <dt class="text-caption font-medium text-text-weak">{props.label}</dt>
      <dd class="m-0 min-w-0 break-words text-body font-medium text-text-strong">
        {props.children}
      </dd>
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

function cellCountLabel(summary: ProofPlanSummary): string {
  return `${summary.total} verification ${summary.total === 1 ? "cell" : "cells"}`;
}

function durationLabel(milliseconds: number | undefined): string {
  if (milliseconds === undefined) return "Timing available after the first run";
  if (milliseconds < 60_000) return "Under 1 minute";
  const minutes = Math.max(1, Math.round(milliseconds / 60_000));
  return minutes === 1 ? "About 1 minute" : `About ${minutes} minutes`;
}

function knownDurationLabel(milliseconds: number | undefined): string | null {
  return milliseconds === undefined ? null : durationLabel(milliseconds);
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
  const configuration = humanizeIdentifier(build.configuration) ?? build.configuration;
  const compactConfiguration = configuration
    .replace(new RegExp(`^${platform}\\s+`, "iu"), "")
    .replace(/^Build\s+/iu, "");
  return `${platform} · ${compactConfiguration}`;
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

function targetLabel(targetCase: ChangeVerification["selection"]["targetCases"][number]): string {
  const profile = targetCase.targetProfile;
  const browser = profile.browserCaseProfile;
  if (browser) {
    const engine = capitalize(browser.engine);
    const locale = dimensionValueLabel("locale", browser.locale);
    const appearance = browser.colorScheme === "dark" ? "Dark" : "Light";
    return `${engine} · ${browser.viewport.width} × ${browser.viewport.height} · ${locale} · ${appearance}`;
  }
  const platform = capitalize(profile.platform);
  const version = profile.osVersion ? `${platform} ${profile.osVersion}` : platform;
  const model = humanizeIdentifier(profile.model) ?? profile.model;
  return [version, model].filter(Boolean).join(" · ");
}
