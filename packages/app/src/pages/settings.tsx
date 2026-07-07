import { For, Show, createSignal, onMount, onCleanup } from "solid-js";
import { Button } from "@grok-device/ui/button";
import { useTheme, type ColorScheme } from "@grok-device/ui/theme/context";
import { usePlatform } from "../context/platform";
import { useServer } from "../context/server";
import { useCommand } from "../context/command";
import { Icon } from "../components/icon";
import { trapFocus } from "../lib/modal";
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

  const SECTIONS = [
    ["appearance", "Appearance"],
    ["server", "Server"],
    ["recipes", "Accounts"],
    ["about", "About"],
  ] as const;

  return (
    <div
      class="dialog-overlay"
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
        class="dialog dialog--settings"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <div class="dialog__head">
          <h2 class="dialog__title">Settings</h2>
          <button
            type="button"
            class="dialog__close"
            aria-label="Close settings"
            onClick={() => props.onClose()}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
        <main class="settings-v2">
          <nav class="settings-v2__nav" aria-label="Settings sections">
            <For each={SECTIONS}>
              {([id, label]) => (
                <button
                  type="button"
                  class="settings-v2__tab"
                  classList={{ on: section() === id }}
                  onClick={() => setSection(id)}
                >
                  {label}
                </button>
              )}
            </For>
          </nav>
          <div class="settings-v2__body">
            <Show when={section() === "appearance"}>
              <div class="s-row">
                <div class="s-row__copy">
                  <span class="s-row__title">Color scheme</span>
                  <span class="s-row__desc">
                    Light, dark, or follow the OS. Active: <span class="mono">{theme.mode()}</span>
                  </span>
                </div>
                <div class="s-row__control">
                  <div class="scheme-seg" role="group" aria-label="Color scheme">
                    {(
                      [
                        ["system", "System"],
                        ["light", "Light"],
                        ["dark", "Dark"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        type="button"
                        class="scheme-seg__btn"
                        classList={{ on: theme.colorScheme() === id }}
                        onClick={() => theme.setColorScheme(id as ColorScheme)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div class="s-section">
                <div class="s-section__head">
                  <span class="s-section__title">Theme</span>
                  <input
                    class="theme-search"
                    type="search"
                    placeholder="Search themes…"
                    value={query()}
                    onInput={(e) => setQuery(e.currentTarget.value)}
                  />
                </div>
                <p class="s-hint">{filteredThemes().length} themes available</p>
                <div class="theme-grid">
                  <For each={filteredThemes()}>
                    {(id) => {
                      const sw = () => theme.swatches(id);
                      return (
                        <button
                          type="button"
                          class="theme-card"
                          classList={{ on: theme.themeId() === id }}
                          onClick={() => theme.setTheme(id)}
                          title={theme.name(id)}
                        >
                          <span
                            class="theme-card__swatch"
                            style={{
                              background: sw()?.bg ?? "var(--background-base)",
                              "border-color": sw()?.primary ?? "var(--border-weak-base)",
                            }}
                          >
                            <span
                              class="theme-card__dot"
                              style={{ background: sw()?.primary ?? "var(--button-primary-base)" }}
                            />
                            <span
                              class="theme-card__bar"
                              style={{ background: sw()?.surface ?? "var(--surface-raised-base)" }}
                            />
                          </span>
                          <span class="theme-card__name">{theme.name(id)}</span>
                        </button>
                      );
                    }}
                  </For>
                </div>
              </div>
            </Show>

            <Show when={section() === "server"}>
              <div class="s-row">
                <div class="s-row__copy">
                  <span class="s-row__title">Connection</span>
                  <span class="s-row__desc">HTTP API for devices, actions, and runs.</span>
                </div>
                <div class="s-row__control">
                  <span
                    class="conn"
                    classList={{
                      "conn--live": server.health() === "online" && server.sseConnected(),
                      "conn--on": server.health() === "online" && !server.sseConnected(),
                      "conn--off": server.health() === "offline",
                      "conn--dim": server.health() === "unknown",
                    }}
                  >
                    <span class="conn__dot" />
                    {healthText()}
                  </span>
                </div>
              </div>
              <div class="s-row">
                <div class="s-row__copy">
                  <span class="s-row__title">Server URL</span>
                  <span class="s-row__desc">HTTP API this app connects to.</span>
                </div>
                <div class="s-row__control s-row__control--grow">
                  <input
                    type="url"
                    value={urlDraft()}
                    onInput={(e) => setUrlDraft(e.currentTarget.value)}
                    placeholder="http://localhost:8787"
                    spellcheck={false}
                  />
                </div>
              </div>
              <div class="s-actions">
                <Button variant="primary" size="sm" onClick={() => void saveServerUrl()}>
                  Save & reconnect
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void server.retryConnection()}>
                  Refresh
                </Button>
                <Show when={serverSaved()}>
                  <span class="s-hint s-hint--ok">Saved</span>
                </Show>
              </div>
              <Show when={server.error()}>
                <div class="settings-error" role="alert">
                  <span>{server.error()}</span>
                  <button type="button" class="btn btn-ghost" onClick={() => server.dismissError()}>
                    Dismiss
                  </button>
                </div>
              </Show>
            </Show>

            <Show when={section() === "recipes"}>
              <div class="s-row">
                <div class="s-row__copy">
                  <span class="s-row__title">Prod account match</span>
                  <span class="s-row__desc">
                    The account the *-prod recipes target (e.g. gmail.com).
                  </span>
                </div>
                <div class="s-row__control s-row__control--grow">
                  <input
                    type="text"
                    value={prodDraft()}
                    onInput={(e) => setProdDraft(e.currentTarget.value)}
                    placeholder="gmail.com"
                    spellcheck={false}
                  />
                </div>
              </div>
              <div class="s-actions">
                <Button variant="primary" size="sm" onClick={() => void saveProdMatch()}>
                  Save
                </Button>
                <Show when={prodSaved()}>
                  <span class="s-hint s-hint--ok">Saved</span>
                </Show>
              </div>
            </Show>

            <Show when={section() === "about"}>
              <div class="s-row">
                <div class="s-row__copy">
                  <span class="s-row__title">Product</span>
                  <span class="s-row__desc">Specimen · grok-device 0.1.0</span>
                </div>
              </div>
              <div class="s-row">
                <div class="s-row__copy">
                  <span class="s-row__title">Platform</span>
                  <span class="s-row__desc">
                    <strong class="settings-strong">{platform.platform}</strong>
                    {platform.version ? ` · v${platform.version}` : ""}
                  </span>
                </div>
              </div>
              <div class="s-row">
                <div class="s-row__copy">
                  <span class="s-row__title">Theme</span>
                  <span class="s-row__desc mono">
                    {theme.themeId()} / {theme.mode()}
                  </span>
                </div>
              </div>
              <div class="s-row">
                <div class="s-row__copy">
                  <span class="s-row__title">Command palette</span>
                  <span class="s-row__desc">
                    Press <span class="mono">⌘K</span> anywhere to run commands, jump to recipes, or
                    toggle appearance.
                  </span>
                </div>
                <div class="s-row__control">
                  <button type="button" class="btn btn-ghost" onClick={() => cmd.setOpen(true)}>
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
