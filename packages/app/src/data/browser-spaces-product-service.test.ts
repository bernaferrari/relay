import { describe, expect, it, vi } from "vitest";
import type { AppMap, BrowserAuthenticationFixture, TargetDefinition } from "@relay/protocol";
import type { Platform } from "../platform/types";
import {
  createBrowserSpacesProductService,
  projectProductBrowserSpace,
} from "./browser-spaces-product-service";

const { calls, fixture, invoke, target } = vi.hoisted(() => {
  const target = (
    id: string,
    profileRetention: "retain" | "ephemeral" = "retain",
  ): TargetDefinition => ({
    id,
    name: id === "space-1" ? "Member" : "Throwaway",
    kind: "browser",
    createdAt: 1,
    updatedAt: 2,
    browser: {
      startUrl: "https://example.test",
      profileRetention,
      environment: { locale: "pt-BR", timezoneId: "UTC" },
    },
  });
  const fixture = {
    schemaVersion: 1,
    id: "00000000-0000-4000-8000-000000000001",
    reference: "authfx:00000000-0000-4000-8000-000000000001:1",
    revision: 1,
    projectId: "project-1",
    targetId: "space-1",
    name: "Member account",
    origins: ["https://example.test"],
    cookieCount: 2,
    createdAt: 1,
    createdBy: "human:test",
  } as BrowserAuthenticationFixture;
  const appMap = {
    id: "app-1",
    revision: 4,
    combines: {
      compare: {
        id: "compare",
        name: "Locales",
        variableIds: ["locale"],
        testIds: ["checkout"],
        strategy: "cartesian",
        selected: { locale: ["en", "pt"] },
      },
    },
  } as unknown as AppMap;
  const calls: Array<{ id: string; input: unknown }> = [];
  const invoke = vi.fn(async (id: string, input: unknown) => {
    calls.push({ id, input });
    if (id === "target.list") {
      return { targets: [target("space-1"), target("space-2", "ephemeral")] };
    }
    if (id === "target.create") return { target: target("space-3") };
    if (id === "target.browser-auth.list") return { fixtures: [fixture] };
    if (id === "target.browser-auth.save" || id === "target.browser-auth.revoke") {
      return { fixture, target: target("space-1") };
    }
    if (id === "app-map.get") return { appMap };
    if (id === "app-map.combine.save") {
      return {
        appMap: {
          ...appMap,
          revision: 5,
          combines: {
            ...appMap.combines,
            compare: { ...appMap.combines.compare, name: "Locales updated" },
          },
        },
      };
    }
    if (id === "target.delete" || id === "app-map.combine.remove") return { ok: true };
    if (id === "target.open") {
      const body = input as {
        targetId: string;
        authenticationFixtureReference?: string;
        signedOut?: true;
      };
      return {
        session: {
          targetId: body.targetId,
          name: body.targetId,
          url: "https://example.test/",
          ...(body.authenticationFixtureReference
            ? { authenticationFixtureId: body.authenticationFixtureReference }
            : {}),
          ...(body.signedOut ? { signedOut: true } : {}),
        },
      };
    }
    throw new Error(`Unexpected operation ${id}`);
  });
  return { appMap, calls, fixture, invoke, target };
});

vi.mock("./product-client", () => ({
  productClientForPlatform: async () => ({ client: { invoke } }),
}));

