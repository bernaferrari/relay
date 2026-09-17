import assert from "node:assert/strict";
import test from "node:test";
import {
  EXECUTION_QUEUE_DURATION_ASSUMPTION,
  ROUTE_VARIANT_CONFIGURATION_ASSUMPTION,
  SURVIVAL_FAMILY_ID,
  SURVIVAL_REQUIRED_DWELL_MS,
  THREE_MINUTE_MS,
  canCoverWorkbookFamily,
} from "@relay/protocol";
import { planCampaignCapacity } from "./campaign-capacity-plan.js";

test("excludes unavailable, stale, leased, active, and queued targets before assigning capacity", () => {
  const plan = planCampaignCapacity({
    workItems: 12,
    estimatedWorkItemDurationMs: 1_000,
    targets: [
      {
        targetId: "android-ready",
        platform: "android",
        availability: "available",
        lease: "available",
        workerId: "android-host",
      },
      {
        targetId: "android-stale",
        platform: "android",
        availability: "stale",
        lease: "available",
        workerId: "android-host",
      },
      {
        targetId: "ios-offline",
        platform: "ios",
        availability: "unavailable",
        lease: "available",
        workerId: "ios-host",
      },
      {
        targetId: "ios-leased",
        platform: "ios",
        availability: "available",
        lease: "leased",
        workerId: "ios-host",
      },
      {
        targetId: "ios-running",
        platform: "ios",
        availability: "available",
        lease: "available",
        workerId: "ios-host",
      },
      {
        targetId: "ios-queued",
        platform: "ios",
        availability: "available",
        lease: "available",
        workerId: "ios-host",
      },
    ],
    workers: [
      {
        workerId: "android-host",
        capacity: 2,
        active: 0,
        queued: 0,
        activeTargets: [],
        queuedTargets: [],
      },
      {
        workerId: "ios-host",
        capacity: 2,
        active: 1,
        queued: 1,
        activeTargets: ["ios-running"],
        queuedTargets: ["ios-queued"],
      },
    ],
  });

  assert.deepEqual(plan.slots, [
    { targetId: "android-ready", platform: "android", workerId: "android-host" },
  ]);
  assert.deepEqual(plan.excludedTargets, [
    { targetId: "android-stale", platform: "android", reasons: ["stale"] },
    { targetId: "ios-leased", platform: "ios", reasons: ["leased"] },
    { targetId: "ios-offline", platform: "ios", reasons: ["unavailable"] },
    { targetId: "ios-queued", platform: "ios", reasons: ["worker-queued"] },
    { targetId: "ios-running", platform: "ios", reasons: ["worker-active"] },
  ]);
  assert.deepEqual(plan.platforms, [
    { platform: "android", scheduledSlots: 1, excludedTargets: 1 },
    { platform: "ios", scheduledSlots: 0, excludedTargets: 4 },
  ]);
});

test("reserves queued worker capacity before assigning independent targets", () => {
  const plan = planCampaignCapacity({
    workItems: 18,
    estimatedWorkItemDurationMs: 1_000,
    targets: [
      {
        targetId: "android-a",
        platform: "android",
        availability: "available",
        lease: "available",
        workerId: "shared-android-host",
      },
      {
        targetId: "android-b",
        platform: "android",
        availability: "available",
        lease: "available",
        workerId: "shared-android-host",
      },
      {
        targetId: "android-c",
        platform: "android",
        availability: "available",
        lease: "available",
        workerId: "shared-android-host",
      },
      {
        targetId: "ipad",
        platform: "ios",
        availability: "available",
        lease: "available",
        workerId: "ios-host",
      },
    ],
    workers: [
      {
        workerId: "shared-android-host",
        capacity: 2,
        active: 1,
        queued: 4,
        activeTargets: ["other-job"],
        queuedTargets: ["queued-a", "queued-b", "queued-c", "queued-d"],
      },
      {
        workerId: "ios-host",
        capacity: 1,
        active: 0,
        queued: 0,
        activeTargets: [],
        queuedTargets: [],
      },
    ],
  });

  assert.deepEqual(plan.slots, [{ targetId: "ipad", platform: "ios", workerId: "ios-host" }]);
  assert.deepEqual(plan.workers, [
    {
      workerId: "ios-host",
      capacity: 1,
      active: 0,
      queued: 0,
      freeCapacity: 1,
      slotCount: 1,
    },
    {
      workerId: "shared-android-host",
      capacity: 2,
      active: 1,
      queued: 4,
      freeCapacity: 0,
      slotCount: 0,
    },
  ]);
  assert.deepEqual(plan.excludedTargets, [
    { targetId: "android-a", platform: "android", reasons: ["worker-saturated"] },
    { targetId: "android-b", platform: "android", reasons: ["worker-saturated"] },
    { targetId: "android-c", platform: "android", reasons: ["worker-saturated"] },
  ]);
  assert.deepEqual(plan.serial, { slots: 1, estimatedDurationMs: 18_000 });
  assert.deepEqual(plan.parallel, {
    slots: 1,
    estimatedDurationMs: 18_000,
    idealSpeedup: 1,
  });
});

