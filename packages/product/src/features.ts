import {
  createRelayOperationPort,
  type RelayInvokeClient,
  type RunTestOutcomeIntent,
  type RecordTestOutcomeIntent,
} from "@relay/workflows";
import { createRelayOutcomeJobs } from "@relay/workflows/outcomes";
import type { AppMap } from "@relay/protocol";
import { createProductRecordingJourney } from "./recording-journey.js";
import { createProductRunJourney } from "./run-journey.js";
export type ProductFeatures = ReturnType<typeof createProductFeatures>;
export function createProductFeatures(client: RelayInvokeClient, options: { actorId: string }) {
  const operations = createRelayOperationPort(client);
  const workflows = createRelayOutcomeJobs(client, options);
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
        for (const app of maps) if (app.tests[testId]) return app.tests[testId];
        return undefined;
      },
      record: (intent: RecordTestOutcomeIntent) => workflows.record(intent),
    },
    recording: createProductRecordingJourney({ jobs: workflows }),
    run: {
      list: () => operations.invoke("run.list", {}).then((result) => result.runs),
      start: (intent: RunTestOutcomeIntent) => workflows.run(intent),
      journey: createProductRunJourney({ jobs: workflows }),
    },
    device: {
      list: () => operations.invoke("target.list", {}).then((result) => result.targets),
    },
  };
}
export type ProductApp = AppMap;
