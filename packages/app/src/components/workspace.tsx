import { StudioShell } from "./studio-shell";
import type { SettingsSection } from "../pages/settings";

export function Workspace(props: { onOpenSettings: (section?: SettingsSection) => void }) {
  return <StudioShell onOpenSettings={props.onOpenSettings} />;
}
