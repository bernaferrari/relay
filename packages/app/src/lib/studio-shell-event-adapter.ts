import type { SettingsSection } from "../pages/settings";

/**
 * Compatibility adapter owned by settings CTAs and advanced/Repeat Run
 * surfaces that have not joined WorkspaceController. Map chrome is typed.
 */
export function connectLegacyStudioShellEvents(
  target: Window,
  actions: {
    onOpenSettings: (section?: SettingsSection) => void;
    onOpenRun: (jobId?: string) => void;
  },
): () => void {
  const onOpenSettings = (event: Event) => {
    actions.onOpenSettings((event as CustomEvent<{ section?: SettingsSection }>).detail?.section);
  };
  const onOpenRun = (event: Event) => {
    actions.onOpenRun((event as CustomEvent<{ jobId?: string }>).detail?.jobId);
  };

  target.addEventListener("relay:open-settings", onOpenSettings);
  target.addEventListener("relay:open-run-history", onOpenRun);

  return () => {
    target.removeEventListener("relay:open-settings", onOpenSettings);
    target.removeEventListener("relay:open-run-history", onOpenRun);
  };
}
