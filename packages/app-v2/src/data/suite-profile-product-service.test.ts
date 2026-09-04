import { describe, expect, it, vi } from "vitest";
import type {
  AppMap,
  AppMapCombine,
  BrowserAuthenticationFixture,
  OperationOutput,
  TargetDefinition,
} from "@relay/protocol";
import {
  assessProductAuthenticationFixture,
  createSuiteProfileProductService,
  projectProductEnvironmentProfiles,
  projectProductSuite,
} from "./suite-profile-product-service";

const relay = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("./product-client", () => ({
  productClientForPlatform: vi.fn(async () => ({ client: relay })),
}));

const map = {
  id: "app-1",
  revision: 3,
  name: "Checkout",
  tests: {
    login: {
      id: "login",
      name: "Login",
      steps: [
        {
          id: "step-1",
          kind: "instruction",
          intent: "Enter credentials",
          binding: { status: "resolved" },
          execution: { status: "enabled" },
        },
      ],
    },
  },
} as unknown as AppMap;

const combine = {
  id: "combine-1",
  name: "Critical paths",
  testIds: ["login"],
  variableIds: ["locale"],
  strategy: "cartesian",
  selected: { locale: ["en", "pt"] },
} as unknown as AppMapCombine;

const target = (id: string, kind: TargetDefinition["kind"]): TargetDefinition => ({
  id,
  name: kind === "browser" ? "Chrome" : "QA iPhone",
  kind,
  createdAt: 1,
  updatedAt: 2,
  ...(kind === "browser"
    ? {
        browser: {
          startUrl: "https://example.test",
          environment: { locale: "pt-BR", timezoneId: "UTC" },
        },
      }
    : {}),
});

const build = {
  id: "build-1",
  projectId: "project-1",
  name: "Web release",
  platform: "web",
  status: "ready",
  updatedAt: 10,
  createdAt: 1,
} as OperationOutput<"build.list">["builds"][number];

const fixture = {
  schemaVersion: 1,
  id: "00000000-0000-4000-8000-000000000001",
  reference: "authfx:00000000-0000-4000-8000-000000000001:1",
  revision: 1,
  projectId: "project-1",
  targetId: "browser-1",
  name: "Staging account",
  origins: ["https://example.test"],
  cookieCount: 2,
  createdAt: 1,
  createdBy: "human:tester",
  expiresAt: 100,
} as BrowserAuthenticationFixture;

