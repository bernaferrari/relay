import { afterEach, expect, it, vi } from "vitest";
import type { AppMap, DeviceSummary, TargetProfile, TargetRuntimeReadiness } from "@relay/protocol";
import { createSuiteProfileProductService } from "./suite-profile-product-service";

const relay = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("./product-client", () => ({
  productClientForPlatform: vi.fn(async () => ({ client: relay })),
}));
afterEach(() => relay.invoke.mockReset());

const serial = "physical-ipad";
const profileId = "device:physical-ipad-1112x834-ca15";
const profile: TargetProfile = {
  id: profileId,
  targetId: serial,
  source: "device",
  platform: "ios",
  name: "iPad Pro",
  viewport: { width: 1112, height: 834 },
  capabilities: ["snapshot", "screenshot"],
  observedAt: 1,
};
const map = {
  id: "grok-ios",
  name: "Grok",
  revision: 7,
  screens: { home: { id: "home", title: "Home", variantIds: ["current", "legacy"] } },
  screenVariants: {
    current: { id: "current", targetProfile: profile },
    legacy: { id: "legacy", targetProfile: { ...profile, id: "device:physical-ipad-1112x834" } },
  },
  connections: { type: { id: "type", fromScreenId: "home", destination: { kind: "end" } } },
  tests: {
    fast: {
      id: "fast",
      name: "Ordinary Test",
      steps: [
        {
          id: "type-step",
          kind: "instruction",
          intent: "Type",
          binding: { status: "resolved", kind: "connections", connectionIds: ["type"] },
        },
      ],
    },
  },
  combines: {
    prompts: {
      id: "prompts",
      name: "Two prompts",
      testIds: ["fast"],
      variableIds: [],
      cellRuntimeProfiles: [
        { testId: "fast", values: { prompt: "value-1" }, targetProfileId: profileId },
        { testId: "fast", values: { prompt: "value-2" }, targetProfileId: profileId },
      ],
    },
  },
} as unknown as AppMap;
const device: DeviceSummary = {
  id: "sdk-ipad-id",
  serial,
  name: "iPad Pro",
  kind: "Physical device",
  platform: "ios",
  booted: true,
};
const scope = { appMapId: map.id, combineId: "prompts" };
const profileTargets = [
  {
    profileId,
    targetProfileId: profileId,
    target: { targetKind: "device", serial, platform: "ios" },
  },
];
function discovery(
  input: { appMap?: AppMap; devices?: DeviceSummary[]; blockers?: object[] } = {},
) {
  relay.invoke.mockImplementation(async (operation: string) => {
    if (operation === "app-map.get") return { appMap: input.appMap ?? map };
    if (operation === "target.list")
      return {
        targets: [
          {
            id: "browser-1",
            name: "Unrelated browser",
            kind: "browser",
            createdAt: 1,
            updatedAt: 1,
            browser: { startUrl: "https://example.test" },
          },
        ],
      };
    if (operation === "target.devices.list") return { devices: input.devices ?? [device] };
    if (operation === "build.list") return { builds: [] };
    if (operation === "target.browser-auth.list") return { fixtures: [] };
    if (operation === "app-map.combine.preflight")
      return {
        preflight: { deviceRuns: 2, checks: 10, blockers: input.blockers ?? [], warnings: [] },
      };
    if (operation === "job.combine.start") return { batch: { id: "native-batch" } };
    if (operation === "schedule.create") return { schedule: { id: "native-schedule" } };
    if (operation === "target.preflight")
      return {
        preflight: { targetId: "browser-1", ok: true, checkedAt: 1, capabilities: [], checks: [] },
      };
    throw new Error(`Unexpected operation ${operation}`);
  });
}

it("offers the actual bound saved iPad setup even when the managed registry contains only browsers", async () => {
  discovery();
  const profiles = await createSuiteProfileProductService({} as never).listEnvironmentProfiles(
    scope,
  );
  expect(profiles.map((item) => item.id)).toEqual([profileId]);
  expect(profiles[0]).toMatchObject({
    name: "iPad Pro",
    platform: "ios",
    targetId: serial,
    targetProfileId: profileId,
  });
  expect(relay.invoke).toHaveBeenCalledWith("target.devices.list", { targetKind: "device" });
  expect(relay.invoke).not.toHaveBeenCalledWith("target.preflight", expect.anything());
  expect(relay.invoke).not.toHaveBeenCalledWith("target.browser-auth.list", expect.anything());
});

