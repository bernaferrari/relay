import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { AppMapCombineCellRuntimeProfile } from "@relay/protocol";
import {
  cellBindingStatus,
  filterRuntimeProfiles,
  suggestCompatibleProfiles,
  type CombineRuntimeProfileOption,
} from "../lib/app-map-combine-profiles";
import { nextRovingIndex } from "../lib/roving-focus";
import { cn } from "../lib/cn";
import { menuOption, menuOptionOn, popover } from "../lib/ui";
import { Icon } from "./icon";

const SEARCH_THRESHOLD = 8;

export function AppMapCombineProfilePicker(props: {
  testName: string;
  worldLabel: string;
  values: Record<string, string>;
  profiles: readonly CombineRuntimeProfileOption[];
  binding?: AppMapCombineCellRuntimeProfile;
  device?: { serial?: string; platform?: string };
  busy?: boolean;
  tabIndex?: number;
  onBind: (targetProfileId: string) => void;
  onGridKeyDown?: (event: KeyboardEvent) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [active, setActive] = createSignal(0);
  let trigger: HTMLButtonElement | undefined;
  let search: HTMLInputElement | undefined;

  const status = createMemo(() =>
    cellBindingStatus({ profiles: props.profiles, binding: props.binding }),
  );
  const suggestions = createMemo(() =>
    suggestCompatibleProfiles({
      profiles: props.profiles,
      values: props.values,
      device: props.device,
    }),
  );
  const filtered = createMemo(() => filterRuntimeProfiles(props.profiles, query()));
  const remainder = createMemo(() => {
    if (query().trim()) return filtered();
    const suggested = new Set(suggestions().map((profile) => profile.id));
    return filtered().filter((profile) => !suggested.has(profile.id));
  });
  const optionIds = createMemo(() =>
    query().trim()
      ? filtered().map((profile) => profile.id)
      : [...suggestions(), ...remainder()].map((profile) => profile.id),
  );
  const listId = createMemo(
    () =>
      `combine-profile-${encodeURIComponent(props.testName)}-${encodeURIComponent(props.worldLabel)}`,
  );

  createEffect(() => {
    if (!open()) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (trigger?.contains(target) || document.getElementById(listId())?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        trigger?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    });
    queueMicrotask(() => search?.focus());
  });

  function choose(id: string): void {
    props.onBind(id);
    setOpen(false);
    setQuery("");
    trigger?.focus();
  }

  function move(key: string): void {
    const next = nextRovingIndex(key, active(), optionIds().length, "vertical");
    if (next === null) return;
    setActive(next);
    document
      .getElementById(`${listId()}-${optionIds()[next]}`)
      ?.scrollIntoView({ block: "nearest" });
  }

  return (
    <div class="relative grid gap-1">
      <span
        class="flex items-center gap-1 text-micro text-[var(--text-weak)]"
        data-combine-cell-status={status().state}
      >
        <Icon name={status().state === "bound" ? "check" : "alert"} size={11} class="shrink-0" />
        {status().label}
      </span>
      <button
        ref={(element) => {
          trigger = element;
        }}
        type="button"
        class="flex h-8 min-w-0 items-center justify-between gap-1 rounded-lg border border-[var(--border-weak-base)] bg-[var(--surface-raised-stronger-non-alpha)] px-1.5 text-left text-micro text-[var(--text-base)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)] disabled:text-[var(--text-weaker)]"
        aria-haspopup="listbox"
        aria-expanded={open()}
        aria-controls={listId()}
        aria-label={`Runtime profile for ${props.testName} in ${props.worldLabel}. ${status().label}.`}
        title={status().detail}
        tabIndex={props.tabIndex}
        data-combine-profile-trigger
        disabled={props.busy || !props.profiles.length}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (open()) return;
          props.onGridKeyDown?.(event);
        }}
      >
        <span class="min-w-0 truncate">
          {status().state === "bound" ? status().label.replace(/^Bound · /u, "") : "Choose profile"}
        </span>
        <Icon name="chevron-down" size={11} class="shrink-0 text-[var(--text-weaker)]" />
      </button>
      <Show when={open()}>
        <div
          id={listId()}
          class={cn(popover, "absolute top-[calc(100%+4px)] left-0 z-30 w-[min(280px,70vw)] p-0")}
          role="listbox"
          aria-label={`Saved runtime profiles for ${props.testName} in ${props.worldLabel}`}
          onKeyDown={(event) => {
            if (
              event.key === "ArrowDown" ||
              event.key === "ArrowUp" ||
              event.key === "Home" ||
              event.key === "End"
            ) {
              event.preventDefault();
              move(event.key);
            }
            if (event.key === "Enter") {
              const id = optionIds()[active()];
              if (id) {
                event.preventDefault();
                choose(id);
              }
            }
          }}
        >
          <Show when={props.profiles.length >= SEARCH_THRESHOLD}>
            <div class="border-b border-[var(--border-weak-base)] p-2">
              <label class="relative block">
                <span class="sr-only">Find a runtime profile</span>
                <Icon
                  name="search"
                  size={12}
                  class="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-[var(--text-weaker)]"
                />
                <input
                  ref={(element) => {
                    search = element;
                  }}
                  type="search"
                  class="h-8 w-full rounded-md border border-[var(--border-weak-base)] bg-[var(--surface-raised-stronger-non-alpha)] pr-2 pl-7 text-micro text-[var(--text-strong)] outline-none focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
                  placeholder="Find a profile…"
                  value={query()}
                  onInput={(event) => {
                    setQuery(event.currentTarget.value);
                    setActive(0);
                  }}
                />
              </label>
            </div>
          </Show>
          <div class="max-h-56 overflow-y-auto p-1">
            <Show when={suggestions().length && !query().trim()}>
              <p class="m-0 px-2 pt-1 pb-0.5 text-micro font-medium text-[var(--text-weak)]">
                Suggested · not bound until you choose
              </p>
              <For each={suggestions()}>
                {(profile) => (
                  <ProfileOption
                    listId={listId()}
                    profile={profile}
                    reason={profile.reason}
                    selected={props.binding?.targetProfileId === profile.id}
                    active={optionIds()[active()] === profile.id}
                    onChoose={() => choose(profile.id)}
                  />
                )}
              </For>
            </Show>
            <Show
              when={(query().trim() ? filtered() : remainder()).length}
              fallback={
                <Show when={!suggestions().length || Boolean(query().trim())}>
                  <p class="m-0 px-2.5 py-3 text-caption text-[var(--text-weak)]">
                    No saved profile matches that search.
                  </p>
                </Show>
              }
            >
              <Show when={suggestions().length && !query().trim() && remainder().length}>
                <p class="m-0 px-2 pt-2 pb-0.5 text-micro font-medium text-[var(--text-weak)]">
                  All saved profiles
                </p>
              </Show>
              <For each={query().trim() ? filtered() : remainder()}>
                {(profile) => (
                  <ProfileOption
                    listId={listId()}
                    profile={profile}
                    selected={props.binding?.targetProfileId === profile.id}
                    active={optionIds()[active()] === profile.id}
                    onChoose={() => choose(profile.id)}
                  />
                )}
              </For>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}

function ProfileOption(props: {
  listId: string;
  profile: CombineRuntimeProfileOption;
  reason?: string;
  selected: boolean;
  active: boolean;
  onChoose: () => void;
}) {
  return (
    <button
      id={`${props.listId}-${props.profile.id}`}
      type="button"
      role="option"
      aria-selected={props.selected}
      class={cn(
        menuOption,
        "grid min-h-11 w-full gap-0.5 px-2 py-1.5 text-left",
        props.selected && menuOptionOn,
        props.active && "outline-2 outline-offset-[-2px] outline-[var(--border-focus)]",
      )}
      onClick={props.onChoose}
    >
      <span class="truncate text-caption font-medium text-[var(--text-strong)]">
        {props.profile.name}
      </span>
      <span class="truncate text-micro text-[var(--text-weak)]">
        {props.reason ?? `${props.profile.platform} · ${props.profile.id}`}
      </span>
    </button>
  );
}
