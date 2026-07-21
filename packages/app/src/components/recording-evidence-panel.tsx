import { For, Show, type JSX } from "solid-js";
import {
  useServer,
  type RecordedSelectorCandidate,
  type RecordedStepEvidence,
  type StepTarget,
} from "../context/server";
import { cn } from "../lib/cn";
import { defaultStrategy } from "../lib/step-target";
import { Icon } from "./icon";

function candidateIsActive(candidate: RecordedSelectorCandidate, target: StepTarget): boolean {
  if (defaultStrategy(target) !== candidate.strategy) return false;
  switch (candidate.strategy) {
    case "ref":
      return Boolean(candidate.target.ref && candidate.target.ref === target.ref);
    case "label":
      return Boolean(candidate.target.label && candidate.target.label === target.label);
    case "text":
      return Boolean(candidate.target.text && candidate.target.text === target.text);
    case "point":
      return Boolean(
        candidate.target.point &&
        target.point &&
        candidate.target.point.x === target.point.x &&
        candidate.target.point.y === target.point.y &&
        !target.ref &&
        !target.label &&
        !target.text,
      );
  }
}

function candidateValue(candidate: RecordedSelectorCandidate): string {
  if (candidate.target.ref) return candidate.target.ref;
  if (candidate.target.label) return `“${candidate.target.label}”`;
  if (candidate.target.text) return `“${candidate.target.text}”`;
  if (candidate.target.point) return `${candidate.target.point.x}, ${candidate.target.point.y}`;
  return candidate.label;
}

function strategyLabel(strategy: RecordedSelectorCandidate["strategy"]): string {
  if (strategy === "ref") return "Ref";
  if (strategy === "label") return "A11y label";
  if (strategy === "point") return "X, Y";
  return "Text";
}

export function RecordingEvidencePanel(props: {
  evidence: RecordedStepEvidence;
  target?: StepTarget;
  onApply?: (candidate: RecordedSelectorCandidate) => void;
}): JSX.Element {
  const server = useServer();
  const screenshotUrl = () => {
    const shot = props.evidence.screenshot;
    return shot ? server.recordingEvidenceUrl(shot.recipeId, shot.id) : "";
  };

  return (
    <section
      class="min-w-0 overflow-hidden rounded-[10px] border border-[var(--v2-border-border-muted)] bg-[color-mix(in_srgb,var(--v2-background-bg-layer-01)_82%,var(--v2-background-bg-base))]"
      aria-label="Recorded interaction evidence"
    >
      <header class="flex min-h-[34px] items-center justify-between gap-2.5 border-b border-[var(--v2-border-border-muted)] px-2.5">
        <div class="flex min-w-0 items-center gap-1.5 text-[var(--text-base)]">
          <Icon name="camera" size={13} />
          <strong class="text-[10px] font-semibold">Recorded evidence</strong>
        </div>
        <span class="shrink-0 font-mono text-[9px] text-[var(--text-weak)] tabular-nums">
          {new Date(props.evidence.recordedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </span>
      </header>
      <div class="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2.5 p-2.5">
        <Show when={props.evidence.screenshot}>
          <div class="relative aspect-[9/16] w-[76px] overflow-hidden rounded-lg bg-[var(--v2-background-bg-layer-02)] shadow-[inset_0_0_0_1px_var(--v2-border-border-strong)]">
            <img
              src={screenshotUrl()}
              alt="Screen after this recorded interaction"
              class="size-full object-cover"
            />
            <Show when={props.evidence.pointer && props.evidence.deviceBounds}>
              <span
                class="absolute size-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--v2-background-bg-accent)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--v2-background-bg-accent)_28%,transparent)]"
                style={{
                  left: `${(props.evidence.pointer!.x / props.evidence.deviceBounds!.width) * 100}%`,
                  top: `${(props.evidence.pointer!.y / props.evidence.deviceBounds!.height) * 100}%`,
                }}
                aria-hidden="true"
              />
            </Show>
          </div>
        </Show>
        <div class="flex min-w-0 flex-col gap-[7px]">
          <Show when={props.evidence.node}>
            {(node) => (
              <div class="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-[7px]">
                <span class="text-[9px] text-[var(--text-weak)] capitalize">
                  {node().role ?? node().type ?? "Element"}
                </span>
                <strong class="overflow-hidden text-[10px] font-semibold text-ellipsis whitespace-nowrap text-[var(--text-strong)]">
                  {node().label ?? node().value ?? "Unlabelled"}
                </strong>
              </div>
            )}
          </Show>
          <Show when={(props.evidence.candidates?.length ?? 0) > 0}>
            <div
              class="flex max-h-[132px] min-w-0 flex-col gap-0.5 overflow-y-auto"
              role="listbox"
              aria-label="Selector candidates"
            >
              <For each={props.evidence.candidates}>
                {(candidate) => {
                  const active = () => candidateIsActive(candidate, props.target ?? {});
                  return (
                    <button
                      type="button"
                      role="option"
                      class={cn(
                        "grid min-h-[30px] min-w-0 grid-cols-[38px_minmax(0,1fr)_auto] items-center gap-1.5 rounded-md px-[7px] text-left shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)] hover:enabled:bg-surface-raised-base-hover",
                        active() &&
                          "bg-[var(--product-accent-soft)] shadow-[inset_0_0_0_1px_var(--border-interactive-base)]",
                      )}
                      aria-selected={active()}
                      onClick={() => props.onApply?.(candidate)}
                      disabled={!props.onApply}
                    >
                      <span class="text-[9px] text-[var(--text-weak)]">
                        {strategyLabel(candidate.strategy)}
                      </span>
                      <strong class="overflow-hidden font-mono text-[9px] font-medium text-ellipsis whitespace-nowrap text-[var(--text-base)]">
                        {candidateValue(candidate)}
                      </strong>
                      <small class="text-[9px] text-[var(--text-weak)] capitalize">
                        {candidate.source}
                      </small>
                    </button>
                  );
                }}
              </For>
            </div>
          </Show>
          <Show when={props.evidence.serial}>
            <p class="m-0 overflow-hidden font-mono text-[8px] text-ellipsis whitespace-nowrap text-[var(--text-weak)]">
              Captured on {props.evidence.serial}
            </p>
          </Show>
        </div>
      </div>
    </section>
  );
}
