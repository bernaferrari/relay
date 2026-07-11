import { StudioShell } from "./studio-shell";

export function Workspace(props: { onOpenSettings: () => void }) {
  return <StudioShell onOpenSettings={props.onOpenSettings} />;
}