it("distinguishes same-phone saved setups and puts the latest captured profile before its shorter legacy id", async () => {
  const androidMap = structuredClone(map);
  const phoneSerial = "RQCY104BG8X";
  const currentId = `device:${phoneSerial}-1080x2340`;
  const legacyId = `device:${phoneSerial}`;
  const capturedProfile = {
    ...profile,
    id: currentId,
    targetId: phoneSerial,
    platform: "android" as const,
    name: "SM S931B",
    viewport: { width: 1080, height: 2340 },
    observedAt: 1791330959973,
  };
  androidMap.screenVariants = {
    current: { ...androidMap.screenVariants.current!, targetProfile: capturedProfile },
    legacy: {
      ...androidMap.screenVariants.legacy!,
      targetProfile: {
        ...capturedProfile,
        id: legacyId,
        name: phoneSerial,
        observedAt: 1791326533434,
      },
      updatedAt: 1791331959973,
    },
    olderCurrent: {
      ...androidMap.screenVariants.current!,
      id: "older-current",
      targetProfile: { ...capturedProfile, observedAt: 1789322768546 },
    },
  };
  delete androidMap.combines.prompts!.cellRuntimeProfiles;
  discovery({
    appMap: androidMap,
    devices: [{ ...device, serial: phoneSerial, name: "SM S931B", platform: "android" }],
  });
  const profiles = await createSuiteProfileProductService({} as never).listEnvironmentProfiles(
    scope,
  );
  expect(profiles.map((item) => item.id)).toEqual([currentId, legacyId]);
  expect(profiles.map((item) => item.targetProfileId)).toEqual([currentId, legacyId]);
  expect(new Set(profiles.map((item) => item.name)).size).toBe(2);
  for (const item of profiles) {
    expect(item.name).toContain("1080 × 2340");
    expect(item.name).toContain("Captured");
    expect(item.name).not.toContain(phoneSerial);
    expect(item.nativeReadiness?.state).toBe("unproven");
  }
  expect(profiles[0]!.name).toContain(new Date(capturedProfile.observedAt).toLocaleString());
  expect(relay.invoke).not.toHaveBeenCalledWith("target.preflight", expect.anything());
  expect(relay.invoke).not.toHaveBeenCalledWith("job.combine.start", expect.anything());

  androidMap.combines.prompts!.cellRuntimeProfiles = [
    { testId: "fast", values: { prompt: "value-1" }, targetProfileId: legacyId },
  ];
  const boundProfiles = await createSuiteProfileProductService({} as never).listEnvironmentProfiles(
    scope,
  );
  expect(boundProfiles.map((item) => item.id)).toEqual([legacyId]);
  expect(boundProfiles[0]!.name).toBe("SM S931B");
});

it("keeps coincident captured setups distinct with a brief descriptor rather than a raw id", async () => {
  const coincidentMap = structuredClone(map);
  delete coincidentMap.combines.prompts!.cellRuntimeProfiles;
  discovery({ appMap: coincidentMap });
  const profiles = await createSuiteProfileProductService({} as never).listEnvironmentProfiles(
    scope,
  );
  expect(profiles).toHaveLength(2);
  expect(new Set(profiles.map((item) => item.name)).size).toBe(2);
  expect(profiles.map((item) => item.name)).toEqual([
    expect.stringContaining("Saved setup 1"),
    expect.stringContaining("Saved setup 2"),
  ]);
  expect(profiles.map((item) => item.id).sort()).toEqual([
    "device:physical-ipad-1112x834",
    profileId,
  ]);
  for (const item of profiles) expect(item.name).not.toContain(serial);
});

