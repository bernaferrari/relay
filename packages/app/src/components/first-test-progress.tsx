import { For, Show, type JSX } from "solid-js";
import type { FirstTestState } from "../lib/onboarding";
import { Icon } from "./icon";

export function FirstTestProgress(props: {
  state: FirstTestState;
  runId?: string;
  onOpenRun?: (id: string) => void;
  onOpenYaml?: () => void;
}): JSX.Element {
  const items = () => [
    { id: "target", label: "Target", done: props.state.targetReady },
    { id: "author", label: "Test", done: props.state.testReady },
    { id: "run", label: "Run", done: props.state.runComplete },
  ];

  return (
    <div
      class="relay-first-progress"
      role="status"
      aria-label="First test progress"
      aria-live="polite"
      data-interactive={props.state.runComplete ? "true" : undefined}
    >
      <span class="relay-first-progress__label">Getting started</span>
      <ol aria-label="Setup steps">
        <For each={items()}>
          {(item) => (
            <li
              aria-label={`${item.label}: ${item.done ? "complete" : props.state.stage === item.id ? "current" : "up next"}`}
              classList={{ "is-done": item.done, "is-current": props.state.stage === item.id }}
            >
              <span aria-hidden="true">{item.done ? <Icon name="check" size={8} /> : null}</span>
              {item.label}
            </li>
          )}
        </For>
      </ol>
      <Show when={props.state.runComplete && props.runId}>
        <div>
          <button type="button" onClick={() => props.onOpenRun?.(props.runId!)}>
            Open report
          </button>
          <button type="button" onClick={props.onOpenYaml}>
            View YAML
          </button>
        </div>
      </Show>
    </div>
  );
}
