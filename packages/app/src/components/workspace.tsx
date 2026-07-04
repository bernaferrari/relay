import { Show } from "solid-js";
import { Button } from "@grok-device/ui/button";
import { useServer } from "../context/server";
import { Sidebar } from "./sidebar";
import { ActionPanel } from "./action-list";
import { InspectorPanel } from "./inspector";
import { ScreenPanel } from "./screen";
import { ActivityLog } from "./run-log";

export function Workspace() {
  const server = useServer();

  return (
    <div class="workspace">
      <Sidebar />
      <main class="workspace-main">
        <div class="tabs">
          <Button
            variant="ghost"
            size="sm"
            selected={server.tab() === "actions"}
            onClick={() => server.setTab("actions")}
          >
            Actions
          </Button>
          <Button
            variant="ghost"
            size="sm"
            selected={server.tab() === "inspector"}
            onClick={() => server.setTab("inspector")}
          >
            Inspector
          </Button>
          <Button
            variant="ghost"
            size="sm"
            selected={server.tab() === "screen"}
            onClick={() => server.setTab("screen")}
          >
            Screen
          </Button>
          <div class="tabs__spacer" />
          <Button
            variant="ghost"
            size="sm"
            disabled={server.busyCapture()}
            onClick={() => void server.captureUiSnapshot()}
          >
            Snapshot
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={server.busyCapture()}
            onClick={() => void server.captureUiScreenshot()}
          >
            Shot
          </Button>
        </div>
        <div class="workspace-content">
          <Show when={server.tab() === "actions"}>
            <ActionPanel />
          </Show>
          <Show when={server.tab() === "inspector"}>
            <InspectorPanel />
          </Show>
          <Show when={server.tab() === "screen"}>
            <ScreenPanel />
          </Show>
        </div>
      </main>
      <ActivityLog />
    </div>
  );
}