it("resolves the saved setup after selection and treats unproven readiness as a warning", async () => {
  discovery();
  const service = createSuiteProfileProductService({} as never);
  expect(await service.getEnvironmentProfile(profileId, scope)).toMatchObject({
    targetProfileId: profileId,
    nativeReadiness: { state: "unproven" },
  });
  const result = await service.preflightEnvironment({ profileId, scope });
  expect(result.target).toMatchObject({
    targetId: serial,
    ok: true,
    checks: [{ status: "warning" }],
  });
  expect(relay.invoke.mock.calls.map(([operation]) => operation)).toEqual([
    "app-map.get",
    "build.list",
    "target.devices.list",
    "app-map.get",
    "build.list",
    "target.devices.list",
  ]);
});

it("previews both bound prompt rows on the exact saved setup without managed-browser preflight", async () => {
  discovery();
  const preview = await createSuiteProfileProductService({} as never).previewSuite({
    appMapId: map.id,
    suiteId: "prompts",
    profileId,
  });
  expect(preview).toMatchObject({
    caseCount: 2,
    checkCount: 10,
    blockers: [],
    environment: { targetId: serial, targetProfileId: profileId },
    warnings: [{ code: "target-native-readiness" }],
  });
  expect(
    relay.invoke.mock.calls.filter(([operation]) => operation === "app-map.combine.preflight"),
  ).toEqual([
    [
      "app-map.combine.preflight",
      { appMapId: map.id, combineId: "prompts", serial, profileTargets },
    ],
  ]);
  expect(relay.invoke).not.toHaveBeenCalledWith("target.preflight", expect.anything());
  expect(relay.invoke).not.toHaveBeenCalledWith("job.combine.start", expect.anything());
});

it("retains canonical native incompatibility blockers rather than replacing them with passive readiness", async () => {
  discovery({
    blockers: [
      {
        code: "target-profile-ambiguous",
        message: "Review the recorded setup.",
        cellId: "prompt-row-2",
      },
    ],
  });
  const preview = await createSuiteProfileProductService({} as never).previewSuite({
    appMapId: map.id,
    suiteId: "prompts",
    profileId,
  });
  expect(preview.blockers).toEqual([
    {
      code: "target-profile-ambiguous",
      message: "Review the recorded setup.",
      suiteCellId: "prompt-row-2",
    },
  ]);
  expect(relay.invoke).not.toHaveBeenCalledWith("job.combine.start", expect.anything());
});

it("retains the selected saved profile in exactly one native Run and the thirty-minute schedule payload", async () => {
  discovery();
  const service = createSuiteProfileProductService({} as never);
  await expect(
    service.startSuite({ appMapId: map.id, suiteId: "prompts", profileId }),
  ).resolves.toEqual({ batchId: "native-batch" });
  expect(
    relay.invoke.mock.calls.filter(([operation]) => operation === "job.combine.start"),
  ).toEqual([
    [
      "job.combine.start",
      {
        appMapId: map.id,
        combineId: "prompts",
        executionMode: "pilot",
        profileTargets,
        targetKind: "device",
        serial,
        platform: "ios",
      },
    ],
  ]);
  await expect(
    service.schedulePlan!({
      appMapId: map.id,
      combineId: "prompts",
      profileId,
      intervalMinutes: 30,
      timezone: "UTC",
    }),
  ).resolves.toEqual({ id: "native-schedule" });
  expect(relay.invoke.mock.calls.filter(([operation]) => operation === "schedule.create")).toEqual([
    [
      "schedule.create",
      {
        appMapId: map.id,
        combineId: "prompts",
        profileTargets,
        targetKind: "device",
        targetId: serial,
        platform: "ios",
        intervalMinutes: 30,
        timezone: "UTC",
      },
    ],
  ]);
});

it.each([
  { name: "disconnected", devices: [] },
  { name: "offline", devices: [{ ...device, connectionState: "offline" }] },
  {
    name: "same serial on a different platform",
    devices: [{ ...device, platform: "android" as const }],
  },
  { name: "same name on another device", devices: [{ ...device, serial: "another-ipad" }] },
])("keeps a $name saved target visible without claiming ready", async ({ devices }) => {
  discovery({ devices });
  const service = createSuiteProfileProductService({} as never);
  const profiles = await service.listEnvironmentProfiles(scope);
  expect(profiles).toHaveLength(1);
  expect(profiles[0]).toMatchObject({
    id: profileId,
    targetId: serial,
    nativeReadiness: { state: "blocked" },
  });
  const preflight = await service.preflightEnvironment({ profileId, scope });
  expect(preflight.target).toMatchObject({ ok: false, checks: [{ status: "fail" }] });
  expect(relay.invoke).not.toHaveBeenCalledWith("target.preflight", expect.anything());
});

