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
    <section class="recorded-evidence" aria-label="Recorded interaction evidence">
      <header>
        <div>
          <Icon name="camera" size={13} />
          <strong>Recorded evidence</strong>
        </div>
        <span>
          {new Date(props.evidence.recordedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </span>
      </header>
      <div class="recorded-evidence__body">
        <Show when={props.evidence.screenshot}>
          <div class="recorded-evidence__shot">
            <img src={screenshotUrl()} alt="Screen after this recorded interaction" />
            <Show when={props.evidence.pointer && props.evidence.deviceBounds}>
              <span
                class="recorded-evidence__pointer"
                style={{
                  left: `${(props.evidence.pointer!.x / props.evidence.deviceBounds!.width) * 100}%`,
                  top: `${(props.evidence.pointer!.y / props.evidence.deviceBounds!.height) * 100}%`,
                }}
                aria-hidden="true"
              />
            </Show>
          </div>
        </Show>
        <div class="recorded-evidence__content">
          <Show when={props.evidence.node}>
            {(node) => (
              <div class="recorded-evidence__node">
                <span>{node().role ?? node().type ?? "Element"}</span>
                <strong>{node().label ?? node().value ?? node().identifier ?? "Unlabelled"}</strong>
              </div>
            )}
          </Show>
          <Show when={(props.evidence.candidates?.length ?? 0) > 0}>
            <div
              class="recorded-evidence__candidates"
              role="listbox"
              aria-label="Selector candidates"
            >
              <For each={props.evidence.candidates}>
                {(candidate) => (
                  <button
                    type="button"
                    role="option"
                    class={cn(candidateIsActive(candidate, props.target ?? {}) && "is-active")}
                    aria-selected={candidateIsActive(candidate, props.target ?? {})}
                    onClick={() => props.onApply?.(candidate)}
                    disabled={!props.onApply}
                  >
                    <span>{candidate.strategy}</span>
                    <strong>{candidateValue(candidate)}</strong>
                    <small>{candidate.source}</small>
                  </button>
                )}
              </For>
            </div>
          </Show>
          <Show when={props.evidence.serial}>
            <p>Captured on {props.evidence.serial}</p>
          </Show>
        </div>
      </div>
    </section>
  );
}
