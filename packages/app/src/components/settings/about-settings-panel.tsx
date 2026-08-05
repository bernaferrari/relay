import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { Button } from "@relay/ui/button";
import { useTheme } from "@relay/ui/theme/context";
import { usePlatform, type DesktopUpdateState } from "../../context/platform";
import { useCommand } from "../../context/command";
import { Icon } from "../icon";
import { cn } from "../../lib/cn";
import { mono } from "../../lib/ui";
import { rowCls, rowCopyCls, rowDescCls, rowTitleCls } from "./settings-styles";

export function AboutSettingsPanel() {
  const theme = useTheme();
  const platform = usePlatform();
  const cmd = useCommand();
  const [updateState, setUpdateState] = createSignal<DesktopUpdateState | null>(null);
  const [checkingUpdates, setCheckingUpdates] = createSignal(false);

  onMount(() => {
    if (platform.updates) {
      void platform.updates
        .getState()
        .then(setUpdateState)
        .catch(() => undefined);
      onCleanup(platform.updates.subscribe(setUpdateState));
    }
  });

  async function checkForUpdates(): Promise<void> {
    if (!platform.updates) return;
    setCheckingUpdates(true);
    try {
      await platform.updates.check();
      setUpdateState(await platform.updates.getState());
    } finally {
      setCheckingUpdates(false);
    }
  }

  return (
    <>
      <div class={rowCls}>
        <div class={rowCopyCls}>
          <span class={rowTitleCls}>Product</span>
          <span class={rowDescCls}>Relay · 0.1.0</span>
        </div>
      </div>
      <Show when={platform.updates}>
        <div class={rowCls}>
          <div class={rowCopyCls}>
            <span class={rowTitleCls}>Updates</span>
            <span class={rowDescCls}>
              {updateState()?.phase === "checking"
                ? "Checking for a signed release…"
                : updateState()?.phase === "downloaded"
                  ? `${updateState()?.releaseName ?? updateState()?.version ?? "An update"} is ready to restart.`
                  : updateState()?.phase === "error"
                    ? "Couldn’t check right now. Try again later."
                    : "Checks automatically while Relay is running."}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={checkingUpdates() || updateState()?.phase === "checking"}
            onClick={() => void checkForUpdates()}
          >
            {checkingUpdates() || updateState()?.phase === "checking" ? "Checking…" : "Check now"}
          </Button>
        </div>
      </Show>
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
            Press <span class="font-mono">⌘K</span> anywhere to run commands, jump to tests, or
            toggle appearance.
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
    </>
  );
}
