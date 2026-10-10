import type {
  BrowserAuthenticationFixture,
  OperationInput,
  TargetDefinition,
} from "@relay/protocol";
import type { Platform } from "../platform/types";
import { productClientForPlatform } from "./product-client";

export type ProductBrowserAccountInput = Pick<
  OperationInput<"target.browser-auth.save">,
  "targetId" | "name" | "expiresAt" | "fixtureId"
>;

export type ProductBrowserAccount = {
  fixture: Pick<
    BrowserAuthenticationFixture,
    | "id"
    | "reference"
    | "revision"
    | "targetId"
    | "name"
    | "origins"
    | "cookieCount"
    | "createdAt"
    | "expiresAt"
    | "revokedAt"
    | "health"
  >;
  /** The browser that holds this login; `startUrl` is the website it opens. */
  target: Pick<TargetDefinition, "id" | "name"> & { startUrl?: string };
};

/** A managed browser a login can be saved in. */
export type ProductBrowserTarget = Pick<TargetDefinition, "id" | "name"> & { startUrl?: string };

export type ProductAccountLane = {
  id: string;
  targetId: string;
  kind: "fixture" | "signed-out";
  reference?: string;
};

export type ProductBrowserAccountHealth = {
  accounts: readonly ProductBrowserAccount[];
  summary: {
    liveCount: number;
    revokedCount: number;
    concurrentAccountsPossible: boolean;
    concurrentReason: string;
    lanes: readonly ProductAccountLane[];
    electronGrokLabPartitionPresent?: boolean;
    electronGrokLabReason?: string;
  };
};

export type BrowserAccountProductService = {
  saveBrowserAccount(input: ProductBrowserAccountInput): Promise<ProductBrowserAccount>;
  /** Refresh captures current managed-browser state into the same fixture id. */
  refreshBrowserAccount(
    input: ProductBrowserAccountInput & { fixtureId: string },
  ): Promise<ProductBrowserAccount>;
  revokeBrowserAccount(input: {
    targetId: string;
    reference: string;
  }): Promise<ProductBrowserAccount>;
  probeBrowserAccount(input: {
    targetId: string;
    reference: string;
  }): Promise<ProductBrowserAccount>;
  probeBrowserAccountHealth?(input: {
    targetId: string;
    probe?: boolean;
  }): Promise<ProductBrowserAccountHealth>;
  listAccountLanes?(): Promise<readonly ProductAccountLane[]>;
  openBrowserAccountForSignIn(input: { targetId: string; reference?: string }): Promise<void>;
};

export type OperationalAppResourcesProductService = AppResourcesProductService &
  BrowserAccountProductService & {
    probeBrowserAccountHealth: NonNullable<
      BrowserAccountProductService["probeBrowserAccountHealth"]
    >;
    listAccountLanes: NonNullable<BrowserAccountProductService["listAccountLanes"]>;
  };

/** Project-scoped app resources. Browser sign-ins are not silently attributed
 * to an App because the canonical contracts do not store that link. */
export type AppResourcesProductService = {
  createApp(name: string): Promise<{ id: string; name: string }>;
  listBrowserAccounts(): Promise<readonly ProductBrowserAccount[]>;
  listBrowserTargets?(): Promise<readonly ProductBrowserTarget[]>;
  /** Optional for existing read-only fixture adapters; production includes the operations below. */
  saveBrowserAccount?: BrowserAccountProductService["saveBrowserAccount"];
  refreshBrowserAccount?: BrowserAccountProductService["refreshBrowserAccount"];
  revokeBrowserAccount?: BrowserAccountProductService["revokeBrowserAccount"];
  probeBrowserAccount?: BrowserAccountProductService["probeBrowserAccount"];
  probeBrowserAccountHealth?: BrowserAccountProductService["probeBrowserAccountHealth"];
  listAccountLanes?: BrowserAccountProductService["listAccountLanes"];
  openBrowserAccountForSignIn?: BrowserAccountProductService["openBrowserAccountForSignIn"];
};

function projectBrowserTarget(target: TargetDefinition): ProductBrowserTarget {
  return {
    id: target.id,
    name: target.name,
    ...(target.kind === "browser" && target.browser?.startUrl
      ? { startUrl: target.browser.startUrl }
      : {}),
  };
}

function projectBrowserAccount(
  fixture: BrowserAuthenticationFixture,
  target: Pick<TargetDefinition, "id" | "name"> &
    Partial<Pick<TargetDefinition, "kind" | "browser">>,
): ProductBrowserAccount {
  return {
    fixture: {
      id: fixture.id,
      reference: fixture.reference,
      revision: fixture.revision,
      targetId: fixture.targetId,
      name: fixture.name,
      origins: [...fixture.origins],
      cookieCount: fixture.cookieCount,
      createdAt: fixture.createdAt,
      ...(fixture.expiresAt === undefined ? {} : { expiresAt: fixture.expiresAt }),
      ...(fixture.revokedAt === undefined ? {} : { revokedAt: fixture.revokedAt }),
      ...(fixture.health === undefined ? {} : { health: fixture.health }),
    },
    target: {
      id: target.id,
      name: target.name,
      ...(target.kind === "browser" && target.browser?.startUrl
        ? { startUrl: target.browser.startUrl }
        : {}),
    },
  };
}

