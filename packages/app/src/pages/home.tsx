import { Workspace } from "../components/workspace";
import type { SettingsSection } from "./settings";

export function HomePage(props: { onOpenSettings: (section?: SettingsSection) => void }) {
  return <Workspace onOpenSettings={props.onOpenSettings} />;
}
