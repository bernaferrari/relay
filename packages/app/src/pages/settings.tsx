import { For, Show, createSignal, onMount, onCleanup } from "solid-js";
import { Button } from "@grok-device/ui/button";
import { useTheme, type ColorScheme } from "@grok-device/ui/theme/context";
import { usePlatform } from "../context/platform";
import { useServer } from "../context/server";
import { useCommand } from "../context/command";
import { Icon } from "../components/icon";
import { IconButton } from "@grok-device/ui/icon-button";
import { trapFocus } from "../lib/modal";
import { cn } from "../lib/cn";
import { mono, modalPanel, modalScrim, seg, segBtnOn, segBtn } from "../lib/ui";

const rowCls =
  "flex items-center justify-between gap-4 border-b border-border-weak-base py-3 last:border-b-0";
const rowCopyCls = "flex min-w-0 flex-col gap-0.5";
const rowTitleCls = "text-12-medium text-text-strong";
const rowDescCls = "text-12-regular leading-snug text-text-weak";
const inputCls =
  "h-8 w-full rounded-md border border-border-weak-base bg-surface-raised-stronger-non-alpha px-2.5 font-mono text-12-regular text-text-strong focus:border-border-focus focus:outline-none";

export function SettingsPage(props: { onClose: () => void }) {
  const theme = useTheme();
  const platform = usePlatform();
  const server = useServer();
  const cmd = useCommand();
  let dialogRef: HTMLDivElement | undefined;

  const [section, setSection] = createSignal<"appearance" | "server" | "recipes" | "about">(
    "appearance",
  );
  const [urlDraft, setUrlDraft] = createSignal("");
  const [prodDraft, setProdDraft] = createSignal("");
  const [themeIds, setThemeIds] = createSignal<string[]>([]);
  const [serverSaved, setServerSaved] = createSignal(false);
  const [prodSaved, setProdSaved] = createSignal(false);
  const [query, setQuery] = createSignal("");

  onMount(() => {
    setUrlDraft(server.serverUrl());
    setProdDraft(server.prodAccountMatch());
    void theme.loadThemes().then(() => setThemeIds(theme.ids()));
    onCleanup(cmd.pushModal());
    if (dialogRef) onCleanup(trapFocus(dialogRef));
  });

  async function saveServerUrl() {
    await server.setServerUrl(urlDraft().trim());
    await server.retryConnection();
    setServerSaved(true);
    setTimeout(() => setServerSaved(false), 1500);
  }
  async function saveProdMatch() {
    await server.setProdAccountMatch(prodDraft().trim());
    setProdSaved(true);
    setTimeout(() => setProdSaved(false), 1500);
  }

  const filteredThemes = () => {
    const q = query().trim().toLowerCase();
    const list = themeIds().length ? themeIds() : theme.ids();
    if (!q) return list;
    return list.filter((id) => {
      const name = theme.name(id).toLowerCase();
      return name.includes(q) || id.includes(q);
    });
  };

  const healthText = () =>
    server.health() === "online"
      ? "Connected"
      : server.health() === "offline"
        ? "Offline"
        : "Connecting…";

  const healthTone = () => {
    if (server.health() === "online") return "text-icon-success-base";
    if (server.health() === "offline") return "text-icon-critical-base";
    return "text-text-weak";
  };

  const SECTIONS = [
    ["appearance", "Appearance"],
    ["server", "Server"],
    ["recipes", "Accounts"],
    ["about", "About"],
  ] as const;

  return (
    <div
      class={cn(modalScrim, "flex items-start justify-center px-5 pt-[8vh] pb-5")}
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
        class={cn(modalPanel, "flex max-h-[84vh] w-[min(620px,100%)] flex-col")}
        ref={(el) => {
          dialogRef = el;
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <div class="flex shrink-0 items-center justify-between border-b border-border-weak-base px-[18px] pt-4 pb-3.5">
          <h2 class="m-0 text-16-medium tracking-tight text-text-strong">Settings</h2>
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
        <main class="grid min-h-0 flex-1 grid-cols-[160px_1fr]">
          <nav
            class="flex flex-col gap-px border-r border-border-weak-base bg-background-base p-2 text-text-strong"
            aria-label="Settings sections"
          >
            <For each={SECTIONS}>
              {([id, label]) => (
                <button
                  type="button"
                  class={cn(
                    "rounded-md px-2.5 py-[7px] text-left text-12-medium text-text-base transition-colors hover:bg-surface-raised-base-hover hover:text-text-strong",
                    section() === id && "bg-surface-base-active text-text-strong",
                  )}
                  onClick={() => setSection(id)}
                >
                  {label}
                </button>
              )}
            </For>
          </nav>
          <div class="flex flex-col gap-1 overflow-y-auto bg-surface-raised-stronger-non-alpha px-5 pt-[18px] pb-6 text-12-regular text-text-strong">
            <Show when={section() === "appearance"}>
              <div class={rowCls}>
                <div class={rowCopyCls}>
                  <span class={rowTitleCls}>Color scheme</span>
                  <span class={rowDescCls}>
                    Light, dark, or follow the OS. Active:{" "}
                    <span class="font-mono tabular-nums">{theme.mode()}</span>
                  </span>
                </div>
                <div class="shrink-0">
                  <div class={seg} role="group" aria-label="Color scheme">
                    {(
                      [
                        ["system", "System"],
                        ["light", "Light"],
                        ["dark", "Dark"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        type="button"
                        class={cn(segBtn, theme.colorScheme() === id && segBtnOn)}
                        onClick={() => theme.setColorScheme(id as ColorScheme)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div class="mt-4 flex flex-col gap-2">
                <div class="flex items-center justify-between gap-3">
                  <span class="text-14-medium text-text-strong">Theme</span>
                  <input
                    class="h-7 w-[200px] rounded-control border border-border-weak-base bg-surface-raised-stronger-non-alpha px-2.5 text-12-regular text-text-strong focus:border-border-focus focus:outline-none"
                    type="search"
                    placeholder="Search themes…"
                    value={query()}
                    onInput={(e) => setQuery(e.currentTarget.value)}
                  />
                </div>
                <p class="m-0 text-12-regular text-text-weak">
                  {filteredThemes().length} themes available
                </p>
                <div class="mt-1.5 grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2.5">
                  <For each={filteredThemes()}>
                    {(id) => {
                      const sw = () => theme.swatches(id);
                      return (
                        <button
                          type="button"
                          class={cn(
                            "ui-hover-lift flex flex-col gap-2 rounded-lg border border-border-weak-base bg-surface-raised-stronger-non-alpha p-3 text-left",
                            "transition-[border-color,transform,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
                            "hover:border-border-strong-base ",
                            theme.themeId() === id &&
                              "border-border-interactive-base shadow-[0_0_0_1px_var(--surface-brand-base)]",
                          )}
                          onClick={() => theme.setTheme(id)}
                          title={theme.name(id)}
                        >
                          <span
                            class="relative h-12 overflow-hidden rounded-lg border border-border-weak-base"
                            style={{
                              background: sw()?.bg ?? "var(--background-base)",
                              "border-color": sw()?.primary ?? "var(--border-weak-base)",
                            }}
                          >
                            <span
                              class="absolute top-2 right-2 size-3 rounded-full shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--text-strong)_20%,transparent)]"
                              style={{ background: sw()?.primary ?? "var(--button-primary-base)" }}
                            />
                            <span
                              class="absolute right-0 bottom-0 left-0 h-3.5"
                              style={{ background: sw()?.surface ?? "var(--surface-raised-base)" }}
                            />
                          </span>
                          <span class="truncate text-12-medium text-text-strong">
                            {theme.name(id)}
                          </span>
                        </button>
                      );
                    }}
                  </For>
                </div>
              </div>
            </Show>

            <Show when={section() === "server"}>
              <div class={rowCls}>
                <div class={rowCopyCls}>
                  <span class={rowTitleCls}>Connection</span>
                  <span class={rowDescCls}>HTTP API for devices, actions, and runs.</span>
                </div>
                <div class="shrink-0">
                  <span
                    class={cn(
                      "inline-flex h-[26px] items-center gap-1.5 rounded-full border border-border-weak-base bg-surface-raised-stronger-non-alpha px-2.5 text-12-medium tracking-wide",
                      healthTone(),
                    )}
                  >
                    <span
                      class={cn(
                        "size-1.5 shrink-0 rounded-full bg-current",
                        server.health() === "online" && server.sseConnected() && "animate-pulse",
                      )}
                    />
                    {healthText()}
                  </span>
                </div>
              </div>
              <div class={rowCls}>
                <div class={rowCopyCls}>
                  <span class={rowTitleCls}>Server URL</span>
                  <span class={rowDescCls}>HTTP API this app connects to.</span>
                </div>
                <div class="max-w-[240px] min-w-0 flex-1">
                  <input
                    class={inputCls}
                    type="url"
                    value={urlDraft()}
                    onInput={(e) => setUrlDraft(e.currentTarget.value)}
                    placeholder="http://localhost:8787"
                    spellcheck={false}
                  />
                </div>
              </div>
              <div class="flex items-center gap-2.5 pt-3">
                <Button variant="primary" size="sm" onClick={() => void saveServerUrl()}>
                  Save & reconnect
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void server.retryConnection()}>
                  Refresh
                </Button>
                <Show when={serverSaved()}>
                  <span class="text-12-regular text-icon-success-base">Saved</span>
                </Show>
              </div>
              <Show when={server.error() && !server.isOffline()}>
                <div
                  class="mt-3 flex items-center gap-2 rounded-md bg-surface-critical-weak px-3 py-2 text-12-regular text-icon-critical-base"
                  role="alert"
                >
                  <span class="min-w-0 flex-1">{server.error()}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="ml-auto"
                    onClick={() => server.dismissError()}
                  >
                    Dismiss
                  </Button>
                </div>
              </Show>
            </Show>

            <Show when={section() === "recipes"}>
              <div class={rowCls}>
                <div class={rowCopyCls}>
                  <span class={rowTitleCls}>Prod account match</span>
                  <span class={rowDescCls}>
                    The account the *-prod tests target (e.g. gmail.com).
                  </span>
                </div>
                <div class="max-w-[240px] min-w-0 flex-1">
                  <input
                    class={inputCls}
                    type="text"
                    value={prodDraft()}
                    onInput={(e) => setProdDraft(e.currentTarget.value)}
                    placeholder="gmail.com"
                    spellcheck={false}
                  />
                </div>
              </div>
              <div class="flex items-center gap-2.5 pt-3">
                <Button variant="primary" size="sm" onClick={() => void saveProdMatch()}>
                  Save
                </Button>
                <Show when={prodSaved()}>
                  <span class="text-12-regular text-icon-success-base">Saved</span>
                </Show>
              </div>
            </Show>

            <Show when={section() === "about"}>
              <div class={rowCls}>
                <div class={rowCopyCls}>
                  <span class={rowTitleCls}>Product</span>
                  <span class={rowDescCls}>Stage · grok-device 0.1.0</span>
                </div>
              </div>
              <div class={rowCls}>
                <div class={rowCopyCls}>
                  <span class={rowTitleCls}>Platform</span>
                  <span class={rowDescCls}>
                    <strong class="font-medium text-text-strong">{platform.platform}</strong>
                    {platform.version ? ` · v${platform.version}` : ""}
                  </span>
                </div>
              </div>
              <div class={rowCls}>
                <div class={rowCopyCls}>
                  <span class={rowTitleCls}>Theme</span>
                  <span class={cn(rowDescCls, mono)}>
                    {theme.themeId()} / {theme.mode()}
                  </span>
                </div>
              </div>
              <div class={rowCls}>
                <div class={rowCopyCls}>
                  <span class={rowTitleCls}>Command palette</span>
                  <span class={rowDescCls}>
                    Press <span class="font-mono">⌘K</span> anywhere to run commands, jump to tests,
                    or toggle appearance.
                  </span>
                </div>
                <div class="shrink-0">
                  <button
                    type="button"
                    class={cn(
                      "h-7 rounded-md px-2.5 text-12-medium text-text-strong hover:bg-surface-base-hover",
                    )}
                    onClick={() => cmd.setOpen(true)}
                  >
                    <Icon name="search" size={13} />
                    Open palette
                  </button>
                </div>
              </div>
            </Show>
          </div>
        </main>
      </div>
    </div>
  );
}
