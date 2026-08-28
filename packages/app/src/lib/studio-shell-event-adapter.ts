import type { SettingsSection } from "../pages/settings";

/**
 * Compatibility adapter for Map-era DOM events that have not moved to the
 * WorkspaceController yet. Event names and payload casts stay confined here;
 * the Studio shell receives ordinary typed calls.
 */
export function connectLegacyStudioShellEvents(
  target: Window,
  actions: {
    onTargetSet: (targetSetId?: string) => void;
    onOpenSettings: (section?: SettingsSection) => void;
    onOpenRun: (jobId?: string) => void;
  },
): () => void {
  const onTargetSet = (event: Event) => {
    actions.onTargetSet((event as CustomEvent<{ targetSetId?: string }>).detail?.targetSetId);
  };
  const onOpenSettings = (event: Event) => {
    actions.onOpenSettings((event as CustomEvent<{ section?: SettingsSection }>).detail?.section);
  };
  const onOpenRun = (event: Event) => {
    actions.onOpenRun((event as CustomEvent<{ jobId?: string }>).detail?.jobId);
  };

  target.addEventListener("relay:target-set-state", onTargetSet);
  target.addEventListener("relay:open-settings", onOpenSettings);
  target.addEventListener("relay:open-run-history", onOpenRun);

  return () => {
    target.removeEventListener("relay:target-set-state", onTargetSet);
    target.removeEventListener("relay:open-settings", onOpenSettings);
    target.removeEventListener("relay:open-run-history", onOpenRun);
  };
}
