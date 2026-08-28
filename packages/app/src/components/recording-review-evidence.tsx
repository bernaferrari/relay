import { Show, createMemo } from "solid-js";
import type { RecordingTake, RecordingTakeAction } from "../context/recorder";
import { cn } from "../lib/cn";
import { describeTakeAction } from "./take-action-model";
import { OrientedScreenshot } from "./oriented-screenshot";
import { authoringProofStatusChip, StatusChip } from "./status-chip";

export function isRecordingCheckpoint(action: RecordingTakeAction): boolean {
  return action.steps.length === 0 && Boolean(action.evidenceUrl ?? action.exitEvidenceUrl);
}

function EvidenceFrame(props: {
  label: string;
  src?: string;
  viewport?: { width: number; height: number };
  platform: RecordingTake["platform"];
  prominent?: boolean;
}) {
  const aspectRatio = () => {
    const viewport = props.viewport;
    return viewport && viewport.width > 0 && viewport.height > 0
      ? viewport.width / viewport.height
      : 9 / 19.5;
  };
  return (
    <figure class="m-0 grid min-w-0 content-start gap-2">
      <figcaption class="text-micro font-semibold tracking-[0.1em] text-text-weak uppercase">
        {props.label}
      </figcaption>
      <div
        class={cn(
          "relative mx-auto w-full overflow-hidden rounded-xl border border-border-weak-base bg-[var(--phone-screen)]",
          props.prominent ? "max-w-[360px]" : "max-w-[300px]",
        )}
        style={{ "aspect-ratio": String(aspectRatio()) }}
      >
        <Show
          when={props.src}
          fallback={
            <div class="grid size-full place-items-center px-3 text-center text-micro/[1.45] text-text-weak">
              This boundary was not captured.
            </div>
          }
        >
          {(src) => (
            <OrientedScreenshot
              class="size-full object-contain"
              src={src()}
              alt={`${props.label} recording evidence`}
              evidence={{
                platform: props.platform,
                ...(props.viewport ? { logicalViewport: props.viewport } : {}),
              }}
            />
          )}
        </Show>
      </div>
    </figure>
  );
}

/** One selected action projected from the existing immutable Take. It does
 * not infer adjacent frames: missing action boundaries stay visibly missing. */
export function RecordingReviewEvidence(props: { take: RecordingTake; selectedActionId?: string }) {
  const selectedAction = createMemo(
    () =>
      props.take.actions.find((action) => action.id === props.selectedActionId) ??
      props.take.actions[0],
  );
  const title = () => {
    const action = selectedAction();
    return action ? action.label?.trim() || describeTakeAction(action) : "No recorded action";
  };
  const proof = () => {
    const action = selectedAction();
    return action?.proof ? authoringProofStatusChip(action.proof) : undefined;
  };

  return (
    <section
      class="grid min-h-full place-items-center px-5 py-6"
      aria-label="Selected recording evidence"
    >
      <Show
        when={selectedAction()}
        fallback={
          <div class="max-w-[38ch] text-center">
            <strong class="block text-title font-semibold text-text-strong">
              No actions captured
            </strong>
            <p class="m-0 mt-1 text-caption/[1.5] text-text-weak">
              Record an interaction or add a checkpoint to create reviewable evidence.
            </p>
          </div>
        }
      >
        {(action) => (
          <div class="grid w-full max-w-[1040px] gap-4">
            <header class="mx-auto max-w-[64ch] text-center">
              <span class="text-micro font-semibold tracking-[0.11em] text-text-weak uppercase">
                {isRecordingCheckpoint(action()) ? "Checkpoint evidence" : "Recorded action proof"}
              </span>
              <h2 class="m-0 mt-1 text-title font-semibold tracking-[-0.018em] text-text-strong">
                {title()}
              </h2>
              <Show when={proof()}>
                {(status) => (
                  <span class="mt-2 inline-flex">
                    <StatusChip tone={status().tone} label={status().label} />
                  </span>
                )}
              </Show>
            </header>

            <div
              class={cn(
                "grid items-center gap-4",
                isRecordingCheckpoint(action())
                  ? "grid-cols-[minmax(0,1fr)_minmax(180px,0.62fr)_minmax(0,1fr)] max-[880px]:grid-cols-1"
                  : "grid-cols-[minmax(0,1fr)_minmax(190px,0.72fr)_minmax(0,1fr)] max-[880px]:grid-cols-1",
              )}
            >
              <EvidenceFrame
                label="Before"
                src={action().entranceEvidenceUrl}
                viewport={action().entranceViewport}
                platform={props.take.platform}
              />

              <article
                class={cn(
                  "grid min-h-32 content-center gap-2 rounded-2xl border border-border-weak-base bg-background-base px-4 py-5 text-center shadow-[0_12px_34px_-28px_rgb(0_0_0/50%)]",
                  isRecordingCheckpoint(action()) && "min-h-44 border-border-interactive-base",
                )}
                aria-label="Recorded action"
              >
                <span class="text-micro font-semibold tracking-[0.1em] text-text-weak uppercase">
                  Action
                </span>
                <strong class="text-caption/[1.45] font-semibold text-text-strong">
                  {title()}
                </strong>
                <p class="m-0 text-micro/[1.45] text-text-weak">
                  {action().proof?.source === "replay"
                    ? "Proved by the latest replay of this exact revision."
                    : "Captured with this immutable recording revision."}
                </p>
              </article>

              <EvidenceFrame
                label="After"
                src={action().exitEvidenceUrl ?? action().evidenceUrl}
                viewport={action().exitViewport}
                platform={props.take.platform}
                prominent={isRecordingCheckpoint(action())}
              />
            </div>

            <Show when={action().proof?.error}>
              <p class="m-0 mx-auto max-w-[65ch] rounded-lg border border-border-critical-base bg-surface-critical-weak px-3 py-2 text-caption/[1.45] text-text-critical-base">
                {action().proof?.error}
              </p>
            </Show>
          </div>
        )}
      </Show>
    </section>
  );
}
