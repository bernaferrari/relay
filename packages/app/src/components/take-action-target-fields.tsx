import { For, type JSX } from "solid-js";
import type { StepTarget } from "@relay/protocol";
import { panelFieldLabel as label } from "../lib/ui";
import { STRATEGIES, type Strategy } from "../lib/step-target";
import { targetValue, targetWithStrategy } from "./take-action-model";

const field =
  "h-11 w-full rounded-lg border border-[var(--border-weak-base)] bg-[var(--surface-base)] px-3 text-body text-[var(--text-strong)] outline-none transition-[border-color,box-shadow] duration-press placeholder:text-[var(--text-weak)] focus-visible:border-[var(--text-interactive-base)] focus-visible:shadow-[0_0_0_2px_color-mix(in_srgb,var(--text-interactive-base)_14%,transparent)]";

/** Selector-strategy editor shared by recorded tap, type, and clipboard actions. */
export function TakeActionTargetFields(props: {
  target: () => StepTarget | undefined;
  strategy: () => Strategy;
  disabled?: boolean;
  onStrategy: (strategy: Strategy) => void;
  onTarget: (target: StepTarget) => void;
}): JSX.Element {
  return (
    <div class="grid grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] gap-2">
      <label class={label}>
        Find by
        <select
          class={field}
          value={props.strategy()}
          disabled={props.disabled}
          onChange={(event) => {
            const next = event.currentTarget.value as Strategy;
            props.onStrategy(next);
            props.onTarget(
              targetWithStrategy(props.target(), next, targetValue(props.target(), next)),
            );
          }}
        >
          <For each={STRATEGIES}>
            {(strategy) => <option value={strategy.id}>{strategy.label}</option>}
          </For>
        </select>
      </label>
      <label class={label}>
        Target
        <input
          class={field}
          value={targetValue(props.target(), props.strategy())}
          placeholder={STRATEGIES.find((item) => item.id === props.strategy())?.placeholder}
          disabled={props.disabled}
          spellcheck={false}
          autocomplete="off"
          onInput={(event) =>
            props.onTarget(
              targetWithStrategy(props.target(), props.strategy(), event.currentTarget.value),
            )
          }
        />
      </label>
    </div>
  );
}
