import { Show } from "solid-js";
import { Button } from "@grok-device/ui/button";
import { useServer } from "../context/server";

export function ScreenPanel() {
  const server = useServer();

  return (
    <div class="workspace-panel">
      <div class="workspace-toolbar">
        <div class="workspace-toolbar__left">
          <h2 class="app-panel__title" style={{ margin: 0 }}>
            Screenshot
          </h2>
          <Show when={server.screenshot()}>
            <span class="header-chip">
              {Math.round((server.screenshot()!.bytes / 1024) * 10) / 10} KB
            </span>
          </Show>
        </div>
        <div class="workspace-toolbar__right">
          <Button
            variant="primary"
            size="sm"
            disabled={server.busyCapture() || server.health() !== "online"}
            onClick={() => void server.captureUiScreenshot()}
          >
            {server.busyCapture() ? "…" : "Capture"}
          </Button>
        </div>
      </div>

      <Show
        when={server.screenshot()}
        fallback={
          <div class="empty empty--large">
            Capture a device screenshot for visual verification.
            <div style={{ "margin-top": "0.75rem" }}>
              <Button variant="primary" size="sm" onClick={() => void server.captureUiScreenshot()}>
                Capture screenshot
              </Button>
            </div>
          </div>
        }
      >
        <div class="screen-frame">
          <img
            class="screen-img"
            alt="Device screenshot"
            src={`data:${server.screenshot()!.mime};base64,${server.screenshot()!.base64}`}
          />
        </div>
      </Show>
    </div>
  );
}
