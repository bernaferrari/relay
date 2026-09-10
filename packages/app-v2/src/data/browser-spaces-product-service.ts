import type {
  AppMapCombine,
  BrowserAuthenticationFixture,
  BrowserEnvironmentInput,
  BrowserViewport,
  OperationInput,
  TargetDefinition,
} from "@relay/protocol";
import type { Platform } from "../platform/types";
import { productClientForPlatform } from "./product-client";

/**
 * Product-safe metadata for one managed browser identity. The profile itself
 * stays on the Relay host; this projection never exposes a profile directory
 * or cookies.
 */
export type ProductBrowserSpace = {
  readonly id: string;
  readonly name: string;
  readonly startUrl: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly headless?: boolean;
  readonly viewport?: BrowserViewport;
  readonly environment?: BrowserEnvironmentInput;
  readonly profileRetention: "retain" | "ephemeral";
  readonly persistent: boolean;
  readonly source: { readonly kind: "managed-browser-target"; readonly id: string };
};

export type ProductBrowserSpaceInput = Pick<
  OperationInput<"target.create">,
  "id" | "name" | "startUrl" | "headless" | "viewport" | "environment" | "profileRetention"
>;

/** Safe auth metadata; credential material remains inside the managed target. */
export type ProductBrowserAuthFixture = Pick<
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
>;

export type ProductBrowserAuthResult = {
  readonly fixture: ProductBrowserAuthFixture;
  readonly space: Pick<ProductBrowserSpace, "id" | "name">;
};

/**
 * A Compare Set is the product name for a saved App Map Combine. The Combine
 * remains the durable source of truth; no second local persistence layer is
 * implied by this view.
 */
export type ProductCompareSet = {
  readonly id: string;
  readonly appMapId: string;
  readonly name: string;
  readonly testIds: readonly string[];
  readonly variableIds: readonly string[];
  readonly strategy?: AppMapCombine["strategy"];
  readonly selected?: Readonly<Record<string, readonly string[]>>;
  readonly source: { readonly kind: "app-map-combine"; readonly id: string };
  readonly persistence: "saved";
};

/**
 * The server accepts a concise Combine body and fills App Map scope and
 * timestamps. Existing optional fields are preserved on update unless the
 * caller supplies a replacement.
 */
export type ProductCompareSetInput = Pick<AppMapCombine, "name" | "testIds" | "variableIds"> &
  Partial<
    Pick<
      AppMapCombine,
      "selected" | "strategy" | "captures" | "repeatPolicy" | "cellRuntimeProfiles"
    >
  >;

export type BrowserSpacesProductService = {
  listSpaces(): Promise<readonly ProductBrowserSpace[]>;
  createSpace(input: ProductBrowserSpaceInput): Promise<ProductBrowserSpace>;
  openSpace(
    input:
      | string
      | {
          spaceId: string;
          presentation?: "embedded" | "external";
          account?: { kind: "fixture"; reference: string } | { kind: "signed-out" };
        },
  ): Promise<{
    targetId: string;
    name: string;
    url: string;
    sessionId?: string;
    configurationDigest?: string;
    authenticationFixtureId?: string;
    signedOut?: true;
  }>;
  removeSpace(spaceId: string): Promise<void>;
  listAuthenticationFixtures(spaceId: string): Promise<readonly ProductBrowserAuthFixture[]>;
  saveAuthenticationFixture(input: {
    spaceId: string;
    name: string;
    expiresAt?: number;
    fixtureId?: string;
  }): Promise<ProductBrowserAuthResult>;
  refreshAuthenticationFixture(input: {
    spaceId: string;
    name: string;
    fixtureId: string;
    expiresAt?: number;
  }): Promise<ProductBrowserAuthResult>;
  revokeAuthenticationFixture(input: {
    spaceId: string;
    reference: string;
  }): Promise<ProductBrowserAuthResult>;
  listCompareSets(appMapId: string): Promise<readonly ProductCompareSet[]>;
  saveCompareSet(input: {
    appMapId: string;
    compareSetId: string;
    expectedRevision: number;
    compareSet: ProductCompareSetInput;
  }): Promise<ProductCompareSet>;
  removeCompareSet(input: {
    appMapId: string;
    compareSetId: string;
    expectedRevision: number;
  }): Promise<void>;
};

function projectSpace(target: TargetDefinition): ProductBrowserSpace | undefined {
  if (target.kind !== "browser" || !target.browser) return undefined;
  const profileRetention = target.browser.profileRetention ?? "retain";
  return {
    id: target.id,
    name: target.name,
    startUrl: target.browser.startUrl,
    createdAt: target.createdAt,
    updatedAt: target.updatedAt,
    ...(target.browser.headless === undefined ? {} : { headless: target.browser.headless }),
    ...(target.browser.viewport ? { viewport: structuredClone(target.browser.viewport) } : {}),
    ...(target.browser.environment
      ? { environment: structuredClone(target.browser.environment) }
      : {}),
    profileRetention,
    persistent: profileRetention === "retain",
    source: { kind: "managed-browser-target", id: target.id },
  };
}

/** Pure target projection, intentionally excluding non-browser targets. */
export function projectProductBrowserSpace(
  target: TargetDefinition,
): ProductBrowserSpace | undefined {
  return projectSpace(target);
}

function projectFixture(fixture: BrowserAuthenticationFixture): ProductBrowserAuthFixture {
  return {
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
  };
}

export function projectProductBrowserAuthFixture(
  fixture: BrowserAuthenticationFixture,
): ProductBrowserAuthFixture {
  return projectFixture(fixture);
}

