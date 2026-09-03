import type { JSX } from "solid-js";
import type { MapLibraryItem } from "../lib/app-map-library";
import type { MapLibraryArea } from "../lib/map-library-area";
import { MapLibrary } from "./studio-shell-workspaces";

export function StudioMapLibraryDrawer(props: {
  area: MapLibraryArea;
  onArea: (area: MapLibraryArea) => void;
  query: string;
  onQuery: (value: string) => void;
  items: MapLibraryItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onCreate: () => void;
  onImport: (yaml: string) => Promise<void>;
  onOpenSettings: () => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <>
      <MapLibrary open {...props} />
      <button
        type="button"
        class="fixed inset-0 z-[var(--z-shell-header)] cursor-default bg-black/10 backdrop-blur-[1px]"
        aria-label="Close navigator"
        onClick={props.onClose}
      />
    </>
  );
}
