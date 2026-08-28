/**
 * Cross-surface commands for the golden Test workflow.
 *
 * Local editor behavior stays local. This seam is only for commands that must
 * cross shell ownership (for example, a Test asking the shell-owned target
 * picker to open). Keeping those commands here prevents product flow from
 * depending on untyped DOM event names.
 */
export type WorkspaceCommand =
  | { kind: "target.choose" }
  | { kind: "target.selected"; targetId: string }
  | { kind: "device.toggle" }
  | { kind: "device.show" }
  | { kind: "device.hide" }
  | { kind: "device.state"; open: boolean }
  | { kind: "run.open"; runId?: string }
  | { kind: "test.run" }
  | { kind: "test.run-readiness"; readiness: AppMapRunReadiness }
  | { kind: "test.record" }
  | { kind: "screen.capture" };

export type WorkspaceCommandAdapter = {
  chooseTarget?: () => void;
  targetSelected?: (targetId: string) => void;
  toggleDevice?: () => void;
  showDevice?: () => void;
  hideDevice?: () => void;
  deviceStateChanged?: (open: boolean) => void;
  openRun?: (runId?: string) => void;
  runTest?: () => void;
  runReadinessChanged?: (readiness: AppMapRunReadiness) => void;
  recordTest?: () => void;
  captureScreen?: () => void;
};

export type WorkspaceController = {
  /** Execute one typed command against every currently connected owner. */
  execute(command: WorkspaceCommand): boolean;
  /** Connect a surface owner. Disconnecting is idempotent. */
  connect(adapter: WorkspaceCommandAdapter): () => void;
};

function executeOn(adapter: WorkspaceCommandAdapter, command: WorkspaceCommand): boolean {
  switch (command.kind) {
    case "target.choose":
      adapter.chooseTarget?.();
      return adapter.chooseTarget !== undefined;
    case "target.selected":
      adapter.targetSelected?.(command.targetId);
      return adapter.targetSelected !== undefined;
    case "device.toggle":
      adapter.toggleDevice?.();
      return adapter.toggleDevice !== undefined;
    case "device.show":
      adapter.showDevice?.();
      return adapter.showDevice !== undefined;
    case "device.hide":
      adapter.hideDevice?.();
      return adapter.hideDevice !== undefined;
    case "device.state":
      adapter.deviceStateChanged?.(command.open);
      return adapter.deviceStateChanged !== undefined;
    case "run.open":
      adapter.openRun?.(command.runId);
      return adapter.openRun !== undefined;
    case "test.run":
      adapter.runTest?.();
      return adapter.runTest !== undefined;
    case "test.run-readiness":
      adapter.runReadinessChanged?.(command.readiness);
      return adapter.runReadinessChanged !== undefined;
    case "test.record":
      adapter.recordTest?.();
      return adapter.recordTest !== undefined;
    case "screen.capture":
      adapter.captureScreen?.();
      return adapter.captureScreen !== undefined;
  }
}

/**
 * Create a controller whose interface is also its test seam. A command is
 * broadcast because shell chrome and the active workspace can each own one
 * part of the response (showing the Test device rail while closing shell
 * properties, for example). The adapter snapshot makes connect/disconnect
 * during a command safe and deterministic.
 */
export function createWorkspaceController(): WorkspaceController {
  const adapters = new Set<WorkspaceCommandAdapter>();

  return {
    execute(command) {
      let handled = false;
      for (const adapter of Array.from(adapters)) {
        handled = executeOn(adapter, command) || handled;
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
import type { AppMapRunReadiness } from "./app-map-run-readiness";