function projectCompareSet(mapId: string, combine: AppMapCombine): ProductCompareSet {
  return {
    id: combine.id,
    appMapId: mapId,
    name: combine.name,
    testIds: [...combine.testIds],
    variableIds: [...combine.variableIds],
    ...(combine.strategy === undefined ? {} : { strategy: combine.strategy }),
    ...(combine.selected ? { selected: structuredClone(combine.selected) } : {}),
    source: { kind: "app-map-combine", id: combine.id },
    persistence: "saved",
  };
}

export function createBrowserSpacesProductService(platform: Platform): BrowserSpacesProductService {
  let clientPromise: ReturnType<typeof productClientForPlatform> | undefined;
  const client = () =>
    (clientPromise ??= productClientForPlatform(platform)).then(({ client: relay }) => relay);

  async function getSpace(spaceId: string): Promise<ProductBrowserSpace> {
    const { targets } = await (await client()).invoke("target.list", {});
    const space = targets.map(projectSpace).find((candidate) => candidate?.id === spaceId);
    if (!space) throw new TypeError("This browser is not available.");
    return space;
  }

  async function authResult(
    fixture: BrowserAuthenticationFixture,
    target: TargetDefinition,
  ): Promise<ProductBrowserAuthResult> {
    const space = projectSpace(target);
    if (!space) throw new TypeError("Relay returned something that is not a browser.");
    return { fixture: projectFixture(fixture), space: { id: space.id, name: space.name } };
  }

  async function saveAuthenticationFixture(input: {
    spaceId: string;
    name: string;
    expiresAt?: number;
    fixtureId?: string;
  }): Promise<ProductBrowserAuthResult> {
    await getSpace(input.spaceId);
    const name = input.name.trim();
    if (!name) throw new TypeError("Enter a sign-in name.");
    const { fixture, target } = await (
      await client()
    ).invoke("target.browser-auth.save", {
      targetId: input.spaceId,
      name,
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
      ...(input.fixtureId === undefined ? {} : { fixtureId: input.fixtureId }),
      confirm: true,
    });
    return authResult(fixture, target);
  }

  return {
    async listSpaces() {
      const { targets } = await (await client()).invoke("target.list", {});
      return targets
        .map(projectSpace)
        .filter((space): space is ProductBrowserSpace => space !== undefined)
        .sort(
          (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
        );
    },
    async createSpace(input) {
      const name = input.name.trim();
      if (!name) throw new TypeError("Enter a browser name.");
      const { target } = await (
        await client()
      ).invoke("target.create", {
        ...input,
        name,
        // Managed targets retain their isolated profile by default. An
        // explicit ephemeral request stays visible as non-persistent.
        profileRetention: input.profileRetention ?? "retain",
      });
      const space = projectSpace(target);
      if (!space) throw new TypeError("Relay created something that is not a browser.");
      return space;
    },
    async openSpace(input) {
      const request = typeof input === "string" ? { spaceId: input } : input;
      await getSpace(request.spaceId);
      const account = request.account;
      return (
        await (
          await client()
        ).invoke("target.open", {
          targetId: request.spaceId,
          presentation: request.presentation ?? "embedded",
          ...(account?.kind === "fixture"
            ? { authenticationFixtureReference: account.reference }
            : {}),
          ...(account?.kind === "signed-out" ? { signedOut: true as const } : {}),
        })
      ).session;
    },
    async removeSpace(spaceId) {
      await getSpace(spaceId);
      await (await client()).invoke("target.delete", { targetId: spaceId });
    },
    async listAuthenticationFixtures(spaceId) {
      await getSpace(spaceId);
      const { fixtures } = await (
        await client()
      ).invoke("target.browser-auth.list", {
        targetId: spaceId,
      });
      return fixtures.map(projectFixture).sort((left, right) => right.createdAt - left.createdAt);
    },
    saveAuthenticationFixture,
    async refreshAuthenticationFixture(input) {
      return saveAuthenticationFixture(input);
    },
    async revokeAuthenticationFixture(input) {
      await getSpace(input.spaceId);
      const { fixture, target } = await (
        await client()
      ).invoke("target.browser-auth.revoke", {
        targetId: input.spaceId,
        reference: input.reference,
        confirm: true,
      });
      return authResult(fixture, target);
    },
    async listCompareSets(appMapId) {
      const { appMap } = await (await client()).invoke("app-map.get", { appMapId });
      return Object.values(appMap.combines)
        .map((combine) => projectCompareSet(appMap.id, combine))
        .sort(
          (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
        );
    },
    async saveCompareSet(input) {
      const relay = await client();
      const { appMap } = await relay.invoke("app-map.get", { appMapId: input.appMapId });
      const current = appMap.combines[input.compareSetId];
      const combine = {
        ...current,
        ...input.compareSet,
      } as AppMapCombine;
      const result = await relay.invoke("app-map.combine.save", {
        appMapId: input.appMapId,
        combineId: input.compareSetId,
        expectedRevision: input.expectedRevision,
        combine: combine as OperationInput<"app-map.combine.save">["combine"],
      });
      const saved = result.appMap.combines[input.compareSetId];
      if (!saved) throw new TypeError("Relay saved the Compare Set without returning it.");
      return projectCompareSet(result.appMap.id, saved);
    },
    async removeCompareSet(input) {
      await (
        await client()
      ).invoke("app-map.combine.remove", {
        appMapId: input.appMapId,
        combineId: input.compareSetId,
        expectedRevision: input.expectedRevision,
      });
    },
  };
}