test("reserves queued work behind a shared host before assigning another target", () => {
  const plan = planCampaignCapacity({
    workItems: 1,
    estimatedWorkItemDurationMs: 1_000,
    targets: [
      {
        targetId: "ipad-b",
        platform: "ios",
        availability: "available",
        lease: "available",
        workerId: "local:ios:target:ipad-b",
      },
    ],
    workers: [
      {
        workerId: "local:ios:target:ipad-b",
        capacity: 1,
        active: 0,
        queued: 0,
        activeTargets: [],
        queuedTargets: [],
        host: { workerId: "mac-xcode", capacity: 1, active: 0, queued: 1 },
      },
    ],
  });

  assert.deepEqual(plan.slots, []);
  assert.deepEqual(plan.excludedTargets, [
    { targetId: "ipad-b", platform: "ios", reasons: ["host-saturated"] },
  ]);
  assert.deepEqual(plan.hosts, [
    {
      workerId: "mac-xcode",
      capacity: 1,
      active: 0,
      queued: 1,
      freeCapacity: 0,
      slotCount: 0,
    },
  ]);
});

test("does not overstate independent target lanes behind one shared host ceiling", () => {
  const plan = planCampaignCapacity({
    workItems: 2,
    estimatedWorkItemDurationMs: 1_000,
    targets: [
      {
        targetId: "ipad-a",
        platform: "ios",
        availability: "available",
        lease: "available",
        workerId: "local:ios:target:ipad-a",
      },
      {
        targetId: "ipad-b",
        platform: "ios",
        availability: "available",
        lease: "available",
        workerId: "local:ios:target:ipad-b",
      },
    ],
    workers: [
      {
        workerId: "local:ios:target:ipad-a",
        capacity: 1,
        active: 0,
        queued: 0,
        activeTargets: [],
        queuedTargets: [],
        host: { workerId: "mac-xcode", capacity: 1, active: 0, queued: 0 },
      },
      {
        workerId: "local:ios:target:ipad-b",
        capacity: 1,
        active: 0,
        queued: 0,
        activeTargets: [],
        queuedTargets: [],
        host: { workerId: "mac-xcode", capacity: 1, active: 0, queued: 0 },
      },
    ],
  });

  assert.deepEqual(plan.slots, [
    { targetId: "ipad-a", platform: "ios", workerId: "local:ios:target:ipad-a" },
  ]);
  assert.deepEqual(plan.excludedTargets, [
    { targetId: "ipad-b", platform: "ios", reasons: ["host-saturated"] },
  ]);
  assert.deepEqual(plan.hosts, [
    {
      workerId: "mac-xcode",
      capacity: 1,
      active: 0,
      queued: 0,
      freeCapacity: 1,
      slotCount: 1,
    },
  ]);
});

