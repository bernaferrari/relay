import { RelayClient } from "@relay/client";
import type {
  ProductRecordingBeginInput,
  ProductRecordingState,
} from "@relay/product/recording-journey";
import { createProductRecordingJourneyFromClient } from "@relay/product/recording-journey";
import type { Platform } from "../platform/types";

export type ProductAppOption = {
  id: string;
  name: string;
};

/** The only recording capability React components can see. It expresses
 * product intents rather than transports or workflow mutations. */
export type RecordingProductService = {
  listApps(): Promise<readonly ProductAppOption[]>;
  connect(): Promise<ProductRecordingState>;
  begin(input: ProductRecordingBeginInput): Promise<ProductRecordingState>;
  inspect(workflowId: string): Promise<ProductRecordingState>;
  recordCurrent(): Promise<ProductRecordingState>;
  checkpoint(label?: string): Promise<ProductRecordingState>;
  stop(): Promise<ProductRecordingState>;
  replay(): Promise<ProductRecordingState>;
  approve(): Promise<ProductRecordingState>;
};

export function createRecordingProductService(platform: Platform): RecordingProductService {
  const product = Promise.resolve().then(async () => {
    const connection = platform.getServerConnection
      ? await platform.getServerConnection()
      : {
          url: await platform.getServerUrl(),
          auth: { type: "none" as const },
          organizationId: "local",
          projectId: "default",
          actorId: `human:${crypto.randomUUID()}`,
          actorKind: "human" as const,
        };
    const client = new RelayClient(connection, { fetch: platform.fetch ?? fetch });
    return {
      client,
      journey: createProductRecordingJourneyFromClient({ client, actorId: connection.actorId }),
    };
  });

  return {
    async listApps() {
      const { appMaps } = await (await product).client.invoke("app-map.list", {});
      return appMaps.map((app) => ({ id: app.id, name: app.name }));
    },
    async connect() {
      return (await product).journey.connect();
    },
    async begin(input) {
      return (await product).journey.begin(input);
    },
    async inspect(workflowId) {
      return (await product).journey.inspect(workflowId);
    },
    async recordCurrent() {
      return (await product).journey.record({ kind: "observe" });
    },
    async checkpoint(label) {
      return (await product).journey.checkpoint(label);
    },
    async stop() {
      return (await product).journey.stop();
    },
    async replay() {
      return (await product).journey.replay();
    },
    async approve() {
      return (await product).journey.approve();
    },
  };
}

export type {
  ProductRecordingRecovery,
  ProductRecordingState,
} from "@relay/product/recording-journey";
