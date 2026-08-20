import assert from "node:assert/strict";
import test from "node:test";
import { createRoot, createSignal } from "solid-js";
import type {
  AppMap,
  AppMapCompiledTest,
  AppMapScenarioTest,
  OfflineTestPreflightReport,
} from "@relay/protocol";
import type { DeviceInfo } from "./api-types.js";
import { createAppMapTestRun } from "./use-app-map-test-run.js";

const report = (testId: string): OfflineTestPreflightReport =>
  ({
    schemaVersion: 1,
    mode: "offline-test-preflight",
    appMapId: "map",
    appMapRevision: 1,
    testId,
    planDigest: "frozen",
    summary: {
      recipes: 1,
      checkedSelectors: 0,
      resolvedSelectors: 0,
      unknownCursorTransitions: 0,
      reviewRequiredReturns: 0,
      blockers: 0,
      warnings: 0,
    },
    selectors: [],
    cursorTimeline: [],
    returns: [],
    findings: [],
  }) as OfflineTestPreflightReport;

function appMap(revision = 1): AppMap {
  return {
    id: "map",
    revision,
    screenVariants: {
      en: {
        id: "en",
        targetProfile: {
          id: "ipad-en",
          targetId: "ipad-1",
          platform: "ios",
          name: "iPad English",
        },
      },
      pt: {
        id: "pt",
        targetProfile: {
          id: "ipad-pt",
          targetId: "ipad-1",
          platform: "ios",
          name: "iPad Portuguese",
        },
      },
    },
  } as unknown as AppMap;
}

function testDefinition(id: string, updatedAt = 1): AppMapScenarioTest {
  return { id, updatedAt, steps: [] } as unknown as AppMapScenarioTest;
}

function compiled(testId: string): AppMapCompiledTest {
  return {
    schemaVersion: 1,
    appMapId: "map",
    appMapRevision: 1,
    test: { id: testId, name: testId, kind: "scenario", intentSchemaVersion: 1 },
    rootRecipeId: "root",
    recipes: {},
    stepProvenance: [],
    performance: {
      executableOperations: 0,
      moduleCalls: 0,
      operationCounts: {},
      screenshotCount: 0,
      destinationProofCount: 0,
    },
    startup: { mode: "cold" },
  };
}

test("discards a deferred offline report when Test, device, or profile scope changes", async () => {
  let releaseCompile!: () => void;
  const compileGate = new Promise<void>((resolve) => (releaseCompile = resolve));
  let compileStarted!: () => void;
  const started = new Promise<void>((resolve) => (compileStarted = resolve));

  await new Promise<void>((done, fail) =>
    createRoot((dispose) => {
      const [map, setMap] = createSignal(appMap());
      const [draft, setDraft] = createSignal(testDefinition("english"));
      const [device, setDevice] = createSignal<DeviceInfo | undefined>({
        serial: "ipad-1",
        platform: "ios",
      } as DeviceInfo);
      const run = createAppMapTestRun({
        appMap: map,
        draft,
        selectedDevice: device,
        saveState: () => "saved",
        blockerCount: () => 0,
        offline: () => false,
        jobs: () => [],
        refreshJobs: async () => undefined,
        cancelJob: async () => undefined,
        awaitPendingSaves: async () => undefined,
        compileAndRun: async () => {
          throw new Error("run is not expected in this stale-preflight regression");
        },
        compile: async () => {
          compileStarted();
          await compileGate;
          return { plan: compiled("english"), preflight: report("english") };
        },
      });
      run.setTargetProfile("ipad-en");
      const pending = run.checkOffline();
      void (async () => {
        await started;
        run.setTargetProfile("ipad-pt");
        setDevice({ serial: "android-1", platform: "android" } as DeviceInfo);
        setMap(appMap(2));
        setDraft(testDefinition("portuguese", 2));
        releaseCompile();
        await pending;
        assert.equal(run.plan(), undefined);
        assert.equal(run.preflight(), undefined);
        assert.equal(run.error(), "");
        assert.equal(run.preflightBusy(), false);
        dispose();
        done();
      })().catch((error) => {
        dispose();
        fail(error);
      });
    }),
  );
});
