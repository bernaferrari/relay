import { Workspace } from "../components/workspace";

export function HomePage(props: { onOpenSettings: () => void }) {
  return <Workspace onOpenSettings={props.onOpenSettings} />;
}
