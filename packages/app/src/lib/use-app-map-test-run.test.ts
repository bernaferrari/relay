import assert from "node:assert/strict";
import test from "node:test";
import { createRoot, createSignal } from "solid-js";
import type {
  AppMap,
  AppMapCompiledTest,
  AppMapScenarioTest,
  DurableWorkflowRead,
  OfflineTestPreflightReport,
  WorkflowJsonValue,
} from "@relay/protocol";
import type { DeviceInfo } from "./api-types.js";
import type { RelayInvokeClient } from "@relay/workflows";
import { createAppMapTestRun } from "./use-app-map-test-run.js";

const report = (testId: string): OfflineTestPreflightReport =>
  ({
    schemaVersion: 1,
    mode: "offline-test-preflight",
    appMapId: "map",
    appMapRevision: 1,
    testId,
    planDigest: "frozen",
    executionRisk: {
      schemaVersion: 1,
      level: "safe",
      reasons: [],
      externalEffects: [],
      confirmation: "none",
      expectedAppBoundaries: [],
      maximumActions: 0,
      maximumDurationMs: 0,
      cleanupRequired: false,
    },
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

function durableWorkflow(input: {
  workflowId: string;
  frozenIdentity: WorkflowJsonValue;
  version: number;
  status?: "active" | "needs-attention" | "terminal";
  transition?: string;
  jobId?: string;
}): DurableWorkflowRead {
  return {
    record: {
      schemaVersion: 1,
      workflowId: input.workflowId,
      organizationId: "org",
      projectId: "project",
      kind: "run-test",
      version: input.version,
      status: input.status ?? "active",
      frozenIdentity: input.frozenIdentity,
      ...(input.jobId ? { resource: { kind: "job", id: input.jobId } } : {}),
      createdBy: "human:test",
      lastActorId: "human:test",
      createdAt: 1,
      updatedAt: input.version,
      expiresAt: 100_000,
      lastTransition: input.transition ?? "created",
    },
    audit: [],
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
        client: {
          invoke: async () => {
            throw new Error(
              "workflow operations are not expected in this stale-preflight regression",
            );
          },
        },
        awaitPendingSaves: async () => undefined,
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

test("an uncertain queue outcome blocks an explicit second Run", async () => {
  let runCalls = 0;
  let workflowId = "";
  let frozenIdentity: WorkflowJsonValue;
  const client = {
    async invoke(id: string, input: unknown) {
      if (id === "app-map.test.compile") {
        return { plan: compiled("english"), preflight: report("english") };
      }
      if (id === "workflow.create") {
        const request = input as { workflowId: string; frozenIdentity: WorkflowJsonValue };
        workflowId = request.workflowId;
        frozenIdentity = request.frozenIdentity;
        return {
          disposition: "created",
          workflow: durableWorkflow({ workflowId, frozenIdentity, version: 1 }),
        };
      }
      if (id === "app-map.test.run") {
        runCalls += 1;
        throw new Error("response lost after queueing");
      }
      if (id === "workflow.get") {
        return {
          workflow: durableWorkflow({
            workflowId,
            frozenIdentity,
            version: 2,
            status: "needs-attention",
            transition: "run-outcome-unknown",
          }),
        };
      }
      throw new Error(`unexpected operation ${id}`);
    },
  } as RelayInvokeClient;
  const singleProfileMap = appMap();
  delete singleProfileMap.screenVariants.pt;

  await new Promise<void>((done, fail) =>
    createRoot((dispose) => {
      const run = createAppMapTestRun({
        appMap: () => singleProfileMap,
        draft: () => testDefinition("english"),
        selectedDevice: () => ({ serial: "ipad-1", platform: "ios" }) as DeviceInfo,
        saveState: () => "saved",
        blockerCount: () => 0,
        offline: () => false,
        jobs: () => [],
        refreshJobs: async () => undefined,
        client,
        awaitPendingSaves: async () => undefined,
        compile: async () => ({ plan: compiled("english"), preflight: report("english") }),
      });
      void (async () => {
        assert.equal(run.blockedReason(), undefined);
        await run.run();
        assert.equal(runCalls, 1);
        assert.match(run.blockedReason() ?? "", /Inspect the existing run/u);
        await run.run();
        assert.equal(runCalls, 1);
        dispose();
        done();
      })().catch((error) => {
        dispose();
        fail(error);
      });
    }),
  );
});

test("an uncertain queue outcome survives a remount and adopts the canonical job", async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  let runCalls = 0;
  let recoveryCalls = 0;
  let workflowId = "";
  let frozenIdentity: WorkflowJsonValue;
  const client = {
    async invoke(id: string, input: unknown) {
      if (id === "app-map.test.compile") {
        return { plan: compiled("english"), preflight: report("english") };
      }
      if (id === "workflow.create") {
        const request = input as { workflowId: string; frozenIdentity: WorkflowJsonValue };
        workflowId = request.workflowId;
        frozenIdentity = request.frozenIdentity;
        return {
          disposition: "created",
          workflow: durableWorkflow({ workflowId, frozenIdentity, version: 1 }),
        };
      }
      if (id === "app-map.test.run") {
        runCalls += 1;
        throw new Error("response lost after queueing");
      }
      if (id === "workflow.get") {
        recoveryCalls += 1;
        return {
          workflow: durableWorkflow({
            workflowId,
            frozenIdentity: { ...(frozenIdentity as object), rootRecipeId: "root" },
            version: 2,
            transition: "run-attached",
            jobId: "job-recovered",
          }),
          job: {
            id: "job-recovered",
            action: "root",
            status: "running",
            queuedAt: Date.now(),
            serial: "ipad-1",
            platform: "ios",
          },
        };
      }
      throw new Error(`unexpected operation ${id}`);
    },
  } as RelayInvokeClient;
  const singleProfileMap = appMap();
  delete singleProfileMap.screenVariants.pt;
  const makeRun = () =>
    createAppMapTestRun({
      appMap: () => singleProfileMap,
      draft: () => testDefinition("english"),
      selectedDevice: () => ({ serial: "ipad-1", platform: "ios" }) as DeviceInfo,
      saveState: () => "saved",
      blockerCount: () => 0,
      offline: () => false,
      jobs: () => [],
      refreshJobs: async () => undefined,
      client,
      storage,
      awaitPendingSaves: async () => undefined,
      compile: async () => ({ plan: compiled("english"), preflight: report("english") }),
    });

  await new Promise<void>((done, fail) =>
    createRoot((dispose) => {
      const run = makeRun();
      run.setTargetProfile("ipad-en");
      void run
        .run()
        .then(() => {
          assert.equal(runCalls, 1);
          assert.ok(values.size > 0);
          dispose();
          done();
        })
        .catch(fail);
    }),
  );

  await new Promise<void>((done, fail) =>
    createRoot((dispose) => {
      const run = makeRun();
      run.setTargetProfile("ipad-en");
      assert.match(run.blockedReason() ?? "", /Inspect the existing run/u);
      void run.run().then(() => {
        assert.equal(runCalls, 1);
        queueMicrotask(() => {
          try {
            assert.equal(recoveryCalls, 1);
            assert.equal(run.jobId(), "job-recovered");
            assert.ok(
              values.size > 0,
              "active canonical Run remains durable across another remount",
            );
            dispose();
            done();
          } catch (error) {
            dispose();
            fail(error);
          }
        });
      });
    }),
  );
});

test("a renderer exit after dispatch still recovers by the pre-dispatch request id", async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  let dispatchedRequestId = "";
  let dispatched!: () => void;
  const dispatchObserved = new Promise<void>((resolve) => (dispatched = resolve));
  const neverSettles = new Promise<never>(() => undefined);
  const client = {
    async invoke(id: string, input: unknown) {
      if (id === "app-map.test.compile") {
        return { plan: compiled("english"), preflight: report("english") };
      }
      if (id === "workflow.create") {
        const request = input as { workflowId: string; frozenIdentity: WorkflowJsonValue };
        return {
          disposition: "created",
          workflow: durableWorkflow({
            workflowId: request.workflowId,
            frozenIdentity: request.frozenIdentity,
            version: 1,
          }),
        };
      }
      if (id === "app-map.test.run") {
        dispatchedRequestId = (input as { workflowRequestId: string }).workflowRequestId;
        dispatched();
        return neverSettles;
      }
      if (id === "job.list") {
        return {
          jobs: [
            {
              id: "job-after-crash",
              action: "root",
              status: "running",
              queuedAt: Date.now(),
              frameCount: 0,
            },
          ],
        };
      }
      if (id === "job.get") {
        return {
          job: {
            id: "job-after-crash",
            action: "root",
            status: "running",
            queuedAt: Date.now(),
            serial: "ipad-1",
            platform: "ios",
            artifacts: [
              {
                kind: "app-map-test-workflow-request",
                data: { schemaVersion: 1, requestId: dispatchedRequestId },
              },
              {
                kind: "app-map-test-execution-intent",
                data: {
                  sourcePlan: {
                    appMapId: "map",
                    appMapRevision: 1,
                    testId: "english",
                    rootRecipeId: "root",
                    digest: "frozen",
                  },
                  selectedRuntimeTargetProfile: { id: "ipad-en" },
                },
              },
            ],
          },
        };
      }
      throw new Error(`unexpected operation ${id}`);
    },
  } as RelayInvokeClient;
  const singleProfileMap = appMap();
  delete singleProfileMap.screenVariants.pt;
  const makeRun = () =>
    createAppMapTestRun({
      appMap: () => singleProfileMap,
      draft: () => testDefinition("english"),
      selectedDevice: () => ({ serial: "ipad-1", platform: "ios" }) as DeviceInfo,
      saveState: () => "saved",
      blockerCount: () => 0,
      offline: () => false,
      jobs: () => [],
      refreshJobs: async () => undefined,
      client,
      storage,
      awaitPendingSaves: async () => undefined,
      compile: async () => ({ plan: compiled("english"), preflight: report("english") }),
    });

  let disposeFirst!: () => void;
  createRoot((dispose) => {
    disposeFirst = dispose;
    const run = makeRun();
    run.setTargetProfile("ipad-en");
    void run.run();
  });
  await dispatchObserved;
  assert.ok(dispatchedRequestId);
  assert.ok(values.size > 0, "the marker exists before the enqueue response can settle");
  disposeFirst();

  await new Promise<void>((done, fail) =>
    createRoot((dispose) => {
      const run = makeRun();
      run.setTargetProfile("ipad-en");
      void run
        .run()
        .then(() => {
          assert.equal(run.jobId(), "job-after-crash");
          assert.ok(values.size > 0);
          dispose();
          done();
        })
        .catch(fail);
    }),
  );
});
