import { createSignal, type Accessor } from "solid-js";
import type { AppMap, OperationId, OperationInput, OperationOutput } from "@relay/protocol";
import type { HealthState } from "./api-types";

type RunAction = <Id extends OperationId>(
  operationId: Id,
  input: OperationInput<Id>,
) => Promise<OperationOutput<Id>>;

export function createServerAppMapController(input: {
  health: Accessor<HealthState>;
  runAction: RunAction;
}) {
  const [appMaps, setAppMaps] = createSignal<AppMap[]>([]);
  const [appMapsLoaded, setAppMapsLoaded] = createSignal(false);

  async function refreshAppMaps(): Promise<AppMap[]> {
    if (input.health() === "offline") return appMaps();
    const result = await input.runAction("app-map.list", {});
    setAppMaps(result.appMaps);
    setAppMapsLoaded(true);
    return result.appMaps;
  }

  async function loadAppMap(appMapId: string): Promise<AppMap> {
    const appMap = (await input.runAction("app-map.get", { appMapId })).appMap;
    setAppMaps((current) => [appMap, ...current.filter((candidate) => candidate.id !== appMap.id)]);
    return appMap;
  }

  async function createAppMap(appMapId: string, name: string): Promise<AppMap> {
    const result = await input.runAction("app-map.create", { appMapId, name });
    setAppMaps((current) => [
      result.appMap,
      ...current.filter((candidate) => candidate.id !== result.appMap.id),
    ]);
    return result.appMap;
  }

  return { appMaps, appMapsLoaded, refreshAppMaps, loadAppMap, createAppMap };
}
