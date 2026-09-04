import type {
  ProductRecordingBeginInput,
  ProductRecordingState,
} from "@relay/product/recording-journey";
import type { Platform } from "../platform/types";
import { productClientForPlatform } from "./product-client";
import type { LiveTargetSession } from "./live-target-session";
import type { AuthoringTarget } from "@relay/protocol";
import { presentReadyTargets, type ProductTargetOption } from "./target-presentation";

export type ProductAppOption = {
  id: string;
  name: string;
};

/** The only recording capability React components can see. It expresses
 * product intents rather than transports or workflow mutations. */
export type RecordingProductService = {
  listApps(): Promise<readonly ProductAppOption[]>;
  connect(): Promise<ProductRecordingState>;
  presentTargets(targets: readonly AuthoringTarget[]): Promise<readonly ProductTargetOption[]>;
  begin(input: ProductRecordingBeginInput): Promise<ProductRecordingState>;
  inspect(workflowId: string): Promise<ProductRecordingState>;
  recordCurrent(): Promise<ProductRecordingState>;
  checkpoint(label?: string): Promise<ProductRecordingState>;
  stop(): Promise<ProductRecordingState>;
  replay(): Promise<ProductRecordingState>;
  approve(testName: string): Promise<ProductRecordingState>;
  /** Open the selected target for exploration before durable recording begins. */
  previewTarget?(target: AuthoringTarget): Promise<LiveTargetSession>;
  liveTarget?(target: AuthoringTarget): Promise<LiveTargetSession>;
};

export function createRecordingProductService(platform: Platform): RecordingProductService {
  let productPromise:
    | Promise<{
        client: Awaited<ReturnType<typeof productClientForPlatform>>["client"];
        journey: ReturnType<
          (typeof import("@relay/product/recording-journey"))["createProductRecordingJourneyFromClient"]
        >;
      }>
    | undefined;

  function product() {
    productPromise ??= Promise.resolve().then(async () => {
      const [{ client, actorId }, { createProductRecordingJourneyFromClient }] = await Promise.all([
        productClientForPlatform(platform),
        import("@relay/product/recording-journey"),
      ]);
      return {
        client,
        journey: createProductRecordingJourneyFromClient({ client, actorId }),
      };
    });
    return productPromise;
  }

  return {
    async listApps() {
      const { appMaps } = await (await product()).client.invoke("app-map.list", {});
      return appMaps.map((app) => ({ id: app.id, name: app.name }));
    },
    async connect() {
      return (await product()).journey.connect();
    },
    async presentTargets(targets) {
      return presentReadyTargets((await product()).client, targets);
    },
    async begin(input) {
      return (await product()).journey.begin(input);
    },
    async inspect(workflowId) {
      return (await product()).journey.inspect(workflowId);
    },
    async recordCurrent() {
      return (await product()).journey.record({ kind: "observe" });
    },
    async checkpoint(label) {
      return (await product()).journey.checkpoint(label);
    },
    async stop() {
      return (await product()).journey.stop();
    },
    async replay() {
      return (await product()).journey.replay();
    },
    async approve(testName) {
      return (await product()).journey.approve(testName);
    },
    async liveTarget(target) {
      const [recording, { createLiveTargetSession }] = await Promise.all([
        product(),
        import("./live-target-session"),
      ]);
      return createLiveTargetSession({
        client: recording.client,
        target,
        // Input from the live canvas is already the user's recording intent.
        // ProductRecordingJourney performs the canonical target mutation and
        // appends the same interaction to the durable authoring workflow.
        onInteraction: async (interaction) => {
          const state = await recording.journey.record(interaction);
          if (state.recovery) {
            throw new Error(`${state.recovery.detail} ${state.recovery.recovery}`.trim());
          }
        },
      });
    },
    async previewTarget(target) {
      const [recording, { createLiveTargetSession }] = await Promise.all([
        product(),
        import("./live-target-session"),
      ]);
      return createLiveTargetSession({ client: recording.client, target });
    },
  };
}

export type {
  ProductRecordingRecovery,
  ProductRecordingState,
} from "@relay/product/recording-journey";
