import { For, Show } from "solid-js";
import type { CompatibilityMatrix, TargetCapability, TargetProfile } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { cn } from "../lib/cn";
import { toggleListValue, type MatrixSelectorDraft } from "../lib/compatibility-matrix-draft";
import { platformLabel } from "../lib/target-presentation";

const inputCls =
  "h-8 w-full rounded-md border border-border-weak-base bg-surface-raised-stronger-non-alpha px-2.5 text-12-regular text-text-strong focus:border-border-focus focus:outline-none";
const rowTitleCls = "text-12-medium text-text-strong";
export const matrixPlatforms: TargetProfile["platform"][] = ["android", "ios", "browser"];
export const matrixCapabilities: TargetCapability[] = [
  "screenshot",
  "stream",
  "recording",
  "tap",
  "type",
  "clipboard",
  "network",
  "logs",
  "lock-screen",
  "app-switcher",
];

export function readableCapability(capability: TargetCapability): string {
  const labels: Partial<Record<TargetCapability, string>> = {
    screenshot: "Screenshots",
    stream: "Live view",
    recording: "Recording",
    tap: "Tap",
    type: "Text input",
    clipboard: "Clipboard",
    network: "Network logs",
    logs: "Device logs",
    "lock-screen": "Lock screen",
    "app-switcher": "App switching",
  };
  return labels[capability] ?? capability;
}

export function matrixSummary(matrix: CompatibilityMatrix): string {
  const selector = matrix.selectors[0];
  if (!selector) return "No matching rules";
  const suffix =
    matrix.selectors.length > 1
      ? ` · +${matrix.selectors.length - 1} additional rule${matrix.selectors.length === 2 ? "" : "s"}`
      : "";
  if (selector.targetIds?.length) {
    return `${selector.targetIds.length} chosen target${selector.targetIds.length === 1 ? "" : "s"}${suffix}`;
  }
  const parts = [
    selector.platforms?.map(platformLabel).join(", "),
    selector.osVersionPrefixes?.length ? `OS ${selector.osVersionPrefixes.join(", ")}` : undefined,
    selector.nameIncludes?.length ? selector.nameIncludes.join(", ") : undefined,
    selector.requiredCapabilities?.length
      ? `${selector.requiredCapabilities.length} ${selector.requiredCapabilities.length === 1 ? "capability" : "capabilities"}`
      : undefined,
  ].filter(Boolean);
  return `${parts.join(" · ") || "Custom matching rules"}${suffix}`;
}

export function MatrixRuleFields(props: {
  draft: MatrixSelectorDraft;
  onChange: (draft: MatrixSelectorDraft) => void;
}) {
  const update = (patch: Partial<MatrixSelectorDraft>) =>
    props.onChange({ ...props.draft, ...patch });
  return (
    <div class="grid gap-3">
      <fieldset class="m-0 border-0 p-0">
        <legend class={rowTitleCls}>Platform</legend>
        <div class="mt-2 flex flex-wrap gap-1.5">
          <For each={matrixPlatforms}>
            {(platformName) => (
              <label class="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border-weak-base px-2.5 py-1 text-11-regular text-text-weak hover:border-border-strong-base hover:text-text-strong has-[:checked]:border-border-focus has-[:checked]:bg-[var(--product-accent-soft)] has-[:checked]:text-text-strong has-[:focus-visible]:outline has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-offset-2">
                <input
                  class="sr-only"
                  type="checkbox"
                  checked={props.draft.platforms.includes(platformName)}
                  onChange={() =>
                    update({
                      platforms: toggleListValue(props.draft.platforms, platformName),
                    })
                  }
                />
                {platformLabel(platformName)}
              </label>
            )}
          </For>
        </div>
      </fieldset>
      <label class="flex flex-col gap-1.5">
        <span class={rowTitleCls}>OS versions</span>
        <input
          data-focus-contained
          class={inputCls}
          value={props.draft.osVersionPrefixes}
          placeholder="For example, 18, 19"
          autocomplete="off"
          spellcheck={false}
          onInput={(event) => update({ osVersionPrefixes: event.currentTarget.value })}
        />
        <span class="text-10-regular text-text-weak">
          Optional. Prefix matching includes minor releases such as 18.1.
        </span>
      </label>
      <label class="flex flex-col gap-1.5">
        <span class={rowTitleCls}>Device name or model</span>
        <input
          data-focus-contained
          class={inputCls}
          value={props.draft.nameIncludes}
          placeholder="For example, iPhone, Pixel, Chrome"
          autocomplete="off"
          spellcheck={false}
          onInput={(event) => update({ nameIncludes: event.currentTarget.value })}
        />
        <span class="text-10-regular text-text-weak">
          Optional. Separate alternatives with commas.
        </span>
      </label>
      <fieldset class="m-0 border-0 p-0">
        <legend class={rowTitleCls}>Must support</legend>
        <div class="mt-2 flex flex-wrap gap-1.5">
          <For each={matrixCapabilities}>
            {(capability) => (
              <label class="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border-weak-base px-2.5 py-1 text-11-regular text-text-weak hover:border-border-strong-base hover:text-text-strong has-[:checked]:border-border-focus has-[:checked]:bg-[var(--product-accent-soft)] has-[:checked]:text-text-strong has-[:focus-visible]:outline has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-offset-2">
                <input
                  class="sr-only"
                  type="checkbox"
                  checked={props.draft.capabilities.includes(capability)}
                  onChange={() =>
                    update({
                      capabilities: toggleListValue(props.draft.capabilities, capability),
                    })
                  }
                />
                {readableCapability(capability)}
              </label>
            )}
          </For>
        </div>
      </fieldset>
    </div>
  );
}

