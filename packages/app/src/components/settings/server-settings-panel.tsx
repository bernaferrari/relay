import { Show, createSignal, onMount } from "solid-js";
import { Button } from "@relay/ui/button";
import { useServer } from "../../context/server";
import { cn } from "../../lib/cn";
import { inputCls, rowCls, rowCopyCls, rowDescCls, rowTitleCls } from "./settings-styles";

export function ServerSettingsPanel() {
  const server = useServer();
  const [urlDraft, setUrlDraft] = createSignal("");
  const [serverSaved, setServerSaved] = createSignal(false);

  onMount(() => {
    setUrlDraft(server.serverUrl());
  });

  async function saveServerUrl() {
    await server.setServerUrl(urlDraft().trim());
    await server.retryConnection();
    setServerSaved(true);
    setTimeout(() => setServerSaved(false), 1500);
  }

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

  return (
    <>
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
                server.health() === "online" &&
                  server.sseConnected() &&
                  "motion-safe:animate-pulse",
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
          <Button variant="ghost" size="sm" class="ml-auto" onClick={() => server.dismissError()}>
            Dismiss
          </Button>
        </div>
      </Show>
    </>
  );
}
