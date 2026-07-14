import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type { DesktopUpdateState } from "../context/platform";
import { usePlatform } from "../context/platform";
import { useCommand } from "../context/command";
import { Icon } from "./icon";
import { trapFocus } from "../lib/modal";
import { cn } from "../lib/cn";
import { modalPanel, modalScrim } from "../lib/ui";

const SNOOZED_UPDATE_KEY = "desktop-update:snoozed-version:v1";

function cleanNotes(value: string | undefined): string[] {
  if (!value) return ["Performance improvements and reliability fixes."];
  // Release notes are remote, untrusted text. Render plain text only—never
  // HTML—and keep the prompt intentionally scannable.
  return value
    .replace(/<[^>]*>/g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 6);
}

/** A small, restart-safe update prompt for packaged desktop hosts. */
export function DesktopUpdateDialog() {
  const platform = usePlatform();
  const command = useCommand();
  const [state, setState] = createSignal<DesktopUpdateState>({ phase: "disabled" });
  const [snoozedVersion, setSnoozedVersion] = createSignal<string | null>(null);
  const [panel, setPanel] = createSignal<HTMLDivElement>();

  onMount(() => {
    const updates = platform.updates;
    if (!updates) return;
    void updates
      .getState()
      .then(setState)
      .catch(() => undefined);
    void Promise.resolve(platform.storage.get(SNOOZED_UPDATE_KEY)).then(setSnoozedVersion);
    onCleanup(updates.subscribe(setState));
  });

  createEffect(() => {
    if (visible() && panel()) onCleanup(trapFocus(panel()!));
  });

  createEffect(() => {
    if (visible()) onCleanup(command.pushModal());
  });

  const visible = () =>
    state().phase === "downloaded" &&
    Boolean(state().version) &&
    state().version !== snoozedVersion();

  async function later(): Promise<void> {
    const version = state().version;
    if (!version) return;
    setSnoozedVersion(version);
    await Promise.resolve(platform.storage.set(SNOOZED_UPDATE_KEY, version));
  }

  function install(): void {
    void platform.updates?.install();
  }

  return (
    <Show when={visible()}>
      <div
        class={cn(modalScrim, "z-[120] flex items-center justify-center px-5")}
        onClick={(event) => {
          if (event.target === event.currentTarget) void later();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            void later();
          }
        }}
      >
        <div
          ref={setPanel}
          class={cn(modalPanel, "w-[min(500px,100%)] p-0")}
          role="dialog"
          aria-modal="true"
          aria-labelledby="desktop-update-title"
          aria-describedby="desktop-update-notes"
        >
          <div class="flex items-start gap-3.5 border-b border-border-weak-base px-5 pt-5 pb-4">
            <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-interactive-weak text-icon-interactive-base">
              <Icon name="download" size={18} />
            </span>
            <div class="min-w-0 flex-1">
              <span class="text-11-medium uppercase tracking-[0.12em] text-text-weak">
                Update ready
              </span>
              <h2
                id="desktop-update-title"
                class="mt-1 mb-0 text-16-medium tracking-tight text-text-strong"
              >
                Relay {state().releaseName ?? state().version} is ready
              </h2>
              <p class="mt-1 mb-0 text-12-regular leading-relaxed text-text-weak">
                The update is downloaded. Restart when you’re ready; current work stays on disk.
              </p>
            </div>
          </div>
          <div class="px-5 py-4">
            <span class="text-12-medium text-text-strong">What’s new</span>
            <ul
              id="desktop-update-notes"
              class="mt-2 mb-0 grid list-disc gap-1 pl-4 text-12-regular leading-relaxed text-text-weak"
            >
              {cleanNotes(state().releaseNotes).map((note) => (
                <li>{note}</li>
              ))}
            </ul>
          </div>
          <div class="flex items-center justify-between gap-3 border-t border-border-weak-base bg-background-base px-5 py-3.5">
            <button
              type="button"
              class="rounded-md px-2 py-1.5 text-12-medium text-text-weak transition-colors hover:bg-surface-raised-base-hover hover:text-text-strong"
              onClick={() => void later()}
            >
              Skip this version
            </button>
            <button
              type="button"
              class="inline-flex h-8 items-center gap-2 rounded-md bg-button-primary-base px-3 text-12-medium text-icon-invert-base shadow-sm transition-transform hover:brightness-110 active:translate-y-px"
              autofocus
              onClick={install}
            >
              <Icon name="refresh" size={14} /> Restart & update
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
