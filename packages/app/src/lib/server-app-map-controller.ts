import { createSignal, type Accessor } from "solid-js";
import type {
  AppMap,
  DegradedAppMapRef,
  OperationId,
  OperationInput,
  OperationOutput,
} from "@relay/protocol";
import type { HealthState } from "./api-types";
import { createCoalescedRefresh } from "./coalesced-refresh";

type RunAction = <Id extends OperationId>(
  operationId: Id,
  input: OperationInput<Id>,
) => Promise<OperationOutput<Id>>;

export function createServerAppMapController(input: {
  health: Accessor<HealthState>;
  runAction: RunAction;
}) {
  const [appMaps, setAppMaps] = createSignal<AppMap[]>([]);
  const [degradedAppMaps, setDegradedAppMaps] = createSignal<DegradedAppMapRef[]>([]);
  const [appMapsLoaded, setAppMapsLoaded] = createSignal(false);

  const refreshAppMaps = createCoalescedRefresh(async (): Promise<AppMap[]> => {
    const result = await input.runAction("app-map.list", {});
    setAppMaps(result.appMaps);
    setDegradedAppMaps(result.degraded ?? []);
    setAppMapsLoaded(true);
    return result.appMaps;
  });

  function refreshAppMapsWhenOnline(): Promise<AppMap[]> {
    if (input.health() === "offline") return Promise.resolve(appMaps());
    return refreshAppMaps();
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

  return {
    appMaps,
    appMapsLoaded,
    degradedAppMaps,
    refreshAppMaps: refreshAppMapsWhenOnline,
    loadAppMap,
    createAppMap,
  };
}
