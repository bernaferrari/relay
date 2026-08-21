import { For, Show, createMemo } from "solid-js";
import type { LocalAgentDeviceExecutionTargetRef } from "@relay/protocol";
import { executionTargetRefKey } from "@relay/protocol";
import type { LocalExecutionTargetOption } from "../lib/local-execution-targets";
import { Icon } from "./icon";

/** A target-affine select control shared by every local campaign surface. It
 * receives one immutable target ref, never a global selected serial. */
export function LocalExecutionTargetPicker(props: {
  label: string;
  targets: readonly LocalExecutionTargetOption[];
  target?: LocalAgentDeviceExecutionTargetRef;
  busy?: boolean;
  emptyLabel?: string;
  statusNamespace?: "combine";
  onBind: (target?: LocalExecutionTargetOption["target"]) => void;
}) {
  const selectedKey = () => (props.target ? executionTargetRefKey(props.target) : "");
  const selected = createMemo(() =>
    props.targets.find((target) => executionTargetRefKey(target.target) === selectedKey()),
  );
  const status = createMemo(() => {
    if (!props.target) {
      return {
        state: "missing" as const,
        label: "No local execution target",
        detail: "Choose a local Android or iOS target to request deadline admission for this case.",
      };
    }
    if (!selected()) {
      return {
        state: "unavailable" as const,
        label: `Selected target unavailable · ${props.target.targetId}`,
        detail:
          "This saved selection is not an attached local Android or iOS target. Relay will not reinterpret it as local capacity.",
      };
    }
    if (!selected()!.ready) {
      return {
        state: "unavailable" as const,
        label: `Target not ready · ${selected()!.label}`,
        detail: `${selected()!.detail}. Refresh the target before asking Relay to admit it.`,
      };
    }
    return {
      state: "bound" as const,
      label: `Local target · ${selected()!.label}`,
      detail: selected()!.detail,
    };
  });

  return (
    <label class="grid gap-1 text-micro text-[var(--text-weak)]">
      <span
        class="flex items-center gap-1"
        data-local-target-status={status().state}
        data-combine-target-status={
          props.statusNamespace === "combine" ? status().state : undefined
        }
      >
        <Icon name={status().state === "bound" ? "check" : "info"} size={11} class="shrink-0" />
        {status().label}
      </span>
      <select
        class="min-h-11 w-full rounded-lg border border-[var(--border-weak-base)] bg-[var(--surface-raised-stronger-non-alpha)] px-2 text-micro text-[var(--text-base)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)] disabled:text-[var(--text-weaker)]"
        value={selectedKey()}
        aria-label={`${props.label}. ${status().label}.`}
        title={status().detail}
        disabled={props.busy || !props.targets.length}
        onChange={(event) => {
          const next = props.targets.find(
            (target) => executionTargetRefKey(target.target) === event.currentTarget.value,
          );
          props.onBind(next?.ready ? next.target : undefined);
        }}
      >
        <option value="">{props.emptyLabel ?? "Choose local target…"}</option>
        <For each={props.targets}>
          {(target) => (
            <option value={executionTargetRefKey(target.target)} disabled={!target.ready}>
              {target.label} · {target.detail}
            </option>
          )}
        </For>
      </select>
      <Show when={!props.targets.length}>
        <span class="text-micro/[1.35] text-[var(--text-warning-base,var(--text-weak))]">
          No attached local Android or iOS target is available. Provider/cloud capacity is not
          configured in Relay.
        </span>
      </Show>
    </label>
  );
}
