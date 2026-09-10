import type {
  ProductMapOverview,
  ProductMapProposal,
  ProductMapService,
} from "@relay/product/map-exploration";
import type { Platform } from "../platform/types";
import { productClientForPlatform } from "./product-client";
import type { OperationInput, OperationOutput } from "@relay/protocol";
import { createRelayOperationPort } from "@relay/workflows/operation-port";
import { acquireOwnLease } from "@relay/workflows/target-catalog";

export type MapProductService = Omit<ProductMapService, "prepareRefresh"> & {
  loadScreenshot?(uri: string): Promise<Blob>;
  loadAccessibilityTree?(uri: string): Promise<unknown>;
  prepareRefresh?(
    input: Omit<OperationInput<"app-map.screen.refresh.prepare">, "leaseId">,
  ): Promise<OperationOutput<"app-map.screen.refresh.prepare">>;
};

export function createMapProductService(platform: Platform): MapProductService {
  let servicePromise: Promise<ProductMapService> | undefined;
  function service() {
    servicePromise ??= productClientForPlatform(platform).then(async ({ client }) => {
      const { createProductMapService } = await import("@relay/product/map-exploration");
      return createProductMapService(client);
    });
    return servicePromise;
  }
  return {
    async prepareRefresh(input) {
      const { client, actorId } = await productClientForPlatform(platform);
      const leaseId = await acquireOwnLease(
        createRelayOperationPort(client),
        actorId,
        input.target.targetId,
      );
      const item = await service();
      if (!item.prepareRefresh) throw new Error("Screen updates are unavailable.");
      return item.prepareRefresh({ ...input, leaseId });
    },
    async applyRefresh(input) {
      const item = await service();
      if (!item.applyRefresh) throw new Error("Screen updates are unavailable.");
      return item.applyRefresh(input);
    },
    async loadAccessibilityTree(uri) {
      const match = /^relay-evidence:\/\/([a-f\d]{64})$/iu.exec(uri);
      if (!match) throw new Error("No retained accessibility tree.");
      const { client } = await productClientForPlatform(platform);
      const resource = await client.binaryResource(
        `/authoring-evidence/${match[1]}?mime=application/json`,
      );
      return JSON.parse(new TextDecoder().decode(new Uint8Array(resource.bytes))) as unknown;
    },
    async loadScreenshot(uri) {
      const match = /^relay-evidence:\/\/([a-f\d]{64})$/iu.exec(uri);
      if (!match) throw new Error("This screen has no supported retained screenshot.");
      const { client } = await productClientForPlatform(platform);
      const resource = await client.binaryResource(
        `/authoring-evidence/${match[1]}?mime=image/png`,
      );
      return new Blob([new Uint8Array(resource.bytes)], { type: "image/png" });
    },
    updateScreen: (input) =>
      service().then((item) => {
        if (!item.updateScreen) throw new TypeError("Screen editing is unavailable.");
        return item.updateScreen(input);
      }),
    get: (appMapId) => service().then((item) => item.get(appMapId)),
    getScreen: (appMapId, screenId) =>
      service().then((item) => item.getScreen?.(appMapId, screenId)),
    getPath: (appMapId, pathId) => service().then((item) => item.getPath?.(appMapId, pathId)),
    listProposals: (appMapId) =>
      service().then((item) => item.listProposals?.(appMapId) ?? Promise.resolve([])),
    approveProposal: (input) =>
      service().then((item) => {
        if (!item.approveProposal) throw new TypeError("Map proposal approval is unavailable.");
        return item.approveProposal(input);
      }),
    rejectProposal: (input) =>
      service().then((item) => {
        if (!item.rejectProposal) throw new TypeError("Map proposal rejection is unavailable.");
        return item.rejectProposal(input);
      }),
  };
}

export type { ProductMapOverview, ProductMapProposal };
