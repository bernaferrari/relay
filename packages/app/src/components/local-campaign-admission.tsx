import { For, Show, createMemo } from "solid-js";
import type { CampaignCapacityCohortDurationEvidence } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { cn } from "../lib/cn";
import type {
  LocalCampaignAdmissionDraft,
  LocalCampaignAdmissionPreview,
} from "../lib/local-campaign-admission";
import { Icon } from "./icon";

function durationLabel(milliseconds: number): string {
  if (milliseconds < 60_000) return `${Math.ceil(milliseconds / 1_000)} sec`;
  const minutes = milliseconds / 60_000;
  return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)} min`;
}

function evidenceLabel(evidence: CampaignCapacityCohortDurationEvidence): string {
  const source = evidence.duration.provenance === "observed-p95" ? "p95" : "p50";
  return `${source} · ${durationLabel(evidence.duration.workItemDurationMs)} · ${evidence.duration.sampleCount} samples`;
}

/** The generic local-deadline UI has no duration input: only the server can
 * materialize immutable target × Test/action evidence. */
export function LocalCampaignAdmission(props: {
  bindingCount: number;
  cohortCount: number;
  workItemCount: number;
  workItemNoun: { singular: string; plural: string };
  draft: LocalCampaignAdmissionDraft;
  evidence: readonly CampaignCapacityCohortDurationEvidence[];
  preview?: LocalCampaignAdmissionPreview;
  feedback?: string;
  busy?: boolean;
  loadingEvidence?: boolean;
  checking?: boolean;
  onDraftChange: (patch: Partial<LocalCampaignAdmissionDraft>) => void;
  onRefreshEvidence: () => void;
  onPreflight: () => void;
}) {
  const noun = () =>
    props.workItemCount === 1 ? props.workItemNoun.singular : props.workItemNoun.plural;
  const hasCompleteEvidence = createMemo(
    () => props.cohortCount > 0 && props.evidence.length >= props.cohortCount,
  );
  const ready = createMemo(
    () =>
      Boolean(props.preview) &&
      props.preview!.targetPreflights.length > 0 &&
      props.preview!.targetPreflights.every(
        (target) => target.deadline.achievableWithCurrentCapacity,
      ),
  );

  return (
    <section
      class="grid gap-3 rounded-xl border border-[var(--border-weak-base)] bg-[var(--surface-base)] p-3"
      aria-labelledby="local-admission-title"
    >
      <div class="grid gap-1">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3
              id="local-admission-title"
              class="m-0 text-caption font-semibold text-[var(--text-strong)]"
            >
              Local deadline admission
            </h3>
            <p class="m-0 mt-0.5 text-micro/[1.4] text-[var(--text-weak)]">
              {props.bindingCount} explicit {props.workItemNoun.singular} target
              {props.bindingCount === 1 ? " binding" : " bindings"} for {props.workItemCount}{" "}
              {noun()}. This checks attached Android/iOS lanes only.
            </p>
          </div>
          <span
            class={cn(
              "inline-flex items-center gap-1 text-micro font-medium",
              ready() ? "text-[var(--icon-success-base)]" : "text-[var(--text-weak)]",
            )}
            aria-live="polite"
          >
            <Icon name={ready() ? "check" : "info"} size={11} />
            {ready() ? "Capacity checked" : "Needs a check"}
          </span>
        </div>
        <p class="m-0 text-micro/[1.4] text-[var(--text-weak)]">
          Provider/cloud capacity is not configured in Relay. A preflight is read-only: it never
          reserves a device or queues a run.
        </p>
      </div>

      <fieldset class="grid gap-2 border-0 p-0" disabled={props.busy}>
        <legend class="sr-only">Local campaign deadline</legend>
        <div class="grid gap-2 sm:grid-cols-3">
          <NumberField
            label="Deadline"
            value={props.draft.deadlineMinutes}
            hint="minutes"
            min={1}
            onInput={(deadlineMinutes) => props.onDraftChange({ deadlineMinutes })}
          />
          <NumberField
            label="Setup reserve"
            value={props.draft.setupHeadroomMinutes}
            hint="minutes · optional"
            min={0}
            onInput={(setupHeadroomMinutes) => props.onDraftChange({ setupHeadroomMinutes })}
          />
          <NumberField
            label="Recovery reserve"
            value={props.draft.recoveryHeadroomMinutes}
            hint="minutes · optional"
            min={0}
            onInput={(recoveryHeadroomMinutes) => props.onDraftChange({ recoveryHeadroomMinutes })}
          />
        </div>
      </fieldset>

      <div class="grid gap-2 rounded-lg bg-[var(--background-base)] p-2.5" aria-live="polite">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <strong class="block text-micro font-medium text-[var(--text-strong)]">
              Measured timing evidence
            </strong>
            <span class="block text-micro/[1.4] text-[var(--text-weak)]">
              {props.evidence.length}/{props.cohortCount} target × Test/action cohorts loaded
            </span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            class="min-h-11"
            disabled={props.busy || props.loadingEvidence || props.bindingCount === 0}
            onClick={props.onRefreshEvidence}
          >
            <Icon name="refresh" size={11} />
            {props.loadingEvidence ? "Reading…" : "Refresh timings"}
          </Button>
        </div>
        <Show
          when={props.evidence.length}
          fallback={
            <p class="m-0 text-micro/[1.4] text-[var(--text-weak)]">
              Relay will only use timing evidence measured from persisted successful runs. It will
              not accept a hand-entered duration or sample list.
            </p>
          }
        >
          <ul class="m-0 grid list-none gap-1 p-0">
            <For each={props.evidence}>
              {(item) => (
                <li class="flex items-start gap-1.5 text-micro/[1.4] text-[var(--text-base)]">
                  <Icon
                    name="check"
                    size={11}
                    class="mt-0.5 shrink-0 text-[var(--icon-success-base)]"
                  />
                  <span>
                    <strong class="font-medium">{item.cohort.targetId}</strong> ·{" "}
                    {item.cohort.testId}
                    <span class="text-[var(--text-weak)]"> · {evidenceLabel(item)}</span>
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="m-0 max-w-prose text-micro/[1.4] text-[var(--text-weak)]">
          The final start repeats admission against current target and worker facts, so a stale
          preview cannot over-promise capacity.
        </p>
        <Button
          variant="primary"
          size="sm"
          class="min-h-11"
          disabled={props.busy || props.checking || !hasCompleteEvidence()}
          onClick={props.onPreflight}
        >
          <Icon name="scan" size={11} />
          {props.checking ? "Checking…" : "Check local capacity"}
        </Button>
      </div>

      <Show when={props.feedback}>
        {(message) => (
          <p
            class="m-0 flex items-start gap-1.5 rounded-lg bg-[var(--surface-warning-weak,var(--surface-base))] px-2.5 py-2 text-micro/[1.4] text-[var(--text-base)]"
            role="alert"
          >
            <Icon name="alert" size={11} class="mt-0.5 shrink-0" />
            {message()}
          </p>
        )}
      </Show>

      <Show when={props.preview}>
        {(value) => (
          <div
            class={cn(
              "grid gap-2 rounded-lg border p-2.5",
              ready()
                ? "border-[var(--border-weak-base)]"
                : "border-[var(--icon-critical-base,var(--border-weak-base))]",
            )}
            aria-live="polite"
          >
            <div class="flex items-center gap-1.5 text-micro font-medium text-[var(--text-strong)]">
              <Icon name={ready() ? "check" : "alert"} size={11} />
              {ready()
                ? "The current local snapshot can meet this deadline"
                : "The current local snapshot cannot meet this deadline"}
            </div>
            <ul class="m-0 grid list-none gap-1 p-0">
              <For each={value().targetPreflights}>
                {(target) => (
                  <li class="flex items-start gap-1.5 text-micro/[1.4] text-[var(--text-base)]">
                    <Icon
                      name={target.deadline.achievableWithCurrentCapacity ? "check" : "alert"}
                      size={11}
                      class="mt-0.5 shrink-0"
                    />
                    <span>
                      <strong class="font-medium">{target.target.targetId}</strong> ·{" "}
                      {durationLabel(target.criticalPath.estimatedWorkDurationMs)} work +{" "}
                      {durationLabel(target.deadline.reservedHeadroomMs)} reserve
                      <span class="text-[var(--text-weak)]">
                        {target.scheduled
                          ? " · schedulable now"
                          : " · unavailable in this snapshot"}
                      </span>
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </div>
        )}
      </Show>
    </section>
  );
}

function NumberField(props: {
  label: string;
  value: string;
  hint: string;
  min: number;
  onInput: (value: string) => void;
}) {
  return (
    <label class="grid gap-1 text-micro text-[var(--text-weak)]">
      <span>{props.label}</span>
      <input
        type="number"
        min={props.min}
        step="1"
        inputmode="numeric"
        class="min-h-11 w-full rounded-lg border border-[var(--border-weak-base)] bg-[var(--surface-raised-stronger-non-alpha)] px-2 text-body text-[var(--text-base)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)] disabled:text-[var(--text-weaker)]"
        value={props.value}
        aria-label={`${props.label} in ${props.hint}`}
        onInput={(event) => props.onInput(event.currentTarget.value)}
      />
      <span class="text-micro text-[var(--text-weaker)]">{props.hint}</span>
    </label>
  );
}
