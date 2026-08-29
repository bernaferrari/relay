import type { SettingsSection } from "../pages/settings";
import type { AppMapRunReadiness } from "./app-map-run-readiness";

/**
 * Cross-surface requests and notifications for the golden Test workflow.
 *
 * Local editor behavior stays local. This seam is only for commands that must
 * cross shell ownership (for example, a Test asking the shell-owned target
 * picker to open). Keeping those commands here prevents product flow from
 * depending on untyped DOM event names.
 */
/** Imperative requests that must have one and only one mounted owner. */
export type WorkspaceRequest =
  | { kind: "target.choose" }
  | { kind: "device.toggle" }
  | { kind: "device.show" }
  | { kind: "device.hide" }
  | { kind: "run.open"; runId?: string }
  | { kind: "settings.open"; section?: SettingsSection }
  | { kind: "test.run" }
  | { kind: "test.record" }
  | { kind: "screen.capture" }
  | { kind: "map.target-set.choose"; targetSetId?: string }
  | { kind: "map.undo" }
  | { kind: "map.redo" }
  | { kind: "map.tidy" }
  | { kind: "map.history.toggle" }
  | { kind: "map.screen.reveal"; appMapId: string; screenId: string };

/** State notifications may be observed by any number of mounted surfaces. */
export type WorkspaceNotification =
  | { kind: "target.selected"; targetId: string }
  | { kind: "device.state"; open: boolean }
  | { kind: "test.run-readiness"; readiness: AppMapRunReadiness }
  | { kind: "map.target-set.state"; targetSetId?: string };

export type WorkspaceCommandAdapter = {
  chooseTarget?: () => void;
  targetSelected?: (targetId: string) => void;
  toggleDevice?: () => void;
  showDevice?: () => void;
  hideDevice?: () => void;
  deviceStateChanged?: (open: boolean) => void;
  openRun?: (runId?: string) => void;
  openSettings?: (section?: SettingsSection) => void;
  runTest?: () => void;
  runReadinessChanged?: (readiness: AppMapRunReadiness) => void;
  recordTest?: () => void;
  captureScreen?: () => void;
  chooseMapTargetSet?: (targetSetId?: string) => void;
  mapTargetSetChanged?: (targetSetId?: string) => void;
  undoMap?: () => void;
  redoMap?: () => void;
  tidyMap?: () => void;
  toggleMapHistory?: () => void;
  revealMapScreen?: (input: { appMapId: string; screenId: string }) => void;
};

export type WorkspaceController = {
  /** Request one imperative command from exactly one currently connected owner. */
  request(command: WorkspaceRequest): boolean;
  /** Publish one state notification to every currently connected observer. */
  publish(notification: WorkspaceNotification): boolean;
  /** Connect a surface owner. Disconnecting is idempotent. */
  connect(adapter: WorkspaceCommandAdapter): () => void;
};

function handlerFor(
  adapter: WorkspaceCommandAdapter,
  command: WorkspaceRequest | WorkspaceNotification,
): (() => void) | undefined {
  switch (command.kind) {
    case "target.choose":
      return adapter.chooseTarget;
    case "target.selected":
      return adapter.targetSelected ? () => adapter.targetSelected!(command.targetId) : undefined;
    case "device.toggle":
      return adapter.toggleDevice;
    case "device.show":
      return adapter.showDevice;
    case "device.hide":
      return adapter.hideDevice;
    case "device.state":
      return adapter.deviceStateChanged
        ? () => adapter.deviceStateChanged!(command.open)
        : undefined;
    case "run.open":
      return adapter.openRun ? () => adapter.openRun!(command.runId) : undefined;
    case "settings.open":
      return adapter.openSettings ? () => adapter.openSettings!(command.section) : undefined;
    case "test.run":
      return adapter.runTest;
    case "test.run-readiness":
      return adapter.runReadinessChanged
        ? () => adapter.runReadinessChanged!(command.readiness)
        : undefined;
    case "test.record":
      return adapter.recordTest;
    case "screen.capture":
      return adapter.captureScreen;
    case "map.target-set.choose":
      return adapter.chooseMapTargetSet
        ? () => adapter.chooseMapTargetSet!(command.targetSetId)
        : undefined;
    case "map.target-set.state":
      return adapter.mapTargetSetChanged
        ? () => adapter.mapTargetSetChanged!(command.targetSetId)
        : undefined;
    case "map.undo":
      return adapter.undoMap;
    case "map.redo":
      return adapter.redoMap;
    case "map.tidy":
      return adapter.tidyMap;
    case "map.history.toggle":
      return adapter.toggleMapHistory;
    case "map.screen.reveal":
      return adapter.revealMapScreen
        ? () => adapter.revealMapScreen!({ appMapId: command.appMapId, screenId: command.screenId })
        : undefined;
  }
}

/**
 * Create a controller whose interface is also its test seam. Imperative
 * requests are resolved against an adapter snapshot and rejected when zero or
 * multiple owners would handle them. Notifications intentionally fan out to
 * every observer in that same stable snapshot.
 */
export function createWorkspaceController(): WorkspaceController {
  const adapters = new Set<WorkspaceCommandAdapter>();

  return {
    request(command) {
      const handlers = Array.from(adapters)
        .map((adapter) => handlerFor(adapter, command))
        .filter((handler): handler is () => void => handler !== undefined);
      if (handlers.length > 1) {
        throw new Error(
          [
            `Workspace request ${JSON.stringify(command.kind)} has ${handlers.length} owners`,
            "expected exactly one",
          ].join("; "),
        );
      }
      if (handlers.length === 0) return false;
      handlers[0]!();
      return true;
    },
    publish(notification) {
      let handled = false;
      for (const adapter of Array.from(adapters)) {
        const handler = handlerFor(adapter, notification);
        if (!handler) continue;
        handler();
        handled = true;
      }
      return handled;
    },
    connect(adapter) {
      adapters.add(adapter);
      let connected = true;
      return () => {
        if (!connected) return;
        connected = false;
        adapters.delete(adapter);
      };
    },
  };
}
