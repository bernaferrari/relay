import { Show, createEffect, createSignal, type Accessor, type JSX } from "solid-js";
import {
  type RecordedSelectorCandidate,
  type RecipeStep,
  type StepTarget,
} from "../context/server";
import { useWorkbench } from "../context/workbench";
import { defaultStrategy, type Strategy } from "../lib/step-target";
import { cn } from "../lib/cn";
import { mono } from "../lib/ui";
import { RecordingEvidencePanel } from "./recording-evidence-panel";
import { TargetStepEditors } from "./step-editors-target";
import { InteractionStepEditors } from "./step-editors-interaction";
import { FlowStepEditors } from "./step-editors-flow";
import { DeviceStepEditors } from "./step-editors-device";

function isTargetKind(
  step: RecipeStep,
): step is Extract<
  RecipeStep,
  { kind: "tap" | "wait-for" | "wait-response" | "expect" | "extract" }
> {
  return (
    step.kind === "tap" ||
    step.kind === "wait-for" ||
    step.kind === "wait-response" ||
    step.kind === "expect" ||
    step.kind === "extract"
  );
}

export function StepEditor(props: {
  step: Accessor<RecipeStep>;
  index: number;
  autofocus: Accessor<boolean>;
  onAutofocused: () => void;
  onChange: (next: RecipeStep) => void;
  showEvidence?: boolean;
  embedded?: boolean;
}): JSX.Element {
  const wb = useWorkbench();
  const initialStep = props.step();
  const [strategy, setStrategy] = createSignal<Strategy>(
    isTargetKind(initialStep) ? defaultStrategy(initialStep.target) : "label",
  );
  createEffect(() => {
    const step = props.step();
    if (isTargetKind(step)) setStrategy(defaultStrategy(step.target));
  });
  const kind = () => props.step().kind;
  const anno = () => wb.rowAnno(props.index);
  const evidence = () => props.step().evidence;
  const target = (): StepTarget => {
    const step = props.step();
    return isTargetKind(step) ? step.target : {};
  };
  const setTarget = (patch: Partial<StepTarget>) => {
    const step = props.step() as Extract<
      RecipeStep,
      { kind: "tap" | "wait-for" | "wait-response" | "expect" | "extract" }
    >;
    props.onChange({ ...step, target: { ...step.target, ...patch } } as RecipeStep);
  };
  const retargetTap = (id: Strategy) => {
    const step = props.step();
    if (step.kind !== "tap") return;
    const pruned: typeof step.target = {};
    if (id === "ref" && step.target.ref) pruned.ref = step.target.ref;
    else if (id === "label" && step.target.label) pruned.label = step.target.label;
    else if (id === "text" && step.target.text) pruned.text = step.target.text;
    if (step.target.point) pruned.point = step.target.point;
    props.onChange({ ...step, target: pruned });
    setStrategy(id);
  };
  const applyRecordedCandidate = (candidate: RecordedSelectorCandidate) => {
    const step = props.step();
    if (step.kind !== "tap") return;
    props.onChange({ ...step, target: candidate.target });
    setStrategy(candidate.strategy);
  };
  const familyProps = {
    step: props.step,
    autofocus: props.autofocus,
    onAutofocused: props.onAutofocused,
    onChange: props.onChange,
    target,
    strategy,
    onStrategy: setStrategy,
    onPatchTarget: setTarget,
    onRetargetTap: retargetTap,
  };
  return (
    <div
      class={cn(
        "flex w-full min-w-0 flex-col overflow-hidden",
        props.embedded
          ? "gap-1.5"
          : "gap-2.5 border-t border-border-weak-base bg-[color-mix(in_srgb,var(--background-deep)_64%,var(--background-base))] px-3.5 py-3 pl-3.5",
      )}
    >
      <Show when={props.showEvidence !== false && evidence()}>
        {(captured) => (
          <RecordingEvidencePanel
            evidence={captured()}
            target={kind() === "tap" ? target() : undefined}
            onApply={kind() === "tap" ? applyRecordedCandidate : undefined}
          />
        )}
      </Show>
      <TargetStepEditors {...familyProps} />
      <InteractionStepEditors {...familyProps} />
      <FlowStepEditors {...familyProps} />
      <DeviceStepEditors {...familyProps} />
      <Show when={anno().log}>
        <pre
          class={cn(
            mono,
            "max-h-40 w-full overflow-y-auto rounded-md border border-border-weak-base bg-surface-raised-stronger-non-alpha px-2.5 py-2 text-12-regular leading-relaxed break-words whitespace-pre-wrap text-text-weak",
          )}
        >
          {anno().log}
        </pre>
      </Show>
    </div>
  );
}
