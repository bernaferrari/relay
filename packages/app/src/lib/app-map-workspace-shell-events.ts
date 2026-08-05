/** Window events the App Map workspace listens for from the surrounding shell. */
export function bindAppMapWorkspaceShellEvents(handlers: {
  onChooseTargetSet: (targetSetId?: string) => void;
  onToggleHistory: () => void;
  onRevealScreen: (detail: { appMapId?: string; screenId?: string }) => void;
}): () => void {
  const chooseFromShell = (event: Event) => {
    const detail = (event as CustomEvent<{ targetSetId?: string }>).detail;
    handlers.onChooseTargetSet(detail?.targetSetId);
  };
  const toggleHistoryFromShell = () => {
    handlers.onToggleHistory();
  };
  const revealFromPalette = (
    event: Event & { detail?: { appMapId?: string; screenId?: string } },
  ) => {
    handlers.onRevealScreen(event.detail ?? {});
  };
  window.addEventListener("relay:choose-target-set", chooseFromShell);
  window.addEventListener("relay:toggle-map-history", toggleHistoryFromShell);
  window.addEventListener("relay:reveal-app-map-screen", revealFromPalette as EventListener);
  return () => {
    window.removeEventListener("relay:choose-target-set", chooseFromShell);
    window.removeEventListener("relay:toggle-map-history", toggleHistoryFromShell);
    window.removeEventListener("relay:reveal-app-map-screen", revealFromPalette as EventListener);
  };
}