test("makes a campaign time budget and missing independent target slots explicit", () => {
  const plan = planCampaignCapacity({
    workItems: 800,
    estimatedWorkItemDurationMs: 1_000,
    timeBudgetMs: 180_000,
    targets: [
      {
        targetId: "a",
        platform: "android",
        availability: "available",
        lease: "available",
        workerId: "android-host",
      },
      {
        targetId: "b",
        platform: "ios",
        availability: "available",
        lease: "available",
        workerId: "ios-host",
      },
    ],
    workers: [
      {
        workerId: "android-host",
        capacity: 1,
        active: 0,
        queued: 0,
        activeTargets: [],
        queuedTargets: [],
      },
      {
        workerId: "ios-host",
        capacity: 1,
        active: 0,
        queued: 0,
        activeTargets: [],
        queuedTargets: [],
      },
    ],
  });

  assert.deepEqual(plan.serial, { slots: 1, estimatedDurationMs: 800_000 });
  assert.deepEqual(plan.parallel, {
    slots: 2,
    estimatedDurationMs: 400_000,
    idealSpeedup: 2,
  });
  assert.deepEqual(plan.budget, {
    timeBudgetMs: 180_000,
    achievableWithCurrentCapacity: false,
    requiredIndependentTargetSlots: 5,
    additionalIndependentTargetSlots: 3,
    minimumPossibleDurationMs: 1_000,
  });
});

test("does not borrow Android capacity to promise an iOS deadline", () => {
  const plan = planCampaignCapacity({
    workItems: 4,
    workItemsByPlatform: { android: 2, ios: 2 },
    estimatedWorkItemDurationMs: 100,
    timeBudgetMs: 100,
    targets: [
      {
        targetId: "android-a",
        platform: "android",
        availability: "available",
        lease: "available",
        workerId: "android-host",
      },
      {
        targetId: "android-b",
        platform: "android",
        availability: "available",
        lease: "available",
        workerId: "android-host",
      },
      {
        targetId: "ios-a",
        platform: "ios",
        availability: "available",
        lease: "available",
        workerId: "ios-host",
      },
    ],
    workers: [
      {
        workerId: "android-host",
        capacity: 2,
        active: 0,
        queued: 0,
        activeTargets: [],
        queuedTargets: [],
      },
      {
        workerId: "ios-host",
        capacity: 1,
        active: 0,
        queued: 0,
        activeTargets: [],
        queuedTargets: [],
      },
    ],
  });

  assert.deepEqual(plan.parallel, {
    slots: 3,
    estimatedDurationMs: 200,
    idealSpeedup: 2,
  });
  assert.deepEqual(plan.budget, {
    timeBudgetMs: 100,
    achievableWithCurrentCapacity: false,
    requiredIndependentTargetSlots: 4,
    additionalIndependentTargetSlots: 1,
    minimumPossibleDurationMs: 100,
  });
  assert.deepEqual(plan.platforms, [
    {
      platform: "android",
      scheduledSlots: 2,
      excludedTargets: 0,
      workItems: 2,
      serial: { slots: 1, estimatedDurationMs: 200 },
      parallel: { slots: 2, estimatedDurationMs: 100 },
      budget: {
        timeBudgetMs: 100,
        achievableWithCurrentCapacity: true,
        requiredIndependentTargetSlots: 2,
        additionalIndependentTargetSlots: 0,
        minimumPossibleDurationMs: 100,
      },
    },
    {
      platform: "ios",
      scheduledSlots: 1,
      excludedTargets: 0,
      workItems: 2,
      serial: { slots: 1, estimatedDurationMs: 200 },
      parallel: { slots: 1, estimatedDurationMs: 200 },
      budget: {
        timeBudgetMs: 100,
        achievableWithCurrentCapacity: false,
        requiredIndependentTargetSlots: 2,
        additionalIndependentTargetSlots: 1,
        minimumPossibleDurationMs: 100,
      },
    },
  ]);
});

test("rejects a mixed-platform allocation that does not describe every work item", () => {
  assert.throws(
    () =>
      planCampaignCapacity({
        workItems: 2,
        workItemsByPlatform: { android: 1 },
        estimatedWorkItemDurationMs: 100,
        targets: [],
        workers: [],
      }),
    /add up to workItems/,
  );
});