export function appIdFromName(name: string, suffix = crypto.randomUUID().slice(0, 8)): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 48);
  return `${slug || "app"}-${suffix
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]/gu, "")
    .slice(0, 8)}`;
}

export function createAppResourcesProductService(
  platform: Platform,
): OperationalAppResourcesProductService {
  let clientPromise: ReturnType<typeof productClientForPlatform> | undefined;
  const client = () =>
    (clientPromise ??= productClientForPlatform(platform)).then((value) => value.client);

  return {
    async createApp(name) {
      const cleanName = name.trim();
      if (!cleanName) throw new TypeError("Enter an app name.");
      const { appMap } = await (
        await client()
      ).invoke("app-map.create", {
        appMapId: appIdFromName(cleanName),
        name: cleanName,
      });
      return { id: appMap.id, name: appMap.name };
    },
    async listBrowserTargets() {
      const { targets } = await (await client()).invoke("target.list", {});
      return targets
        .filter((target) => target.kind === "browser" && target.browser)
        .map(projectBrowserTarget);
    },
    async listBrowserAccounts() {
      const relay = await client();
      const { targets } = await relay.invoke("target.list", {});
      const browserTargets = targets.filter(
        (target) => target.kind === "browser" && target.browser,
      );
      const fixtures = await Promise.all(
        browserTargets.map(async (target) => ({
          target,
          fixtures: (await relay.invoke("target.browser-auth.list", { targetId: target.id }))
            .fixtures,
        })),
      );
      return fixtures
        .flatMap(({ target, fixtures: targetFixtures }) =>
          targetFixtures.map((fixture) => projectBrowserAccount(fixture, target)),
        )
        .sort(
          (left, right) =>
            right.fixture.createdAt - left.fixture.createdAt ||
            left.fixture.name.localeCompare(right.fixture.name),
        );
    },
    async saveBrowserAccount(input) {
      const result = await (
        await client()
      ).invoke("target.browser-auth.save", {
        ...input,
        confirm: true,
      });
      return projectBrowserAccount(result.fixture, result.target);
    },
    async refreshBrowserAccount(input) {
      const result = await (
        await client()
      ).invoke("target.browser-auth.save", {
        ...input,
        confirm: true,
      });
      return projectBrowserAccount(result.fixture, result.target);
    },
    async revokeBrowserAccount(input) {
      const result = await (
        await client()
      ).invoke("target.browser-auth.revoke", {
        ...input,
        confirm: true,
      });
      return projectBrowserAccount(result.fixture, result.target);
    },
    async probeBrowserAccount(input) {
      const result = await (await client()).invoke("target.browser-auth.probe", { ...input });
      return projectBrowserAccount(
        { ...result.fixture, health: result.health },
        { id: input.targetId, name: input.targetId },
      );
    },
    async probeBrowserAccountHealth(input) {
      const result = await (await client()).invoke("target.browser-auth.health", { ...input });
      const targets = await (await client()).invoke("target.list", {});
      const named = new Map(targets.targets.map((target) => [target.id, target.name]));
      return {
        accounts: result.fixtures.map((fixture) =>
          projectBrowserAccount(fixture, {
            id: fixture.targetId,
            name: named.get(fixture.targetId) ?? fixture.targetId,
          }),
        ),
        summary: {
          liveCount: result.summary.liveCount,
          revokedCount: result.summary.revokedCount,
          concurrentAccountsPossible: result.summary.concurrentAccountsPossible,
          concurrentReason: result.summary.concurrentReason,
          lanes: result.summary.lanes.map((lane) => ({
            id: lane.id,
            targetId: input.targetId,
            kind: lane.kind,
            ...(lane.kind === "fixture" ? { reference: lane.schedulingKey.split("#")[1] } : {}),
          })),
          electronGrokLabPartitionPresent: result.summary.electronGrokLabPartitionPresent,
          electronGrokLabReason: result.summary.electronGrokLabReason,
        },
      };
    },
    async listAccountLanes() {
      const { lanes } = await (await client()).invoke("lane.list", {});
      return lanes.flatMap((lane) => {
        if (lane.target.kind !== "browser") return [];
        const reference =
          lane.account?.kind === "fixture"
            ? (lane.account.reference ??
              `authfx:${lane.account.accountId}:${lane.account.accountRevision}`)
            : undefined;
        return [
          {
            id: lane.id,
            targetId: lane.target.browserTargetId,
            kind: reference ? ("fixture" as const) : ("signed-out" as const),
            ...(reference ? { reference } : {}),
          },
        ];
      });
    },
    async openBrowserAccountForSignIn(input) {
      await (
        await client()
      ).invoke("target.open", {
        targetId: input.targetId,
        ...(input.reference ? { authenticationFixtureReference: input.reference } : {}),
        presentation: "external",
      });
    },
  } as OperationalAppResourcesProductService;
}