describe("browser spaces and compare set product service", () => {
  it("projects managed browser targets with explicit persistence semantics", () => {
    const persistent = projectProductBrowserSpace(target("space-1"));
    const ephemeral = projectProductBrowserSpace(target("space-2", "ephemeral"));
    expect(persistent).toMatchObject({
      id: "space-1",
      profileRetention: "retain",
      persistent: true,
      source: { kind: "managed-browser-target" },
    });
    expect(ephemeral).toMatchObject({ profileRetention: "ephemeral", persistent: false });
    expect(projectProductBrowserSpace({ ...target("device-1"), kind: "ios" })).toBeUndefined();
  });

  it("uses target lifecycle operations and preserves the retain default", async () => {
    calls.length = 0;
    const service = createBrowserSpacesProductService({} as Platform);
    const spaces = await service.listSpaces();
    expect(spaces.map(({ id }) => id)).toEqual(["space-1", "space-2"]);
    const created = await service.createSpace({
      name: " New space",
      startUrl: "https://new.test",
    });
    expect(created.persistent).toBe(true);
    expect(calls.find(({ id }) => id === "target.create")?.input).toMatchObject({
      name: "New space",
      profileRetention: "retain",
    });
    await service.removeSpace("space-1");
    expect(calls.map(({ id }) => id)).toContain("target.delete");
  });

  it("opens Live with the selected fixture or attested signed-out state", async () => {
    calls.length = 0;
    const service = createBrowserSpacesProductService({} as Platform);
    const member = await service.openSpace({
      spaceId: "space-1",
      account: { kind: "fixture", reference: fixture.reference },
    });
    const signedOut = await service.openSpace({
      spaceId: "space-2",
      account: { kind: "signed-out" },
    });
    expect(member.authenticationFixtureId).toBe(fixture.reference);
    expect(signedOut.signedOut).toBe(true);
    expect(calls.filter(({ id }) => id === "target.open").map(({ input }) => input)).toEqual([
      {
        targetId: "space-1",
        authenticationFixtureReference: fixture.reference,
        presentation: "embedded",
      },
      { targetId: "space-2", signedOut: true, presentation: "embedded" },
    ]);
    await service.openSpace({ spaceId: "space-1", presentation: "external" });
    expect(calls.filter(({ id }) => id === "target.open").at(-1)?.input).toMatchObject({
      presentation: "external",
    });
    await service.openSpace({ spaceId: "space-1", laneId: "grok-auth-gmail" });
    expect(calls.filter(({ id }) => id === "target.open").at(-1)?.input).toMatchObject({
      targetId: "space-1",
      laneId: "grok-auth-gmail",
      presentation: "embedded",
    });
  });

  it("keeps auth fixture operations versioned and metadata-only", async () => {
    calls.length = 0;
    const service = createBrowserSpacesProductService({} as Platform);
    expect(await service.listAuthenticationFixtures("space-1")).toMatchObject([
      { id: fixture.id, reference: fixture.reference, cookieCount: 2 },
    ]);
    await service.saveAuthenticationFixture({ spaceId: "space-1", name: "Member" });
    await service.refreshAuthenticationFixture({
      spaceId: "space-1",
      name: "Member refreshed",
      fixtureId: fixture.id,
    });
    await service.revokeAuthenticationFixture({
      spaceId: "space-1",
      reference: fixture.reference,
    });
    expect(
      calls.filter(({ id }) => id.startsWith("target.browser-auth")).map(({ id }) => id),
    ).toEqual([
      "target.browser-auth.list",
      "target.browser-auth.save",
      "target.browser-auth.save",
      "target.browser-auth.revoke",
    ]);
    expect(
      calls
        .filter(
          ({ id }) => id === "target.browser-auth.save" || id === "target.browser-auth.revoke",
        )
        .every(({ input }) => (input as { confirm?: boolean }).confirm === true),
    ).toBe(true);
    expect(JSON.stringify(await service.listAuthenticationFixtures("space-1"))).not.toMatch(
      /createdBy|revokedBy|cookieValue|password|token/iu,
    );
  });

  it("projects saved App Map Combines and writes them with revision guards", async () => {
    calls.length = 0;
    const service = createBrowserSpacesProductService({} as Platform);
    const compareSets = await service.listCompareSets("app-1");
    expect(compareSets[0]).toMatchObject({
      id: "compare",
      appMapId: "app-1",
      persistence: "saved",
      source: { kind: "app-map-combine", id: "compare" },
    });
    const saved = await service.saveCompareSet({
      appMapId: "app-1",
      compareSetId: "compare",
      expectedRevision: 4,
      compareSet: { name: "Locales updated", variableIds: ["locale"], testIds: ["checkout"] },
    });
    expect(saved.name).toBe("Locales updated");
    const saveCall = calls.find(({ id }) => id === "app-map.combine.save");
    expect(saveCall?.input).toMatchObject({
      appMapId: "app-1",
      combineId: "compare",
      expectedRevision: 4,
    });
    await service.removeCompareSet({
      appMapId: "app-1",
      compareSetId: "compare",
      expectedRevision: 5,
    });
    expect(calls.map(({ id }) => id)).toContain("app-map.combine.remove");
  });
});
