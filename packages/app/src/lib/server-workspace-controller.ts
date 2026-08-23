import { createSignal, type Accessor } from "solid-js";
import type { AppMap } from "@relay/protocol";
import type { PlatformStorage } from "../context/platform";

export function createServerWorkspaceController(input: {
  storage: PlatformStorage;
  appMaps: Accessor<AppMap[]>;
}) {
  const [selectedAppMapId, setSelectedAppMapIdState] = createSignal<string | null>(null);
  const [prodAccountMatch, setProdAccountMatchState] = createSignal("");

  function setSelectedAppMapId(id: string | null): void {
    setSelectedAppMapIdState(id);
    void Promise.resolve(input.storage.set("selectedAppMap", id ?? "")).catch(() => undefined);
  }

  async function setProdAccountMatch(value: string): Promise<void> {
    const normalized = value.trim();
    setProdAccountMatchState(normalized);
    await Promise.resolve(input.storage.set("prodAccountMatch", normalized)).catch(() => undefined);
  }

  async function restore(): Promise<void> {
    const [savedMatch, savedAppMap] = await Promise.all([
      Promise.resolve(input.storage.get("prodAccountMatch")).catch(() => null),
      Promise.resolve(input.storage.get("selectedAppMap")).catch(() => null),
    ]);
    if (savedMatch) setProdAccountMatchState(savedMatch);
    if (savedAppMap) setSelectedAppMapIdState(savedAppMap);
  }

  function normalizeSelection(): void {
    const maps = input.appMaps();
    const selectedId = selectedAppMapId();
    if (selectedId && maps.some((map) => map.id === selectedId)) return;
    const latest = maps.toSorted((left, right) => right.updatedAt - left.updatedAt)[0];
    if (latest) {
      setSelectedAppMapId(latest.id);
    } else if (selectedId) {
      setSelectedAppMapId(null);
    }
  }

  return {
    selectedAppMapId,
    setSelectedAppMapId,
    prodAccountMatch,
    setProdAccountMatch,
    restore,
    normalizeSelection,
  };
}