test("rejects an unknown platform instead of silently ignoring its work", () => {
  assert.throws(
    () =>
      planCampaignCapacity({
        workItems: 1,
        workItemsByPlatform: { android: 1, desktop: 0 } as never,
        estimatedWorkItemDurationMs: 100,
        targets: [],
        workers: [],
      }),
    /platform desktop is not supported/,
  );
});

test("does not promise a target count when one indivisible work item exceeds the budget", () => {
  const plan = planCampaignCapacity({
    workItems: 2,
    estimatedWorkItemDurationMs: 181_000,
    timeBudgetMs: 180_000,
    targets: [
      {
        targetId: "a",
        platform: "android",
        availability: "available",
        lease: "available",
        workerId: "android-host",
      },
      {
        targetId: "b",
        platform: "ios",
        availability: "available",
        lease: "available",
        workerId: "ios-host",
      },
    ],
    workers: [
      {
        workerId: "android-host",
        capacity: 1,
        active: 0,
        queued: 0,
        activeTargets: [],
        queuedTargets: [],
      },
      {
        workerId: "ios-host",
        capacity: 1,
        active: 0,
        queued: 0,
        activeTargets: [],
        queuedTargets: [],
      },
    ],
  });

  assert.deepEqual(plan.budget, {
    timeBudgetMs: 180_000,
    achievableWithCurrentCapacity: false,
    requiredIndependentTargetSlots: null,
    additionalIndependentTargetSlots: null,
    minimumPossibleDurationMs: 181_000,
  });
});

test("fails closed on duplicate target identities", () => {
  const plan = planCampaignCapacity({
    workItems: 1,
    estimatedWorkItemDurationMs: 1_000,
    targets: [
      {
        targetId: "shared",
        platform: "android",
        availability: "available",
        lease: "available",
        workerId: "android-host",
      },
      {
        targetId: "shared",
        platform: "ios",
        availability: "available",
        lease: "available",
        workerId: "ios-host",
      },
    ],
    workers: [
      {
        workerId: "android-host",
        capacity: 1,
        active: 0,
        queued: 0,
        activeTargets: [],
        queuedTargets: [],
      },
      {
        workerId: "ios-host",
        capacity: 1,
        active: 0,
        queued: 0,
        activeTargets: [],
        queuedTargets: [],
      },
    ],
  });

  assert.deepEqual(plan.slots, []);
  assert.deepEqual(plan.excludedTargets, [
    { targetId: "shared", platform: "android", reasons: ["duplicate-target"] },
    { targetId: "shared", platform: "ios", reasons: ["duplicate-target"] },
  ]);
});

test("fails closed instead of inventing capacity for an unobserved worker", () => {
  const plan = planCampaignCapacity({
    workItems: 1,
    estimatedWorkItemDurationMs: 1_000,
    targets: [
      {
        targetId: "unknown-host",
        platform: "ios",
        availability: "available",
        lease: "available",
        workerId: "unknown-host-worker",
      },
    ],
    workers: [],
  });

  assert.deepEqual(plan.slots, []);
  assert.deepEqual(plan.excludedTargets, [
    { targetId: "unknown-host", platform: "ios", reasons: ["worker-unknown"] },
  ]);
});

