import type { ProductChange, ProductChangeState } from "@relay/product/change-journey";
import type { Platform } from "../platform/types";
import { productClientForPlatform } from "./product-client";

export type ChangeNameIndex = {
  readonly apps: Readonly<Record<string, string>>;
  readonly tests: Readonly<Record<string, string>>;
};

export type ProductChangeDetail = {
  readonly state: ProductChangeState;
  readonly names: ChangeNameIndex;
};

export type ChangeProductService = {
  list(): Promise<readonly ProductChange[]>;
  open(changeId: string): Promise<ProductChangeDetail>;
  prepare(): Promise<ProductChangeDetail>;
  approve(changeId: string, expectedVersion: number): Promise<ProductChangeDetail>;
  run(changeId: string, expectedVersion: number): Promise<ProductChangeDetail>;
  watch(input: {
    signal?: AbortSignal;
    onState?: (detail: ProductChangeDetail) => void;
  }): Promise<ProductChangeDetail>;
  cancel(changeId: string, expectedVersion: number): Promise<ProductChangeDetail>;
  rerunAffected(changeId: string, expectedVersion: number): Promise<ProductChangeDetail>;
  retryPublication(input: {
    changeId: string;
    publicationId: string;
    expectedVersion: number;
  }): Promise<ProductChangeDetail>;
};

type Runtime = {
  client: Awaited<ReturnType<typeof productClientForPlatform>>["client"];
  journey: ReturnType<
    (typeof import("@relay/product/change-journey"))["createProductChangeJourneyFromClient"]
  >;
};

export function createChangeProductService(platform: Platform): ChangeProductService {
  let runtimePromise: Promise<Runtime> | undefined;
  function runtime() {
    runtimePromise ??= Promise.all([
      productClientForPlatform(platform),
      import("@relay/product/change-journey"),
    ]).then(([{ client }, { createProductChangeJourneyFromClient }]) => ({
      client,
      journey: createProductChangeJourneyFromClient({ client }),
    }));
    return runtimePromise;
  }

  async function names(): Promise<ChangeNameIndex> {
    const { client } = await runtime();
    const { appMaps } = await client.invoke("app-map.list", {});
    const apps: Record<string, string> = {};
    const tests: Record<string, string> = {};
    for (const app of appMaps) {
      apps[app.id] = app.name;
      for (const test of Object.values(app.tests)) tests[`${app.id}:${test.id}`] = test.name;
    }
    return { apps, tests };
  }

  async function detail(state: ProductChangeState): Promise<ProductChangeDetail> {
    return { state, names: await names().catch(() => ({ apps: {}, tests: {} })) };
  }

  return {
    async list() {
      return (await runtime()).journey.list({ limit: 100 });
    },
    async open(changeId) {
      const { journey } = await runtime();
      return detail(await journey.open(changeId));
    },
    async prepare() {
      const { journey } = await runtime();
      return detail(await journey.prepare());
    },
    async approve(changeId, expectedVersion) {
      const { journey } = await runtime();
      return detail(
        await journey.approve({
          changeId,
          expectedVersion,
          decisionId: `relay-ui-${changeId}-${expectedVersion}`.slice(0, 256),
          reason: "Reviewed and approved in Relay.",
          confirm: true,
        }),
      );
    },
    async run(changeId, expectedVersion) {
      const { journey } = await runtime();
      return detail(await journey.run({ changeId, expectedVersion, wait: false }));
    },
    async watch(input) {
      const { journey } = await runtime();
      const nameIndex = await names().catch(() => ({ apps: {}, tests: {} }));
      const state = await journey.watch({
        signal: input.signal,
        onState: (next) => input.onState?.({ state: next, names: nameIndex }),
      });
      return { state, names: nameIndex };
    },
    async cancel(changeId, expectedVersion) {
      const { journey } = await runtime();
      return detail(await journey.cancel({ changeId, expectedVersion }));
    },
    async rerunAffected(changeId, expectedVersion) {
      const { journey } = await runtime();
      return detail(await journey.rerunAffected({ changeId, expectedVersion }));
    },
    async retryPublication(input) {
      const { journey } = await runtime();
      return detail(
        await journey.retryPublication({
          ...input,
          reason: "Retry requested after reviewing publication status in Relay.",
        }),
      );
    },
  };
}
