import type {
  BrowserAuthenticationFixture,
  OperationOutput,
  TargetDefinition,
} from "@relay/protocol";
import type { Platform } from "../platform/types";
import { productClientForPlatform } from "./product-client";

type RegisteredBuild = OperationOutput<"build.list">["builds"][number];

export type ProductAppVersion = Pick<
  RegisteredBuild,
  | "id"
  | "name"
  | "platform"
  | "status"
  | "applicationId"
  | "configuration"
  | "sourceSha"
  | "updatedAt"
>;

export type ProductBrowserAccount = {
  fixture: BrowserAuthenticationFixture;
  target: Pick<TargetDefinition, "id" | "name">;
};

/** Project-scoped app resources. Builds and browser sign-ins are not silently
 * attributed to an App because the canonical contracts do not store that link. */
export type AppResourcesProductService = {
  createApp(name: string): Promise<{ id: string; name: string }>;
  listVersions(): Promise<readonly ProductAppVersion[]>;
  listBrowserAccounts(): Promise<readonly ProductBrowserAccount[]>;
};

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

export function createAppResourcesProductService(platform: Platform): AppResourcesProductService {
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
    async listVersions() {
      const { builds } = await (await client()).invoke("build.list", {});
      return builds
        .map((build) => ({
          id: build.id,
          name: build.name,
          platform: build.platform,
          status: build.status,
          ...(build.applicationId ? { applicationId: build.applicationId } : {}),
          ...(build.configuration ? { configuration: build.configuration } : {}),
          ...(build.sourceSha ? { sourceSha: build.sourceSha } : {}),
          updatedAt: build.updatedAt,
        }))
        .sort(
          (left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name),
        );
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
          targetFixtures.map((fixture) => ({
            fixture,
            target: { id: target.id, name: target.name },
          })),
        )
        .sort(
          (left, right) =>
            right.fixture.createdAt - left.fixture.createdAt ||
            left.fixture.name.localeCompare(right.fixture.name),
        );
    },
  };
}
