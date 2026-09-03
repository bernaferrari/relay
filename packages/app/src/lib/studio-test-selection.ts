import type { Accessor } from "solid-js";
import { createSignal } from "solid-js";
import type { AppMap } from "@relay/protocol";
import { readRememberedTestSelection, rememberTestSelection } from "./studio-shell-preferences";

/** Own the active Test independently for every App Map and renderer session. */
export function createStudioTestSelection(selectedMap: Accessor<AppMap | null | undefined>) {
  const [selectedByMap, setSelectedByMap] = createSignal<Record<string, string>>({});

  return {
    selectedTestId: () => {
      const mapId = selectedMap()?.id;
      return mapId ? (selectedByMap()[mapId] ?? readRememberedTestSelection(mapId)) : undefined;
    },
    selectTest: (appMapId: string, testId: string) => {
      setSelectedByMap((current) => ({ ...current, [appMapId]: testId }));
      rememberTestSelection(appMapId, testId);
    },
  };
}
