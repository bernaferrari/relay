import type { WorkspaceCommandAdapter, WorkspaceController } from "./workspace-controller";

export type AppMapWorkspaceCommands = {
  targetSelected: () => void;
  toggleDevice: () => void;
  showDevice: () => void;
  hideDevice: () => void;
  runTest: () => void;
  recordTest: () => void;
  captureScreen: () => void;
  undoMap: () => void;
  redoMap: () => void;
};

export type AppMapShellCommands = {
  chooseTargetSet: (targetSetId?: string) => void;
  tidyMap: () => void;
  toggleHistory: () => void;
  revealScreen: (input: { appMapId: string; screenId: string }) => void;
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
    undoMap: commands.undoMap,
    redoMap: commands.redoMap,
  };
  return controller.connect(adapter);
}

/** Connect Map metadata/history chrome to the same typed workspace seam while
 * keeping its implementation local to the canvas shell hook. */
export function connectAppMapShellCommands(
  controller: WorkspaceController | undefined,
  commands: AppMapShellCommands,
): () => void {
  if (!controller) return () => undefined;
  return controller.connect({
    chooseMapTargetSet: commands.chooseTargetSet,
    tidyMap: commands.tidyMap,
    toggleMapHistory: commands.toggleHistory,
    revealMapScreen: commands.revealScreen,
  });
}