export function MatrixSelectorEditor(props: {
  index: number;
  draft: MatrixSelectorDraft;
  profiles: TargetProfile[];
  onChange: (draft: MatrixSelectorDraft) => void;
  onRemove: () => void;
}) {
  const update = (patch: Partial<MatrixSelectorDraft>) =>
    props.onChange({ ...props.draft, ...patch });
  return (
    <div class="grid gap-2.5 rounded-lg border border-border-weak-base bg-background-base p-2.5">
      <div class="flex items-center justify-between gap-2">
        <strong class="text-11-medium text-text-strong">Rule {props.index}</strong>
        <Button variant="ghost" size="sm" type="button" onClick={props.onRemove}>
          Remove
        </Button>
      </div>
      <div
        class="grid grid-cols-2 gap-1 rounded-md bg-surface-raised-stronger-non-alpha p-1"
        role="group"
        aria-label={`How rule ${props.index} finds targets`}
      >
        {(
          [
            ["targets", "Choose devices"],
            ["rules", "Match automatically"],
          ] as const
        ).map(([mode, label]) => (
          <button
            type="button"
            aria-pressed={props.draft.mode === mode}
            class={cn(
              "h-7 rounded text-10-medium transition-colors",
              props.draft.mode === mode
                ? "bg-surface-base text-text-strong shadow-sm"
                : "text-text-weak hover:text-text-strong",
            )}
            onClick={() => update({ mode })}
          >
            {label}
          </button>
        ))}
      </div>
      <Show when={props.draft.mode === "targets"}>
        <div class="grid max-h-36 gap-0.5 overflow-y-auto rounded-md border border-border-weak-base p-1">
          <Show
            when={props.profiles.length > 0}
            fallback={<span class="p-2 text-11-regular text-text-weak">No targets available.</span>}
          >
            <For each={props.profiles}>
              {(profile) => (
                <label class="flex min-h-8 cursor-pointer items-center gap-2 rounded px-1.5 text-11-regular text-text-strong hover:bg-surface-raised-stronger-non-alpha">
                  <input
                    type="checkbox"
                    checked={props.draft.targetIds.includes(profile.targetId)}
                    onChange={() =>
                      update({
                        targetIds: toggleListValue(props.draft.targetIds, profile.targetId),
                      })
                    }
                  />
                  <span class="min-w-0 flex-1 truncate">{profile.name}</span>
                  <span class="text-10-regular text-text-weak">
                    {platformLabel(profile.platform)}
                  </span>
                </label>
              )}
            </For>
          </Show>
        </div>
      </Show>
      <Show when={props.draft.mode === "rules"}>
        <MatrixRuleFields draft={props.draft} onChange={props.onChange} />
      </Show>
    </div>
  );
}