test("capacity JSON quotes Fast UI, Live output, and Stateful/survival separately", () => {
  const plan = planCampaignCapacity({
    workItems: 3,
    estimatedWorkItemDurationMs: 5_000,
    queueMembers: [
      { executionQueue: "fast-ui", workMs: 5_000 },
      { executionQueue: "live-output", workMs: 45_000 },
      {
        executionQueue: "stateful-survival",
        workMs: 8_000,
        requiredDwellMs: SURVIVAL_REQUIRED_DWELL_MS,
      },
    ],
    targets: [
      {
        targetId: "pixel-1",
        platform: "android",
        availability: "available",
        lease: "available",
        workerId: "android-host",
      },
    ],
    workers: [
      {
        workerId: "android-host",
        capacity: 1,
        active: 0,
        queued: 0,
        activeTargets: [],
        queuedTargets: [],
      },
    ],
  });

  assert.deepEqual(
    plan.queueQuotes?.map((quote) => [quote.queue, quote.label]),
    [
      ["fast-ui", "Fast UI"],
      ["live-output", "Live output"],
      ["stateful-survival", "Stateful/survival"],
    ],
  );
  const fast = plan.queueQuotes?.find((quote) => quote.queue === "fast-ui");
  const live = plan.queueQuotes?.find((quote) => quote.queue === "live-output");
  const survival = plan.queueQuotes?.find((quote) => quote.queue === "stateful-survival");
  assert.equal(fast?.lowerBoundMs, 5_000);
  assert.equal(live?.lowerBoundMs, 45_000);
  assert.equal(survival?.requiredDwellMs, SURVIVAL_REQUIRED_DWELL_MS);
  assert.equal(survival?.lowerBoundMs, SURVIVAL_REQUIRED_DWELL_MS);
  assert.notEqual(fast?.lowerBoundMs, THREE_MINUTE_MS);
  assert.notEqual(live?.lowerBoundMs, THREE_MINUTE_MS);
  assert.notEqual(survival?.lowerBoundMs, THREE_MINUTE_MS);
  assert.notEqual(plan.parallel.estimatedDurationMs, THREE_MINUTE_MS);
  assert.ok(plan.assumptions.includes(EXECUTION_QUEUE_DURATION_ASSUMPTION));
  assert.ok(plan.assumptions.includes(ROUTE_VARIANT_CONFIGURATION_ASSUMPTION));
  assert.equal(
    canCoverWorkbookFamily({
      executionQueue: "fast-ui",
      declaredDwellMs: 10_000,
      family: SURVIVAL_FAMILY_ID,
    }).ok,
    false,
  );
  assert.equal(
    canCoverWorkbookFamily({
      executionQueue: "stateful-survival",
      declaredDwellMs: 10_000,
      family: SURVIVAL_FAMILY_ID,
    }).ok,
    false,
  );
});

test("capacity JSON lists Android vs iOS vs web as separate route configurations", () => {
  const plan = planCampaignCapacity({
    workItems: 23,
    workItemsByPlatform: { android: 3, ios: 12, browser: 8 },
    estimatedWorkItemDurationMs: 5_000,
    targets: [
      {
        targetId: "galaxy",
        platform: "android",
        availability: "available",
        lease: "available",
        workerId: "android-host",
      },
      {
        targetId: "ipad",
        platform: "ios",
        availability: "available",
        lease: "available",
        workerId: "ios-host",
      },
      {
        targetId: "grok-com",
        platform: "browser",
        availability: "available",
        lease: "available",
        workerId: "browser-host",
      },
    ],
    workers: [
      {
        workerId: "android-host",
        capacity: 1,
        active: 0,
        queued: 0,
        activeTargets: [],
        queuedTargets: [],
      },
      {
        workerId: "ios-host",
        capacity: 1,
        active: 0,
        queued: 0,
        activeTargets: [],
        queuedTargets: [],
      },
      {
        workerId: "browser-host",
        capacity: 8,
        active: 0,
        queued: 0,
        activeTargets: [],
        queuedTargets: [],
      },
    ],
  });
  assert.deepEqual(
    plan.routeVariantConfigurations?.map((quote) => [
      quote.platform,
      quote.workItems,
      quote.configuration,
    ]),
    [
      ["web", 8, { browser: "grok-com" }],
      ["android", 3, { app: "android" }],
      ["ios", 12, { app: "ai.x.GrokApp" }],
    ],
  );
  assert.equal(
    plan.routeVariantConfigurations?.every((quote) => quote.testId === undefined),
    true,
  );
  assert.ok(plan.assumptions.includes(ROUTE_VARIANT_CONFIGURATION_ASSUMPTION));
});
