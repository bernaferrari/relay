import { For, Show } from "solid-js";
import {
  dataSourceModeOptions,
  type DataSourceMode,
  type DataValueScope,
} from "../lib/data-source-mode";

export function DataSourceControl(props: {
  scope: DataValueScope;
  mode: DataSourceMode;
  class: string;
  onModeChange: (mode: DataSourceMode) => void;
}) {
  return (
    <Show when={props.scope === "shared"}>
      <label class="grid gap-1.5">
        <span class="text-[11px]/[1.25] font-semibold text-text-weak">How to choose it</span>
        <select
          class={props.class}
          value={props.mode}
          onChange={(event) => props.onModeChange(event.currentTarget.value as DataSourceMode)}
        >
          <For each={dataSourceModeOptions}>
            {(option) => <option value={option.value}>{option.label}</option>}
          </For>
        </select>
      </label>
    </Show>
  );
}
