import { For, Show, createMemo, createSignal } from "solid-js";
import type { CompatibilityMatrix, TargetProfile } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { IconButton } from "@relay/ui/icon-button";
import { useServer } from "../../context/server";
import { cn } from "../../lib/cn";
import {
  compatibilityMatrixDraftFrom,
  compatibilityMatrixDraftValid,
  compatibilityMatrixId,
  emptyMatrixSelectorDraft,
  selectorsFromCompatibilityMatrixDraft,
  toggleListValue,
  type MatrixSelectorDraft,
} from "../../lib/compatibility-matrix-draft";
import { filterTargetProfiles } from "../../lib/matrix-target-filter";
import { platformLabel } from "../../lib/target-presentation";
import { Icon, type IconName } from "../icon";
import { MatrixRuleFields, MatrixSelectorEditor } from "../matrix-selector-editor";
import { inputCls, rowTitleCls } from "./settings-styles";

const targetPlatformOrder: TargetProfile["platform"][] = ["android", "ios", "browser"];

const environmentModes: ReadonlyArray<{
  mode: MatrixSelectorDraft["mode"];
  icon: IconName;
  title: string;
  description: string;
}> = [
  {
    mode: "targets",
    icon: "smartphone",
    title: "Pick exact devices",
    description: "Keep a stable list. Best for a known regression set.",
  },
  {
    mode: "rules",
    icon: "scan",
    title: "Match by rules",
    description: "Include current and future devices by platform, OS, model, or capability.",
  },
];

function targetProfileDetail(profile: TargetProfile): string {
  return [
    profile.model && profile.model !== profile.name ? profile.model : undefined,
    profile.osVersion,
  ]
    .filter(Boolean)
    .join(" · ");
}

