import type { WorkspaceCommandAdapter, WorkspaceController } from "./workspace-controller";

export type AppMapWorkspaceCommands = {
  targetSelected: () => void;
  toggleDevice: () => void;
  showDevice: () => void;
  hideDevice: () => void;
  runTest: () => void;
  recordTest: () => void;
  captureScreen: () => void;
};

/** Connect the Map editor to typed cross-surface commands. Keyboard handling
 * and temporary compatibility events remain separate concerns. */
export function connectAppMapWorkspaceCommands(
  controller: WorkspaceController | undefined,
  commands: AppMapWorkspaceCommands,
): () => void {
  if (!controller) return () => undefined;
  const adapter: WorkspaceCommandAdapter = {
    targetSelected: commands.targetSelected,
    toggleDevice: commands.toggleDevice,
    showDevice: commands.showDevice,
    hideDevice: commands.hideDevice,
    runTest: commands.runTest,
    recordTest: commands.recordTest,
    captureScreen: commands.captureScreen,
  };
  return controller.connect(adapter);
}
