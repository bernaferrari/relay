import { For, Show, createSignal } from "solid-js";
import type { CampaignRecoveryInterventionModel } from "../lib/campaign-recovery-intervention";
import type { NavigationTransitionRepairEntry } from "../lib/navigation-transition-health";
import { Icon } from "./icon";

export function CampaignRecoveryIntervention(props: {
  intervention: CampaignRecoveryInterventionModel;
  frameSource?: (
    frame: NonNullable<CampaignRecoveryInterventionModel["screenshot"]["frame"]>,
  ) => string;
  onOpenFrame?: (index: number) => void;
  onReviewRepair?: (repair: NavigationTransitionRepairEntry) => void;
  onTeachTransition?: (checkId: string) => void;
  onResume?: (jobId: string) => void;
}) {
  const [leftDeferred, setLeftDeferred] = createSignal(false);
  const screenshotSource = () =>
    props.intervention.screenshot.frame && props.frameSource
      ? props.frameSource(props.intervention.screenshot.frame)
      : undefined;
  return (
    <section
      class="grid gap-3 rounded-xl border border-border-strong-base bg-background-base p-3.5"
      aria-labelledby="campaign-recovery-heading"
    >
      <header class="grid grid-cols-[32px_minmax(0,1fr)] gap-3">
        <span
          class="grid size-8 place-items-center rounded-lg bg-surface-warning-weak text-text-warning-base"
          aria-hidden="true"
        >
          <Icon name="alert" size={15} />
        </span>
        <div class="min-w-0">
          <strong id="campaign-recovery-heading" class="block text-body text-text-strong">
            Relay stopped before resetting this app.
          </strong>
          <p class="mt-1 mb-0 text-caption/[1.45] text-text-weak">{props.intervention.message}</p>
          <p class="mt-1 mb-0 text-micro text-text-weaker">
            {props.intervention.checkTitle} · transition {props.intervention.transitionId}
          </p>
          <p class="mt-0.5 mb-0 text-micro/[1.4] text-text-weaker">{props.intervention.reason}</p>
        </div>
      </header>

      <div class="grid gap-2 sm:grid-cols-[112px_minmax(0,1fr)]">
        <button
          type="button"
          class="grid min-h-24 touch-manipulation place-items-center overflow-hidden rounded-lg border border-border-weak-base bg-surface-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong-focus disabled:cursor-default"
          disabled={props.intervention.screenshot.frameIndex === undefined || !props.onOpenFrame}
          onClick={() => props.onOpenFrame?.(props.intervention.screenshot.frameIndex!)}
          aria-label={`Open stopped-state screenshot: ${props.intervention.screenshot.caption}`}
        >
          <Show
            when={screenshotSource()}
            fallback={<Icon name="camera" size={18} class="text-text-weaker" />}
          >
            <img src={screenshotSource()} alt="" class="size-full object-cover" />
          </Show>
        </button>
        <dl class="m-0 grid content-start gap-1.5 rounded-lg bg-surface-base px-3 py-2.5 text-micro/[1.4]">
          <EvidenceRow
            label="Current state"
            value={
              [props.intervention.current.app, props.intervention.current.header]
                .filter(Boolean)
                .join(" · ") || "Not named"
            }
          />
          <EvidenceRow
            label="Accessibility"
            value={`${props.intervention.current.accessibilityAvailable ? "Available" : "Unavailable"} · ${props.intervention.current.nodeCount} nodes`}
          />
          <EvidenceRow
            label="Tree retained"
            value={`${props.intervention.current.retainedNodeCount} nodes`}
          />
          <EvidenceRow
            label="Screenshot"
            value={`${props.intervention.screenshot.caption}${
              props.intervention.screenshot.width && props.intervention.screenshot.height
                ? ` · ${props.intervention.screenshot.width} × ${props.intervention.screenshot.height}`
                : ""
            }`}
            mono
          />
          <Show when={props.intervention.current.identity}>
            <EvidenceRow label="Fingerprint" value={props.intervention.current.identity!} mono />
          </Show>
        </dl>
      </div>

      <Show when={props.intervention.attempts.length > 0}>
        <details class="group rounded-lg border border-border-weak-base bg-surface-base">
          <summary class="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-caption font-medium text-text-base focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-border-strong-focus [&::-webkit-details-marker]:hidden">
            <span class="tabular-nums">
              Attempted selectors · {props.intervention.attempts.length}
            </span>
            <Icon
              name="chevron-down"
              size={12}
              class="transition-transform motion-reduce:transition-none group-open:rotate-180"
            />
          </summary>
          <ol class="m-0 grid list-decimal gap-2 border-t border-border-weak-base px-3 py-2.5 pl-8">
            <For each={props.intervention.attempts}>
              {(attempt) => (
                <li class="text-micro/[1.4] text-text-base marker:text-text-weaker">
                  <strong class="font-medium text-text-strong">{attempt.kind}</strong>
                  <Show when={attempt.target}> · {attempt.target}</Show>
                  <Show when={attempt.error}>
                    <span class="mt-0.5 block text-text-critical-base">{attempt.error}</span>
                  </Show>
                </li>
              )}
            </For>
          </ol>
        </details>
      </Show>

      <div class="grid gap-1.5 rounded-lg bg-surface-warning-weak px-3 py-2.5">
        <strong class="text-caption font-semibold text-text-strong">
          Proposed cold recovery · not run
        </strong>
        <p class="m-0 break-all font-mono text-micro/[1.45] text-text-weak">
          {props.intervention.recovery.proposedColdRecipeId ?? "No cold recipe was recorded."}
        </p>
        <Show when={props.intervention.recovery.warmRecipeId}>
          <span class="break-all font-mono text-micro/[1.4] text-text-weaker">
            Warm confirmation: {props.intervention.recovery.warmRecipeId}
          </span>
        </Show>
        <span class="text-micro text-text-weaker">
          Automatic resume is not allowed for this intervention.
        </span>
        <Show when={props.intervention.recovery.choices.includes("approve-cold-once")}>
          <span class="mt-1 text-micro/[1.4] text-text-weaker">
            Approve one reset · Unavailable. This run has no operation that can approve or execute a
            reset.
          </span>
        </Show>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="min-h-11 touch-manipulation rounded-lg bg-button-primary-base px-3.5 text-caption font-semibold text-button-primary-text hover:bg-button-primary-base-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong-focus disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!props.intervention.paused || !props.intervention.jobId || !props.onResume}
          onClick={() => {
            const jobId = props.intervention.jobId;
            if (!jobId) return;
            props.onResume?.(jobId);
          }}
        >
          Resume
        </button>
        <button
          type="button"
          class="min-h-11 touch-manipulation rounded-lg px-3 text-caption font-medium text-text-base hover:bg-surface-base-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong-focus disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!props.onReviewRepair}
          onClick={() => props.onReviewRepair?.(props.intervention.repair)}
        >
          Review repair
        </button>
        <button
          type="button"
          class="min-h-11 touch-manipulation rounded-lg px-3 text-caption font-medium text-text-base hover:bg-surface-base-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong-focus disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!props.onTeachTransition}
          onClick={() => props.onTeachTransition?.(props.intervention.checkId)}
        >
          Teach transition
        </button>
        <button
          type="button"
          aria-label="Leave this intervention deferred without changing the run"
          class="min-h-11 touch-manipulation rounded-lg px-3 text-caption font-medium text-text-weak hover:bg-surface-base-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong-focus disabled:cursor-default"
          disabled={leftDeferred()}
          onClick={() => setLeftDeferred(true)}
        >
          {leftDeferred() ? "Deferred" : "Defer"}
        </button>
        <Show when={leftDeferred()}>
          <span class="text-micro text-text-weaker">
            Run unchanged · no reset approved · no automatic resume.
          </span>
        </Show>
      </div>
    </section>
  );
}

function EvidenceRow(props: { label: string; value: string; mono?: boolean }) {
  return (
    <div class="grid grid-cols-[74px_minmax(0,1fr)] gap-2">
      <dt class="text-text-weaker">{props.label}</dt>
      <dd class={props.mono ? "m-0 break-all font-mono text-micro" : "m-0 break-words"}>
        {props.value}
      </dd>
    </div>
  );
}