describe("suite and environment product projections", () => {
  it("projects a saved Combine as a public Suite without copying engine state", () => {
    const suite = projectProductSuite(map, combine);
    expect(suite).toMatchObject({
      id: "combine-1",
      appMapId: "app-1",
      appMapRevision: 3,
      name: "Critical paths",
      testIds: ["login"],
      variableIds: ["locale"],
      source: { kind: "app-map-combine", id: "combine-1" },
    });
    expect(JSON.stringify(suite)).not.toMatch(/cell|targetProfile|recipeGraph/iu);
    expect(suite.selected).not.toBe(combine.selected);
  });

  it("keeps browser environment and auth metadata target-scoped while leaving builds unbound", () => {
    const profiles = projectProductEnvironmentProfiles({
      targets: [target("browser-1", "browser"), target("ios-1", "ios")],
      builds: [build],
      fixtures: [fixture],
    });
    const browser = profiles.find((profile) => profile.id === "browser-1")!;
    const ios = profiles.find((profile) => profile.id === "ios-1")!;
    expect(browser.browserEnvironment).toEqual({ locale: "pt-BR", timezoneId: "UTC" });
    expect(browser.source).toEqual({ kind: "managed-target", id: "browser-1" });
    expect(browser.authenticationOptions.map(({ name }) => name)).toEqual(["Staging account"]);
    expect(ios.authenticationOptions).toEqual([]);
    expect(browser.buildOptions.map(({ id }) => id)).toEqual(["build-1"]);
    expect(ios.buildOptions).toEqual([]);
    expect(JSON.stringify(browser)).not.toMatch(/token|password|secret/iu);
    expect(assessProductAuthenticationFixture(browser, fixture.reference, 2).ok).toBe(true);
    expect(assessProductAuthenticationFixture(browser, fixture.reference, 100)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/expired/i),
    });
  });

  it("loads a Suite editor from the current App Map revision", async () => {
    const editorMap = {
      ...map,
      revision: 11,
      tests: {
        ...map.tests,
        empty: { id: "empty", name: "Empty", steps: [] },
      },
      variables: {
        locale: {
          id: "locale",
          name: "Locale",
          kind: "language",
          options: [
            { id: "en", label: "English" },
            { id: "pt", label: "Português" },
          ],
        },
      },
    } as unknown as AppMap;
    relay.invoke.mockReset().mockResolvedValueOnce({ appMap: editorMap });
    const editor = await createSuiteProfileProductService({} as never).getSuiteEditor("app-1");
    expect(editor).toMatchObject({
      appMapId: "app-1",
      appName: "Checkout",
      revision: 11,
      dataSets: [{ id: "locale", name: "Locale", kind: "language", optionCount: 2 }],
    });
    expect(editor.tests.map(({ id }) => id)).toEqual(["empty", "login"]);
    expect(editor.tests.find(({ id }) => id === "empty")?.status).toBe("needs-review");
    expect(relay.invoke).toHaveBeenCalledWith("app-map.get", { appMapId: "app-1" });
  });

  it("saves and removes Suites through revision-guarded Combine operations", async () => {
    relay.invoke.mockReset();
    relay.invoke.mockImplementation(async (operation: string, input: Record<string, unknown>) => {
      if (operation === "app-map.get") return { appMap: map };
      if (operation === "app-map.combine.save") {
        return {
          appMap: {
            ...map,
            revision: 4,
            combines: {
              "suite-new": {
                ...(input.combine as object),
                id: "suite-new",
              },
            },
          },
        };
      }
      if (operation === "app-map.combine.remove") return { appMap: { ...map, combines: {} } };
      throw new Error(`Unexpected operation ${operation}`);
    });
    const source = {
      ...map,
      variables: {},
      combines: {},
    } as AppMap;
    relay.invoke.mockResolvedValueOnce({ appMap: source }).mockImplementationOnce(async () => ({
      appMap: {
        ...source,
        revision: 4,
        combines: {
          "suite-new": {
            id: "suite-new",
            name: "Smoke",
            testIds: ["login"],
            variableIds: [],
            strategy: "cartesian",
          },
        },
      },
    }));
    const service = createSuiteProfileProductService({} as never);

    const saved = await service.saveSuite({
      appMapId: "app-1",
      suiteId: "suite-new",
      expectedRevision: 3,
      name: " Smoke ",
      testIds: ["login", "login"],
      variableIds: [],
      strategy: "cartesian",
    });

    expect(saved).toMatchObject({ name: "Smoke", appMapRevision: 4 });
    expect(relay.invoke).toHaveBeenNthCalledWith(
      2,
      "app-map.combine.save",
      expect.objectContaining({
        combineId: "suite-new",
        expectedRevision: 3,
        combine: expect.objectContaining({ name: "Smoke", testIds: ["login"] }),
      }),
    );

    relay.invoke.mockReset();
    relay.invoke
      .mockResolvedValueOnce({ appMap: savedMapWithSuite() })
      .mockResolvedValueOnce({ appMap: { ...savedMapWithSuite(), combines: {} } });
    await service.removeSuite({ appMapId: "app-1", suiteId: "suite-new", expectedRevision: 4 });
    expect(relay.invoke).toHaveBeenLastCalledWith("app-map.combine.remove", {
      appMapId: "app-1",
      combineId: "suite-new",
      expectedRevision: 4,
    });
  });

  it("rejects stale or invalid Suite saves before mutating the App Map", async () => {
    const source = {
      ...map,
      variables: {
        locale: {
          id: "locale",
          name: "Locale",
          kind: "language",
          options: [{ id: "en", label: "English" }],
        },
      },
      combines: {},
    } as unknown as AppMap;
    const service = createSuiteProfileProductService({} as never);
    const cases = [
      {
        expectedRevision: 2,
        name: "Smoke",
        testIds: ["login"],
        variableIds: [],
        message: /changed while/iu,
      },
      {
        expectedRevision: 3,
        name: "   ",
        testIds: ["login"],
        variableIds: [],
        message: /name/iu,
      },
      {
        expectedRevision: 3,
        name: "Smoke",
        testIds: [],
        variableIds: [],
        message: /at least one Test/iu,
      },
      {
        expectedRevision: 3,
        name: "Smoke",
        testIds: ["missing"],
        variableIds: [],
        message: /Test missing/iu,
      },
      {
        expectedRevision: 3,
        name: "Smoke",
        testIds: ["login"],
        variableIds: ["missing"],
        message: /Data set missing/iu,
      },
    ] as const;
    for (const input of cases) {
      relay.invoke.mockReset().mockResolvedValueOnce({ appMap: source });
      await expect(
        service.saveSuite({
          appMapId: "app-1",
          suiteId: "suite-new",
          expectedRevision: input.expectedRevision,
          name: input.name,
          testIds: input.testIds,
          variableIds: input.variableIds,
          strategy: "cartesian",
        }),
      ).rejects.toThrow(input.message);
      expect(relay.invoke).toHaveBeenCalledTimes(1);
      expect(relay.invoke).not.toHaveBeenCalledWith("app-map.combine.save", expect.anything());
    }
  });

  it("includes a failed target preflight as a preview blocker for a browser environment", async () => {
    const browserMap = { ...map, combines: { [combine.id]: combine } } as unknown as AppMap;
    const browser = target("browser-1", "browser");
    relay.invoke.mockReset().mockImplementation(async (operation: string) => {
      if (operation === "app-map.get") return { appMap: browserMap };
      if (operation === "target.list") return { targets: [browser] };
      if (operation === "build.list") return { builds: [] };
      if (operation === "target.browser-auth.list") return { fixtures: [] };
      if (operation === "app-map.combine.preflight") {
        return { preflight: { deviceRuns: 1, checks: 1, blockers: [], warnings: [] } };
      }
      if (operation === "target.preflight") {
        return {
          preflight: {
            targetId: "browser-1",
            ok: false,
            checkedAt: 4,
            capabilities: [],
            checks: [
              {
                id: "browser-process",
                label: "Browser process",
                status: "fail",
                message: "Browser is closed.",
              },
            ],
          },
        };
      }
      throw new Error(`Unexpected operation ${operation}`);
    });
    const preview = await createSuiteProfileProductService({} as never).previewSuite({
      appMapId: "app-1",
      suiteId: combine.id,
      profileId: "browser-1",
    });
    expect(preview.environment?.targetId).toBe("browser-1");
    expect(preview.blockers).toEqual([
      { code: "target-browser-process", message: "Browser is closed." },
    ]);
    expect(relay.invoke).toHaveBeenCalledWith("target.preflight", { targetId: "browser-1" });
    expect(relay.invoke).toHaveBeenCalledWith("app-map.combine.preflight", {
      appMapId: "app-1",
      combineId: combine.id,
    });
  });

  it("passes the selected device to target-aware preview and separates target warnings", async () => {
    const deviceMap = { ...map, combines: { [combine.id]: combine } } as unknown as AppMap;
    const device = target("ios-1", "ios");
    relay.invoke.mockReset().mockImplementation(async (operation: string, input: unknown) => {
      if (operation === "app-map.get") return { appMap: deviceMap };
      if (operation === "target.list") return { targets: [device] };
      if (operation === "build.list") return { builds: [] };
      if (operation === "app-map.combine.preflight") {
        expect(input).toEqual({ appMapId: "app-1", combineId: combine.id, serial: "ios-1" });
        return { preflight: { deviceRuns: 1, checks: 1, blockers: [], warnings: [] } };
      }
      if (operation === "target.preflight") {
        return {
          preflight: {
            targetId: "ios-1",
            ok: true,
            checkedAt: 4,
            capabilities: ["tap"],
            checks: [
              {
                id: "runner",
                label: "Runner",
                status: "warning",
                message: "Warm-up required.",
              },
            ],
          },
        };
      }
      throw new Error(`Unexpected operation ${operation}`);
    });
    const preview = await createSuiteProfileProductService({} as never).previewSuite({
      appMapId: "app-1",
      suiteId: combine.id,
      profileId: "ios-1",
    });
    expect(preview.blockers).toEqual([]);
    expect(preview.warnings).toEqual([{ code: "target-runner", message: "Warm-up required." }]);
  });

  it("starts a browser Suite with an exact managed target and returns campaign identity", async () => {
    const browserMap = { ...map, combines: { [combine.id]: combine } } as unknown as AppMap;
    relay.invoke.mockReset().mockImplementation(async (operation: string, input: unknown) => {
      if (operation === "target.list") return { targets: [target("browser-1", "browser")] };
      if (operation === "build.list") return { builds: [] };
      if (operation === "target.browser-auth.list") return { fixtures: [] };
      if (operation === "job.combine.start") {
        expect(input).toEqual({
          appMapId: "app-1",
          combineId: combine.id,
          executionMode: "all",
          targetKind: "browser",
          browserTargetId: "browser-1",
        });
        return { campaign: { id: "campaign-browser" }, batch: { id: "batch-browser" } };
      }
      throw new Error(`Unexpected operation ${operation}`);
    });
    await expect(
      createSuiteProfileProductService({} as never).startSuite({
        appMapId: browserMap.id,
        suiteId: combine.id,
        profileId: "browser-1",
        executionMode: "all",
      }),
    ).resolves.toEqual({ batchId: "campaign-browser" });
  });

  it("starts a device Suite with serial/platform and falls back to the returned batch", async () => {
    relay.invoke.mockReset().mockImplementation(async (operation: string, input: unknown) => {
      if (operation === "target.list") return { targets: [target("ios-1", "ios")] };
      if (operation === "build.list") return { builds: [] };
      if (operation === "job.combine.start") {
        expect(input).toEqual({
          appMapId: "app-1",
          combineId: combine.id,
          executionMode: "pilot",
          targetKind: "device",
          serial: "ios-1",
          platform: "ios",
        });
        return { batch: { id: "batch-device" } };
      }
      throw new Error(`Unexpected operation ${operation}`);
    });
    await expect(
      createSuiteProfileProductService({} as never).startSuite({
        appMapId: "app-1",
        suiteId: combine.id,
        profileId: "ios-1",
      }),
    ).resolves.toEqual({ batchId: "batch-device" });
  });
});

function savedMapWithSuite(): AppMap {
  return {
    ...map,
    revision: 4,
    combines: {
      "suite-new": {
        id: "suite-new",
        name: "Smoke",
        testIds: ["login"],
        variableIds: [],
        strategy: "cartesian",
      },
    },
  } as unknown as AppMap;
}