function ExactDeviceSelector(props: {
  profiles: TargetProfile[];
  selectedIds: string[];
  query: string;
  onQueryChange: (query: string) => void;
  onSelectionChange: (targetIds: string[]) => void;
}) {
  const filteredProfiles = createMemo(() => filterTargetProfiles(props.profiles, props.query));
  const groupedProfiles = createMemo(() =>
    targetPlatformOrder
      .map((platform) => ({
        platform,
        profiles: filteredProfiles().filter((profile) => profile.platform === platform),
      }))
      .filter((group) => group.profiles.length > 0),
  );
  const selectVisible = () => {
    const visibleIds = filteredProfiles().map((profile) => profile.targetId);
    props.onSelectionChange([...new Set([...props.selectedIds, ...visibleIds])]);
  };

  return (
    <section class="grid gap-2" aria-labelledby="test-environment-device-heading">
      <div class="flex items-center justify-between gap-3">
        <div>
          <strong
            id="test-environment-device-heading"
            class="block text-11-medium text-text-strong"
          >
            3. Select devices
          </strong>
          <span class="mt-0.5 block text-10-regular text-text-weak">
            Tests run once on every selected device.
          </span>
        </div>
        <span class="shrink-0 text-10-regular tabular-nums text-text-weak">
          {props.selectedIds.length} selected
        </span>
      </div>
      <div class="overflow-hidden rounded-lg border border-border-weak-base bg-background-base">
        <div class="flex items-center gap-2 border-b border-border-weak-base p-2">
          <label class="relative min-w-0 flex-1" for="test-environment-device-search">
            <Icon
              name="search"
              size={13}
              class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-weak"
            />
            <span class="sr-only">Search available devices</span>
            <input
              id="test-environment-device-search"
              data-focus-contained
              type="search"
              value={props.query}
              placeholder="Search devices"
              autocomplete="off"
              spellcheck={false}
              class={cn(inputCls, "h-9 pl-8")}
              onInput={(event) => props.onQueryChange(event.currentTarget.value)}
            />
          </label>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            disabled={filteredProfiles().length === 0}
            onClick={selectVisible}
          >
            Select visible
          </Button>
          <Show when={props.selectedIds.length > 0}>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => props.onSelectionChange([])}
            >
              Clear
            </Button>
          </Show>
        </div>
        <div class="app-map-panel-scroll max-h-64 overflow-y-auto overscroll-contain p-1.5">
          <Show
            when={props.profiles.length > 0}
            fallback={
              <div class="grid min-h-28 place-items-center px-6 text-center">
                <div>
                  <strong class="text-11-medium text-text-strong">No devices available</strong>
                  <p class="m-0 mt-1 text-10-regular leading-relaxed text-text-weak">
                    Connect a mobile device or add a browser target first.
                  </p>
                </div>
              </div>
            }
          >
            <Show
              when={filteredProfiles().length > 0}
              fallback={
                <div class="grid min-h-28 place-items-center px-6 text-center">
                  <div>
                    <strong class="text-11-medium text-text-strong">No matching devices</strong>
                    <p class="m-0 mt-1 text-10-regular text-text-weak">
                      Try a model, OS version, or platform name.
                    </p>
                  </div>
                </div>
              }
            >
              <For each={groupedProfiles()}>
                {(group) => (
                  <div class="grid gap-0.5">
                    <div class="sticky top-0 z-10 flex h-7 items-center justify-between bg-background-base px-2 text-10-medium text-text-weak">
                      <span>{platformLabel(group.platform)}</span>
                      <span class="tabular-nums">{group.profiles.length}</span>
                    </div>
                    <For each={group.profiles}>
                      {(profile) => (
                        <label class="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-2 text-text-strong transition-colors duration-150 hover:bg-surface-raised-stronger-non-alpha has-[:checked]:bg-[var(--product-accent-soft)]">
                          <input
                            type="checkbox"
                            checked={props.selectedIds.includes(profile.targetId)}
                            onChange={() =>
                              props.onSelectionChange(
                                toggleListValue(props.selectedIds, profile.targetId),
                              )
                            }
                          />
                          <span class="grid min-w-0 flex-1 gap-0.5">
                            <strong class="truncate text-11-medium text-text-strong">
                              {profile.name}
                            </strong>
                            <Show when={targetProfileDetail(profile)}>
                              <span class="truncate text-10-regular text-text-weak">
                                {targetProfileDetail(profile)}
                              </span>
                            </Show>
                          </span>
                        </label>
                      )}
                    </For>
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </div>
      </div>
    </section>
  );
}

export function TestEnvironmentEditor(props: {
  matrix?: CompatibilityMatrix;
  canClose: boolean;
  onClose: () => void;
}) {
  const server = useServer();
  const [draft, setDraft] = createSignal(compatibilityMatrixDraftFrom(props.matrix));
  const [query, setQuery] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");

  const updatePrimary = (patch: Partial<MatrixSelectorDraft>) =>
    setDraft((current) => ({
      ...current,
      primary: { ...current.primary, ...patch },
    }));
  const updateAdditional = (index: number, next: MatrixSelectorDraft) =>
    setDraft((current) => ({
      ...current,
      additional: current.additional.map((item, itemIndex) => (itemIndex === index ? next : item)),
    }));

  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const current = draft();
    if (!compatibilityMatrixDraftValid(current)) return;
    const id = props.matrix?.id ?? compatibilityMatrixId(current.name);
    if (!id) return;
    setError("");
    setBusy(true);
    try {
      await server.saveCompatibilityMatrix({
        id,
        name: current.name.trim(),
        selectors: selectorsFromCompatibilityMatrixDraft(current),
      });
      props.onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this test environment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      class="flex flex-col gap-4 rounded-xl border border-border-weak-base bg-background-base p-4"
      onSubmit={save}
    >
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <strong class="block text-13-medium text-text-strong">
            {props.matrix ? "Edit environment" : "New environment"}
          </strong>
          <span class="mt-1 block max-w-[36rem] text-11-regular leading-relaxed text-text-weak">
            Give this device set a name, then decide whether its membership stays fixed or updates
            automatically.
          </span>
        </div>
        <Show when={props.canClose}>
          <IconButton
            variant="ghost"
            size="normal"
            type="button"
            aria-label="Close environment editor"
            onClick={props.onClose}
          >
            <Icon name="x" size={14} />
          </IconButton>
        </Show>
      </div>

      <Show when={error()}>
        <p
          class="m-0 rounded-md bg-surface-critical-weak px-3 py-2 text-11-regular text-icon-critical-base"
          role="alert"
        >
          {error()}
        </p>
      </Show>

      <label class="flex flex-col gap-1.5" for="test-environment-name">
        <span class={rowTitleCls}>1. Name this environment</span>
        <input
          id="test-environment-name"
          data-focus-contained
          class={cn(inputCls, "h-10")}
          value={draft().name}
          placeholder="For example, Release smoke"
          autocomplete="off"
          spellcheck={false}
          onInput={(event) =>
            setDraft((current) => ({ ...current, name: event.currentTarget.value }))
          }
        />
        <span class="text-10-regular text-text-weak">
          You will see this name when choosing where a test runs.
        </span>
      </label>

      <fieldset class="m-0 grid gap-2 border-0 p-0">
        <legend class={rowTitleCls}>2. How should devices be included?</legend>
        <div class="grid grid-cols-2 gap-2 max-[760px]:grid-cols-1">
          <For each={environmentModes}>
            {(choice) => (
              <label class="flex min-h-20 cursor-pointer items-start gap-3 rounded-lg border border-border-weak-base p-3 transition-[background-color,border-color] duration-150 hover:bg-surface-raised-stronger-non-alpha has-[:checked]:border-border-focus has-[:checked]:bg-[var(--product-accent-soft)] has-[:focus-visible]:border-border-focus has-[:focus-visible]:outline-none">
                <input
                  class="sr-only"
                  type="radio"
                  name="test-environment-mode"
                  checked={draft().primary.mode === choice.mode}
                  onChange={() => updatePrimary({ mode: choice.mode })}
                />
                <span class="grid size-8 shrink-0 place-items-center rounded-md bg-surface-raised-stronger-non-alpha text-text-base">
                  <Icon name={choice.icon} size={14} />
                </span>
                <span class="grid min-w-0 gap-1">
                  <strong class="text-11-medium text-text-strong">{choice.title}</strong>
                  <span class="text-10-regular leading-relaxed text-text-weak">
                    {choice.description}
                  </span>
                </span>
              </label>
            )}
          </For>
        </div>
      </fieldset>

      <Show when={draft().primary.mode === "targets"}>
        <ExactDeviceSelector
          profiles={server.targetProfiles()}
          selectedIds={draft().primary.targetIds}
          query={query()}
          onQueryChange={setQuery}
          onSelectionChange={(targetIds) => updatePrimary({ targetIds })}
        />
      </Show>
      <Show when={draft().primary.mode === "rules"}>
        <section class="grid gap-2" aria-labelledby="test-environment-rules-heading">
          <div>
            <strong
              id="test-environment-rules-heading"
              class="block text-11-medium text-text-strong"
            >
              3. Define which devices belong
            </strong>
            <span class="mt-0.5 block text-10-regular text-text-weak">
              A device is included when it matches every condition you set below.
            </span>
          </div>
          <div class="rounded-lg border border-border-weak-base bg-background-base p-3">
            <MatrixRuleFields draft={draft().primary} onChange={(next) => updatePrimary(next)} />
          </div>
        </section>
      </Show>

      <Show when={draft().additional.length > 0}>
        <div class="grid gap-2.5">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <span class={rowTitleCls}>More matches</span>
              <p class="mt-0.5 mb-0 text-10-regular text-text-weak">
                Devices are included when any of these matches apply.
              </p>
            </div>
            <span class="shrink-0 text-10-regular tabular-nums text-text-weak">
              {draft().additional.length} {draft().additional.length === 1 ? "rule" : "rules"}
            </span>
          </div>
          <For each={draft().additional}>
            {(selector, index) => (
              <MatrixSelectorEditor
                index={index() + 2}
                draft={selector}
                profiles={server.targetProfiles()}
                onChange={(next) => updateAdditional(index(), next)}
                onRemove={() =>
                  setDraft((current) => ({
                    ...current,
                    additional: current.additional.filter((_, itemIndex) => itemIndex !== index()),
                  }))
                }
              />
            )}
          </For>
        </div>
      </Show>
      <Show when={draft().primary.mode === "rules"}>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={() =>
            setDraft((current) => ({
              ...current,
              additional: [...current.additional, emptyMatrixSelectorDraft("rules")],
            }))
          }
        >
          Include another device group
        </Button>
      </Show>

      <footer class="flex items-center justify-between gap-3 border-t border-border-weak-base pt-3">
        <span class="min-w-0 text-10-regular text-text-weak">
          {draft().primary.mode === "targets"
            ? draft().primary.targetIds.length > 0
              ? `${draft().primary.targetIds.length} ${draft().primary.targetIds.length === 1 ? "device" : "devices"} will run each test.`
              : "Select at least one device."
            : "Matching devices update automatically as your device list changes."}
        </span>
        <div class="flex shrink-0 items-center gap-1.5">
          <Show when={props.matrix}>
            <Button variant="ghost" size="sm" type="button" onClick={props.onClose}>
              Cancel
            </Button>
          </Show>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            disabled={!compatibilityMatrixDraftValid(draft()) || busy()}
          >
            {busy() ? "Saving…" : props.matrix ? "Save changes" : "Create environment"}
          </Button>
        </div>
      </footer>
    </form>
  );
}
