import { For, Show } from "solid-js";
import type { DeviceInfo } from "../lib/api-types";
import { presentTarget } from "../lib/target-presentation";
import { cn } from "../lib/cn";
import { Icon } from "./icon";
import { AGENT_MODELS } from "./app-map-agent-types";
import type { AgentStrategy } from "./app-map-agent-types";

function available(device: DeviceInfo): boolean {
  return device.connectionState !== "offline" && device.connectionState !== "unauthorized";
}

export function AppMapAgentSetup(props: {
  goal: string;
  minutes: number;
  strategy: AgentStrategy;
  devices: DeviceInfo[];
  targetIds: string[];
  selectedTargetCount: number;
  modelIds: string[];
  onOpenTargets: () => void;
  onGoal: (value: string) => void;
  onMinutes: (value: number) => void;
  onStrategy: (value: AgentStrategy) => void;
  onTargetIds: (value: string[]) => void;
  onModelIds: (value: string[]) => void;
}) {
  const toggle = (values: string[], id: string): string[] =>
    values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
  const workerCount = () => props.selectedTargetCount * props.modelIds.length;

  return (
    <div class="grid gap-4">
      <section>
        <h2 class="text-display/[1.2] font-semibold tracking-[-0.03em] text-[var(--text-strong)]">
          What should Relay learn?
        </h2>
        <p class="mt-1.5 max-w-[34ch] text-caption/[1.55] text-[var(--text-weak)]">
          It will explore safe visible paths, preserve evidence, and bring every map change back for
          review.
        </p>
      </section>

      <label class="grid gap-1.5">
        <span class="text-micro font-semibold text-[var(--text-base)]">Goal</span>
        <textarea
          class="min-h-24 resize-y rounded-xl border border-[var(--border-strong-base)] bg-[var(--surface-base)] px-3 py-2.5 text-body/[1.5] text-[var(--text-strong)] outline-none transition-[border-color,background-color,box-shadow] duration-150 placeholder:text-[var(--text-weak)] focus:border-[var(--text-interactive-base)] focus:bg-[var(--background-base)] focus:shadow-[0_0_0_3px_var(--product-accent-soft)]"
          value={props.goal}
          placeholder="Map onboarding and find every safe path into settings"
          onInput={(event) => props.onGoal(event.currentTarget.value)}
        />
      </label>

      <Show when={workerCount() > 1}>
        <fieldset class="grid gap-2">
          <legend class="text-micro font-semibold text-[var(--text-base)]">Multiple agents</legend>
          <div class="grid grid-cols-2 gap-1 rounded-xl bg-[var(--surface-base)] p-1">
            <For
              each={
                [
                  ["divide", "Split the work", "Each explores a different area"],
                  ["compare", "Compare results", "Each explores independently"],
                ] as const
              }
            >
              {(option) => (
                <button
                  type="button"
                  class={cn(
                    "grid min-h-14 content-center rounded-lg px-2 text-left transition-[background-color,color,box-shadow] duration-150",
                    props.strategy === option[0] &&
                      "bg-[var(--background-base)] shadow-[0_1px_4px_rgb(0_0_0/12%)]",
                  )}
                  aria-pressed={props.strategy === option[0]}
                  onClick={() => props.onStrategy(option[0])}
                >
                  <strong class="text-caption font-medium text-[var(--text-strong)]">
                    {option[1]}
                  </strong>
                  <small class="mt-0.5 text-micro text-[var(--text-weak)]">{option[2]}</small>
                </button>
              )}
            </For>
          </div>
        </fieldset>
      </Show>

      <fieldset class="grid gap-2">
        <legend class="text-micro font-semibold text-[var(--text-base)]">Time budget</legend>
        <div class="grid grid-cols-3 gap-1 rounded-xl bg-[var(--surface-base)] p-1">
          <For each={[5, 10, 20]}>
            {(value) => (
              <button
                type="button"
                class={cn(
                  "min-h-11 rounded-lg text-caption font-medium text-[var(--text-base)] transition-[background-color,color,box-shadow] duration-150",
                  props.minutes === value &&
                    "bg-[var(--background-base)] text-[var(--text-strong)] shadow-[0_1px_4px_rgb(0_0_0/12%)]",
                )}
                aria-pressed={props.minutes === value}
                onClick={() => props.onMinutes(value)}
              >
                {value} min
              </button>
            )}
          </For>
        </div>
      </fieldset>

      <Show when={props.selectedTargetCount === 0}>
        <button
          type="button"
          class="group flex min-h-14 items-center gap-3 rounded-xl bg-[var(--product-accent-soft)] px-3 text-left shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--text-interactive-base)_20%,transparent)] transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--product-accent-soft)_78%,var(--surface-base-hover))]"
          onClick={props.onOpenTargets}
        >
          <span class="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--background-base)] text-[var(--text-interactive-base)] shadow-[0_1px_4px_rgb(0_0_0/10%)]">
            <Icon name="smartphone" size={15} />
          </span>
          <span class="min-w-0 flex-1">
            <strong class="block text-caption font-semibold text-[var(--text-strong)]">
              Choose where Relay should explore
            </strong>
            <small class="mt-0.5 block text-micro/[1.4] text-[var(--text-weak)]">
              Select one device or several targets to run in parallel.
            </small>
          </span>
          <Icon name="arrow-right" size={13} class="text-[var(--text-interactive-base)]" />
        </button>
      </Show>

      <details class="group border-y border-[var(--border-weak-base)] open:pb-2">
        <summary class="flex min-h-12 cursor-pointer list-none items-center gap-2 px-1 text-caption font-medium text-[var(--text-strong)] hover:text-[var(--text-interactive-base)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--text-interactive-base)]">
          <Icon name="grid" size={14} class="text-[var(--text-weak)]" />
          <span class="flex-1">Coverage</span>
          <span class="font-normal text-[var(--text-weak)]">
            {props.selectedTargetCount} target{props.selectedTargetCount === 1 ? "" : "s"} ·{" "}
            {props.modelIds.length} perspective{props.modelIds.length === 1 ? "" : "s"}
          </span>
          <Icon
            name="chevron-down"
            size={13}
            class="text-[var(--text-weak)] transition-transform duration-150 group-open:rotate-180"
          />
        </summary>
        <div class="grid gap-4 px-1 pb-2 pt-2">
          <fieldset class="grid gap-2">
            <legend class="text-micro font-semibold tracking-[0.06em] text-[var(--text-weak)] uppercase">
              Targets
            </legend>
            <div class="grid gap-1">
              <For
                each={props.devices}
                fallback={
                  <p class="rounded-xl bg-[var(--background-base)] px-3 py-3 text-caption text-[var(--text-weak)]">
                    Connect a device to begin.
                  </p>
                }
              >
                {(device) => {
                  const enabled = () => available(device);
                  const checked = () => props.targetIds.includes(device.serial);
                  return (
                    <label
                      class={cn(
                        "flex min-h-11 items-center gap-2.5 rounded-xl px-2.5 transition-colors duration-150",
                        enabled()
                          ? "cursor-pointer hover:bg-[var(--background-base)]"
                          : "cursor-not-allowed opacity-50",
                      )}
                    >
                      <input
                        type="checkbox"
                        class="size-4 accent-[var(--text-interactive-base)]"
                        checked={checked()}
                        disabled={!enabled()}
                        onChange={() => props.onTargetIds(toggle(props.targetIds, device.serial))}
                      />
                      <Icon name="smartphone" size={14} class="text-[var(--text-weak)]" />
                      <span class="min-w-0 flex-1 truncate text-caption text-[var(--text-strong)]">
                        {presentTarget(device).displayName}
                      </span>
                      <span class="text-micro text-[var(--text-weak)]">
                        {device.platform ?? "device"}
                      </span>
                    </label>
                  );
                }}
              </For>
            </div>
          </fieldset>

          <fieldset class="grid gap-2">
            <legend class="text-micro font-semibold tracking-[0.06em] text-[var(--text-weak)] uppercase">
              Agent perspectives
            </legend>
            <div class="flex flex-wrap gap-1.5">
              <For each={AGENT_MODELS}>
                {(model) => {
                  const selected = () => props.modelIds.includes(model.id);
                  return (
                    <button
                      type="button"
                      class={cn(
                        "min-h-11 rounded-full px-3 text-micro font-medium transition-[background-color,color,box-shadow] duration-150",
                        selected()
                          ? "bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--text-interactive-base)_22%,transparent)]"
                          : "bg-[var(--background-base)] text-[var(--text-base)] shadow-[inset_0_0_0_1px_var(--border-weak-base)] hover:text-[var(--text-strong)]",
                      )}
                      aria-pressed={selected()}
                      onClick={() => props.onModelIds(toggle(props.modelIds, model.id))}
                    >
                      {model.label}
                    </button>
                  );
                }}
              </For>
            </div>
            <p class="text-micro/[1.45] text-[var(--text-weak)]">
              Targets run in parallel. Perspectives sharing one device queue safely and never tap
              over each other. Named models use your OpenRouter connection; Relay falls back to its
              built-in step planner when the cloud model is unavailable.
            </p>
          </fieldset>
        </div>
      </details>

      <div class="grid grid-cols-[18px_minmax(0,1fr)] gap-x-2.5 gap-y-2.5 px-1 text-micro/[1.45] text-[var(--text-base)]">
        <Icon name="check" size={13} class="mt-0.5 text-[var(--icon-success-base)]" />
        <span>Sensitive and irreversible controls remain blocked.</span>
        <Show when={workerCount() > 1}>
          <Icon name="info" size={13} class="mt-0.5 text-[var(--text-weak)]" />
          <span>Independent results return as separate proposals for review.</span>
        </Show>
      </div>
    </div>
  );
}
