import { For, Show, createSignal, onMount, onCleanup } from "solid-js";
import { Icon } from "../components/icon";
import { IconButton } from "@relay/ui/icon-button";
import { useCommand } from "../context/command";
import { useServer } from "../context/server";
import { trapFocus } from "../lib/modal";
import { cn } from "../lib/cn";
import { modalPanel, modalScrim } from "../lib/ui";
import { AppearanceSettingsPanel } from "../components/appearance-settings-panel";
import { DeviceSettingsPanel } from "../components/device-settings-panel";
import { PrivacySettingsPanel } from "../components/privacy-settings-panel";
import { AboutSettingsPanel } from "../components/settings/about-settings-panel";
import { MatricesSettingsPanel } from "../components/settings/matrices-settings-panel";
import { AccountsSettingsPanel } from "../components/settings/accounts-settings-panel";
import { ServerSettingsPanel } from "../components/settings/server-settings-panel";
import { TargetsSettingsPanel } from "../components/settings/targets-settings-panel";

export type SettingsSection =
  | "appearance"
  | "targets"
  | "matrices"
  | "devices"
  | "privacy"
  | "server"
  | "accounts"
  | "about";

const SECTIONS = [
  ["targets", "Browser targets"],
  ["matrices", "Test environments"],
  ["devices", "Mobile devices"],
  ["accounts", "Accounts"],
  ["privacy", "Privacy & evidence"],
  ["server", "Connection"],
  ["appearance", "Appearance"],
  ["about", "About"],
] as const;

export function SettingsPage(props: { onClose: () => void; initialSection?: SettingsSection }) {
  const server = useServer();
  const cmd = useCommand();
  let dialogRef: HTMLDivElement | undefined;

  const [section, setSection] = createSignal<SettingsSection>(props.initialSection ?? "appearance");

  onMount(() => {
    setSection(props.initialSection ?? "appearance");
    void Promise.all([
      server.refreshTargets(),
      server.refreshTargetProfiles(),
      server.refreshMatrices(),
      server.refreshDevices(),
    ]).then(() => {
      // A fresh install has nothing to look at under Appearance; the one thing
      // it must do first is point Relay at a target or device.
      if (!props.initialSection && server.targets().length === 0 && server.devices().length === 0) {
        setSection("targets");
      }
    });
    onCleanup(cmd.pushModal());
    if (dialogRef) onCleanup(trapFocus(dialogRef));
  });

  return (
    <div
      class={cn(modalScrim, "flex items-start justify-center px-5 pt-[5vh] pb-5")}
      style={{ background: "color-mix(in srgb, var(--surface-float-base) 48%, transparent)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          props.onClose();
        }
      }}
    >
      <div
        class={cn(
          modalPanel,
          "flex max-h-[90vh] w-[min(920px,100%)] flex-col overflow-hidden rounded-2xl",
        )}
        ref={(el) => {
          dialogRef = el;
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <div class="flex shrink-0 items-center justify-between border-b border-border-weak-base px-[18px] pt-4 pb-3.5">
          <h2 class="m-0 text-title font-medium tracking-tight text-text-strong">Settings</h2>
          <IconButton
            variant="ghost"
            size="normal"
            class="rounded-md"
            aria-label="Close settings"
            onClick={() => props.onClose()}
          >
            <Icon name="x" size={14} />
          </IconButton>
        </div>
        <main class="grid min-h-0 flex-1 grid-cols-[210px_1fr] max-[760px]:grid-cols-1">
          <nav
            class="flex flex-col gap-px border-r border-border-weak-base bg-background-base p-2 text-text-strong max-[760px]:flex-row max-[760px]:flex-nowrap max-[760px]:overflow-x-auto max-[760px]:border-r-0 max-[760px]:border-b"
            aria-label="Settings sections"
          >
            <For each={SECTIONS}>
              {([id, label]) => (
                <button
                  type="button"
                  class={cn(
                    "min-h-10 rounded-md px-2.5 py-[7px] text-left text-caption font-medium text-text-base transition-colors hover:bg-surface-raised-base-hover hover:text-text-strong max-[760px]:min-h-11 max-[760px]:shrink-0",
                    section() === id && "bg-surface-base-active text-text-strong",
                  )}
                  aria-current={section() === id ? "page" : undefined}
                  onClick={() => setSection(id)}
                >
                  {label}
                </button>
              )}
            </For>
          </nav>
          <div class="flex flex-col gap-1 overflow-y-auto bg-surface-raised-stronger-non-alpha px-5 pt-[18px] pb-6 text-caption text-text-strong max-[520px]:[&_button]:min-h-11">
            <Show when={section() === "appearance"}>
              <AppearanceSettingsPanel />
            </Show>

            <Show when={section() === "targets"}>
              <TargetsSettingsPanel />
            </Show>

            <Show when={section() === "matrices"}>
              <MatricesSettingsPanel />
            </Show>

            <Show when={section() === "privacy"}>
              <PrivacySettingsPanel />
            </Show>

            <Show when={section() === "devices"}>
              <DeviceSettingsPanel />
            </Show>

            <Show when={section() === "server"}>
              <ServerSettingsPanel />
            </Show>

            <Show when={section() === "accounts"}>
              <AccountsSettingsPanel />
            </Show>

            <Show when={section() === "about"}>
              <AboutSettingsPanel />
            </Show>
          </div>
        </main>
      </div>
    </div>
  );
}