it("reports current readiness only from all three exact current observations", async () => {
  const readiness: TargetRuntimeReadiness = {
    previewPixels: { mode: "pixels", state: "proven", freshness: "current", proof: { at: 1 } },
    semanticControl: {
      mode: "accessibility",
      state: "proven",
      freshness: "current",
      proof: { at: 1 },
    },
    evidenceCapture: { mode: "evidence", state: "proven", freshness: "current", proof: { at: 1 } },
  };
  discovery({ devices: [{ ...device, readiness }] });
  const result = await createSuiteProfileProductService({} as never).preflightEnvironment({
    profileId,
    scope,
  });
  expect(result.profile.nativeReadiness?.state).toBe("proven");
  expect(result.target).toMatchObject({ ok: true, capabilities: [], checks: [{ status: "pass" }] });
  expect(relay.invoke.mock.calls.map(([operation]) => operation)).toEqual([
    "app-map.get",
    "build.list",
    "target.devices.list",
  ]);
});

it("keeps unscoped browser consumers and their managed preflight unchanged", async () => {
  discovery();
  const service = createSuiteProfileProductService({} as never);
  const profiles = await service.listEnvironmentProfiles();
  expect(profiles.map((item) => item.id)).toEqual(["browser-1"]);
  expect(relay.invoke).not.toHaveBeenCalledWith("app-map.get", expect.anything());
  expect(relay.invoke).not.toHaveBeenCalledWith("target.devices.list", expect.anything());
  await service.preflightEnvironment({ profileId: "browser-1" });
  expect(relay.invoke).toHaveBeenCalledWith("target.preflight", { targetId: "browser-1" });
});

it("does not offer a linked native companion as this App's recorded route", async () => {
  const browserMap = structuredClone(map);
  browserMap.tests.fast!.family = {
    logicalIntentRevision: 1,
    bindingRevision: 1,
    routeVariants: [
      {
        id: "web",
        revision: 1,
        predicate: { platforms: ["browser"] },
        bindings: {
          "type-step": { status: "resolved", kind: "connections", connectionIds: ["type"] },
        },
        reviewedAt: 1,
        reviewedBy: "human:reviewer",
      },
    ],
  };
  browserMap.tests.fast!.nativeRouteCompanions = [
    { platform: "ios", appMapId: "another-app", testId: "ios-fast" },
  ];
  discovery({ appMap: browserMap });
  expect(
    (await createSuiteProfileProductService({} as never).listEnvironmentProfiles(scope)).map(
      (item) => item.id,
    ),
  ).toEqual(["browser-1"]);
  expect(relay.invoke).not.toHaveBeenCalledWith("target.devices.list", expect.anything());
});

it("requires a common recorded platform for every selected Test, independent of names", async () => {
  const mixedMap = structuredClone(map);
  mixedMap.tests.web = {
    ...mixedMap.tests.fast!,
    id: "web",
    name: "iPad Fast",
    originApplication: "https://example.test",
    steps: [],
  };
  mixedMap.combines.prompts!.testIds.push("web");
  discovery({ appMap: mixedMap });
  expect(
    await createSuiteProfileProductService({} as never).listEnvironmentProfiles(scope),
  ).toEqual([]);
  expect(relay.invoke).not.toHaveBeenCalledWith("target.devices.list", expect.anything());
  expect(relay.invoke).not.toHaveBeenCalledWith("target.list", expect.anything());
});

it("rejects an ambiguous saved serial projection instead of taking the last variant", async () => {
  const conflictingMap = structuredClone(map);
  conflictingMap.screenVariants.legacy!.targetProfile = { ...profile, targetId: "another-ipad" };
  discovery({ appMap: conflictingMap });
  await expect(
    createSuiteProfileProductService({} as never).listEnvironmentProfiles(scope),
  ).rejects.toThrow("saved device setup is ambiguous");
  expect(relay.invoke.mock.calls.map(([operation]) => operation)).toEqual(["app-map.get"]);
});
