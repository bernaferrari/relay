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
    expect(relay.invoke).toHaveBeenCalledWith(
      "app-map.combine.preflight",
      expect.objectContaining({
        appMapId: "app-1",
        combineId: combine.id,
        browserTargetId: "browser-1",
        targetKind: "browser",
      }),
    );
  });

  it("passes the selected device to target-aware preview and separates target warnings", async () => {
    const deviceMap = { ...map, combines: { [combine.id]: combine } } as unknown as AppMap;
    const device = target("ios-1", "ios");
    relay.invoke.mockReset().mockImplementation(async (operation: string, input: unknown) => {
      if (operation === "app-map.get") return { appMap: deviceMap };
      if (operation === "target.list") return { targets: [device] };
      if (operation === "build.list") return { builds: [] };
      if (operation === "app-map.combine.preflight") {
        expect(input).toEqual({
          appMapId: "app-1",
          combineId: combine.id,
          serial: "ios-1",
          profileTargets: [
            {
              profileId: "ios-1",
              target: { targetKind: "device", serial: "ios-1", platform: "ios" },
            },
          ],
        });
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

  it("surfaces observed serial Plan duration and never a guessed recipe estimate", async () => {
    const browserMap = { ...map, combines: { [combine.id]: combine } } as unknown as AppMap;
    const browser = target("browser-1", "browser");
    relay.invoke.mockReset().mockImplementation(async (operation: string) => {
      if (operation === "app-map.get") return { appMap: browserMap };
      if (operation === "target.list") return { targets: [browser] };
      if (operation === "build.list") return { builds: [] };
      if (operation === "target.browser-auth.list") return { fixtures: [] };
      if (operation === "app-map.combine.preflight") {
        return {
          preflight: {
            deviceRuns: 1,
            checks: 7,
            blockers: [],
            warnings: [],
            estimatedDurationMs: 12_000,
            observedDuration: {
              durationMs: 143_000,
              provenance: "observed-sample",
              sampleCount: 1,
              workItemCount: 7,
              campaignIds: ["seven-a"],
            },
          },
        };
      }
      if (operation === "target.preflight") {
        return {
          preflight: {
            targetId: "browser-1",
            ok: true,
            checkedAt: 4,
            capabilities: [],
            checks: [],
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
    expect(preview.execution).toMatchObject({
      capacity: "single-target",
      duration: "observed",
      estimatedDurationMs: 143_000,
    });
    expect(preview.execution?.detail).toMatch(/Observed serial about 2\.4 min/u);
    expect(preview.execution?.detail).toMatch(/p95 needs 3 runs/u);
    expect(preview.execution?.detail).toMatch(/Parallel wall-clock is unmeasured/u);
    expect(preview.execution?.detail).not.toMatch(/Quoted parallel/u);
    expect(preview.execution?.detail).not.toMatch(/12/u);
  });

  it("quotes eight-Test daily serial p95 and never twoLane 17s", async () => {
    const browserMap = { ...map, combines: { [combine.id]: combine } } as unknown as AppMap;
    const browser = target("browser-1", "browser");
    relay.invoke.mockReset().mockImplementation(async (operation: string) => {
      if (operation === "app-map.get") return { appMap: browserMap };
      if (operation === "target.list") return { targets: [browser] };
      if (operation === "build.list") return { builds: [] };
      if (operation === "target.browser-auth.list") return { fixtures: [] };
      if (operation === "app-map.combine.preflight") {
        return {
          preflight: {
            deviceRuns: 1,
            checks: 8,
            blockers: [],
            warnings: [],
            estimatedDurationMs: 17_254,
            observedDuration: {
              durationMs: 203_184,
              provenance: "observed-p95",
              sampleCount: 5,
              workItemCount: 8,
              campaignIds: ["a01ab9ca"],
            },
          },
          accountCapacity: {
            estimatedParallelDurationMs: 17_254,
            laneCount: 1,
            workItems: 8,
            workItemDurationMs: 17_254,
            observedDurationMs: 17_254,
            observedWorkItemCount: 2,
          },
        };
      }
      if (operation === "target.preflight") {
        return {
          preflight: {
            targetId: "browser-1",
            ok: true,
            checkedAt: 4,
            capabilities: [],
            checks: [],
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
    expect(preview.execution).toMatchObject({
      capacity: "single-target",
      duration: "observed",
      estimatedDurationMs: 203_184,
    });
    expect(preview.execution?.detail).toMatch(/Observed serial about 3\.4 min/u);
    expect(preview.execution?.detail).toMatch(/5 completed Plan runs \(p95\)/u);
    expect(preview.execution?.detail).toMatch(/Parallel wall-clock is unmeasured/u);
    expect(preview.execution?.detail).not.toMatch(/about 17s/u);
    expect(preview.execution?.estimatedDurationMs).not.toBe(17_254);
  });

  it("keeps Plan preview on observed serial when parallel wall-clock is unmeasured", async () => {
    const browserMap = { ...map, combines: { [combine.id]: combine } } as unknown as AppMap;
    const browser = target("browser-1", "browser");
    relay.invoke.mockReset().mockImplementation(async (operation: string) => {
      if (operation === "app-map.get") return { appMap: browserMap };
      if (operation === "target.list") return { targets: [browser] };
      if (operation === "build.list") return { builds: [] };
      if (operation === "target.browser-auth.list") return { fixtures: [] };
      if (operation === "app-map.combine.preflight") {
        return {
          preflight: {
            deviceRuns: 1,
            checks: 1,
            blockers: [],
            warnings: [],
            observedDuration: {
              durationMs: 14_868,
              provenance: "observed-sample",
              sampleCount: 1,
              workItemCount: 1,
              campaignIds: ["live-3-account"],
            },
          },
          accountCapacity: {
            estimatedParallelDurationMs: 14_868,
            laneCount: 3,
            workItems: 3,
            workItemDurationMs: 14_868,
            observedDurationMs: 14_868,
            observedWorkItemCount: 1,
          },
        };
      }
      if (operation === "target.preflight") {
        return {
          preflight: {
            targetId: "browser-1",
            ok: true,
            checkedAt: 4,
            capabilities: [],
            checks: [],
          },
        };
      }
      throw new Error(`Unexpected operation ${operation}`);
    });
    const preview = await createSuiteProfileProductService({} as never).previewSuite({
      appMapId: "app-1",
      suiteId: combine.id,
      profileId: "browser-1",
      accounts: [
        {
          profileId: "browser-1",
          engine: "chromium",
          account: {
            kind: "fixture",
            accountId: "a00050ff-c0c2-4a0f-ba9c-1418e16cf28d",
            accountRevision: "1",
            reference: "authfx:a00050ff-c0c2-4a0f-ba9c-1418e16cf28d:1",
          },
        },
        {
          profileId: "browser-1",
          engine: "chromium",
          account: {
            kind: "fixture",
            accountId: "1d9054ec-7169-4f14-88e3-838fd159057e",
            accountRevision: "1",
            reference: "authfx:1d9054ec-7169-4f14-88e3-838fd159057e:1",
          },
        },
        {
          profileId: "browser-1",
          engine: "chromium",
          account: {
            kind: "fixture",
            accountId: "d969bd0d-4b45-4525-9ef5-3d3638f8a43b",
            accountRevision: "1",
            reference: "authfx:d969bd0d-4b45-4525-9ef5-3d3638f8a43b:1",
          },
        },
      ],
    });
    expect(preview.caseCount).toBe(3);
    expect(preview.execution).toMatchObject({
      duration: "observed",
      estimatedDurationMs: 14_868,
    });
    expect(preview.execution?.detail).toMatch(/Observed serial about 15s/u);
    expect(preview.execution?.detail).toMatch(
      /3 browser account lanes selected; parallel wall-clock is unmeasured/u,
    );
    expect(preview.execution?.detail).not.toMatch(/Quoted parallel/u);
    expect(preview.execution?.detail.match(/parallel wall-clock is unmeasured/gu)?.length).toBe(1);
  });

  it("previews up to four independently selected environments with a runnable multi-target plan", async () => {
    const browserMap = { ...map, combines: { [combine.id]: combine } } as unknown as AppMap;
    const environments = [target("browser-a", "browser"), target("browser-b", "browser")];
    relay.invoke.mockReset().mockImplementation(async (operation: string) => {
      if (operation === "app-map.get") return { appMap: browserMap };
      if (operation === "target.list") return { targets: environments };
      if (operation === "build.list") return { builds: [] };
      if (operation === "target.browser-auth.list") return { fixtures: [] };
      if (operation === "app-map.combine.preflight") {
        return {
          preflight: {
            deviceRuns: 2,
            checks: 3,
            blockers: [],
            warnings: [],
            expectedScreenshots: 4,
          },
        };
      }
      if (operation === "target.preflight") {
        return {
          preflight: { targetId: "browser", ok: true, checkedAt: 4, capabilities: [], checks: [] },
        };
      }
      throw new Error(`Unexpected operation ${operation}`);
    });
    const preview = await createSuiteProfileProductService({} as never).previewSuite({
      appMapId: "app-1",
      suiteId: combine.id,
      profileIds: ["browser-a", "browser-b"],
    });
    expect(preview.environments?.map((item) => item.id)).toEqual(["browser-a", "browser-b"]);
    expect(preview.caseCount).toBe(4);
    expect(preview.checkCount).toBe(6);
    expect(preview.expectedScreenshots).toBe(8);
    expect(preview.execution).toMatchObject({
      profileCount: 2,
      selectedProfileIds: ["browser-a", "browser-b"],
      capacity: "multi-target",
      duration: "unavailable",
      detail:
        "Each selected Plan case can run against every selected environment (up to 64). Duration stays unreported until Relay returns observed timing.",
    });
  });

  it("starts every selected environment through the canonical profile expansion payload", async () => {
    relay.invoke.mockReset().mockImplementation(async (operation: string) => {
      if (operation === "app-map.get")
        return { appMap: { ...map, combines: { [combine.id]: combine } } };
      if (operation === "target.list") {
        return { targets: [target("browser-a", "browser"), target("browser-b", "browser")] };
      }
      if (operation === "build.list") return { builds: [] };
      if (operation === "target.browser-auth.list") return { fixtures: [] };
      if (operation === "job.combine.start")
        return { campaign: { id: "campaign-multi" }, batch: { id: "batch-multi" } };
      throw new Error(`Unexpected operation ${operation}`);
    });
    await expect(
      createSuiteProfileProductService({} as never).startSuite({
        appMapId: "app-1",
        suiteId: combine.id,
        profileIds: ["browser-a", "browser-b"],
      }),
    ).resolves.toEqual({ batchId: "campaign-multi" });
  });

  it("preserves platform and target isolation for multiple environments", async () => {
    relay.invoke.mockReset().mockImplementation(async (operation: string) => {
      if (operation === "target.list") {
        return { targets: [target("ios-a", "ios"), target("android-b", "android")] };
      }
      if (operation === "build.list") return { builds: [] };
      if (operation === "app-map.get")
        return { appMap: { ...map, combines: { [combine.id]: combine } } };
      if (operation === "job.combine.start") return { batch: { id: "batch-multi" } };
      throw new Error(`Unexpected operation ${operation}`);
    });
    await expect(
      createSuiteProfileProductService({} as never).startSuite({
        appMapId: "app-1",
        suiteId: combine.id,
        profileIds: ["ios-a", "android-b"],
      }),
    ).resolves.toEqual({ batchId: "batch-multi" });
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
          profileTargets: [
            {
              profileId: "browser-1",
              target: { targetKind: "browser", browserTargetId: "browser-1" },
            },
          ],
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
          executionMode: "all",
          targetKind: "device",
          serial: "ios-1",
          platform: "ios",
          profileTargets: [
            {
              profileId: "ios-1",
              target: { targetKind: "device", serial: "ios-1", platform: "ios" },
            },
          ],
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

  it("schedules a Plan daily against the selected browser", async () => {
    relay.invoke.mockReset().mockImplementation(async (operation: string, input: unknown) => {
      if (operation === "target.list") return { targets: [target("browser-1", "browser")] };
      if (operation === "build.list") return { builds: [] };
      if (operation === "target.browser-auth.list") return { fixtures: [] };
      if (operation === "schedule.create") {
        expect(input).toEqual({
          combineId: combine.id,
          appMapId: "app-1",
          targetKind: "browser",
          targetId: "browser-1",
          platform: "browser",
          intervalMinutes: 1_440,
          hour: 8,
          timezone: "UTC",
          profileTargets: [
            {
              profileId: "browser-1",
              target: { targetKind: "browser", browserTargetId: "browser-1" },
            },
          ],
        });
        return { schedule: { id: "sched-1", recipeId: "", combineId: combine.id } };
      }
      throw new Error(`Unexpected operation ${operation}`);
    });
    await expect(
      createSuiteProfileProductService({} as never).schedulePlan!({
        appMapId: "app-1",
        combineId: combine.id,
        profileId: "browser-1",
        hour: 8,
        timezone: "UTC",
      }),
    ).resolves.toEqual({ id: "sched-1" });
  });

  it("binds a paired account fixture and opens the Infra Result when start fails closed", async () => {
    relay.invoke.mockReset().mockImplementation(async (operation: string, input: unknown) => {
      if (operation === "target.list") return { targets: [target("browser-1", "browser")] };
      if (operation === "build.list") return { builds: [] };
      if (operation === "target.browser-auth.list") return { fixtures: [] };
      if (operation === "job.combine.start") {
        expect(input).toMatchObject({
          profileTargets: [
            {
              profileId: "browser-1",
              engine: "chromium",
              account: { kind: "fixture", accountId: "acct-member", accountRevision: "7" },
              target: { targetKind: "browser", browserTargetId: "browser-1" },
            },
          ],
        });
        throw Object.assign(new Error("Member expired"), {
          status: 409,
          body: { code: "ACCOUNT_NEEDS_RELOGIN", batchId: "preflight-batch" },
        });
      }
      throw new Error(`Unexpected operation ${operation}`);
    });
    await expect(
      createSuiteProfileProductService({} as never).startSuite({
        appMapId: "app-1",
        suiteId: combine.id,
        profileId: "browser-1",
        accounts: [
          {
            profileId: "browser-1",
            account: { kind: "fixture", accountId: "acct-member", accountRevision: "7" },
          },
        ],
      }),
    ).resolves.toEqual({ batchId: "preflight-batch" });
  });

  it("starts six accounts plus Android and iOS as eight Combine columns", async () => {
    relay.invoke.mockReset().mockImplementation(async (operation: string, input: unknown) => {
      if (operation === "target.list") {
        return {
          targets: [
            target("grok-com", "browser"),
            target("pixel-8", "android"),
            target("ipad-pro", "ios"),
          ],
        };
      }
      if (operation === "build.list") return { builds: [] };
      if (operation === "target.browser-auth.list") return { fixtures: [] };
      if (operation === "job.combine.start") {
        const body = input as { profileTargets: unknown[] };
        expect(body.profileTargets).toHaveLength(8);
        expect(body.profileTargets.slice(0, 6)).toEqual(
          ["a", "b", "c", "d", "e", "f"].map((letter) => ({
            profileId: "grok-com",
            engine: "chromium",
            account: { kind: "fixture", accountId: `acct-${letter}`, accountRevision: "1" },
            target: { targetKind: "browser", browserTargetId: "grok-com" },
          })),
        );
        expect(body.profileTargets[6]).toEqual({
          profileId: "pixel-8",
          target: { targetKind: "device", serial: "pixel-8", platform: "android" },
        });
        expect(body.profileTargets[7]).toEqual({
          profileId: "ipad-pro",
          target: { targetKind: "device", serial: "ipad-pro", platform: "ios" },
        });
        return { campaign: { id: "campaign-8" }, batch: { id: "batch-8" } };
      }
      throw new Error(`Unexpected operation ${operation}`);
    });
    await expect(
      createSuiteProfileProductService({} as never).startSuite({
        appMapId: "app-1",
        suiteId: combine.id,
        profileIds: ["grok-com", "pixel-8", "ipad-pro"],
        accounts: ["a", "b", "c", "d", "e", "f"].map((letter) => ({
          profileId: "grok-com",
          engine: "chromium" as const,
          account: { kind: "fixture" as const, accountId: `acct-${letter}`, accountRevision: "1" },
        })),
      }),
    ).resolves.toEqual({ batchId: "campaign-8" });
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
