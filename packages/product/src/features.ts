import { createRelayOperationPort, type RelayInvokeClient } from "@relay/workflows/operation-port";
import type { RunTestOutcomeIntent, RecordTestOutcomeIntent } from "@relay/workflows/types";
import { createRelayRecordingOutcomeJobs } from "@relay/workflows/recording-outcomes";
import { createRelayRunOutcomeJobs } from "@relay/workflows/run-outcomes";
import type { AppMap } from "@relay/protocol";
import { createProductRecordingJourney } from "./recording-journey.js";
import { createProductRunJourney } from "./run-journey.js";
import { createProductChangeJourney } from "./change-journey.js";
import { findUniqueProductTestOwner } from "./test-identity.js";
export type ProductFeatures = ReturnType<typeof createProductFeatures>;
export function createProductFeatures(client: RelayInvokeClient, options: { actorId: string }) {
  const operations = createRelayOperationPort(client);
  const recording = createRelayRecordingOutcomeJobs(client, options);
  const run = createRelayRunOutcomeJobs(client, options);
  return {
    app: {
      list: () => operations.invoke("app-map.list", {}).then((result) => result.appMaps),
      get: (appId: string) =>
        operations.invoke("app-map.get", { appMapId: appId }).then((result) => result.appMap),
    },
    test: {
      list: async (appId: string) =>
        Object.values((await operations.invoke("app-map.get", { appMapId: appId })).appMap.tests),
      get: async (testId: string, appId?: string) => {
        if (appId)
          return (await operations.invoke("app-map.get", { appMapId: appId })).appMap.tests[testId];
        const maps = (await operations.invoke("app-map.list", {})).appMaps;
        return findUniqueProductTestOwner(maps, testId)?.test;
      },
      record: (intent: RecordTestOutcomeIntent) => recording.record(intent),
    },
    recording: createProductRecordingJourney({ jobs: recording }),
    run: {
      list: () => operations.invoke("run.list", {}).then((result) => result.runs),
      start: (intent: RunTestOutcomeIntent) => run.run(intent),
      journey: createProductRunJourney({ jobs: run }),
    },
    change: createProductChangeJourney({ operations }),
    device: {
      list: () => operations.invoke("target.list", {}).then((result) => result.targets),
    },
  };
}
export type ProductApp = AppMap;
