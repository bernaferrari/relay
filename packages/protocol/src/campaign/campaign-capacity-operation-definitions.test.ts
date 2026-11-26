import assert from "node:assert/strict";
import test from "node:test";
import { campaignCapacityOperationDefinitions } from "./campaign-capacity-operation-definitions.js";

function campaignCapacityDefinition() {
  const definitions = campaignCapacityOperationDefinitions;
  assert.equal(definitions.length, 3);
  return definitions[0]!;
}

function localCampaignAdmissionDefinition() {
  const definitions = campaignCapacityOperationDefinitions;
  assert.equal(definitions.length, 3);
  return definitions[2]!;
}

const validInput = {
  targets: [
    { targetId: "pixel-1", platform: "android" },
    { targetId: "ipad-1", platform: "ios" },
  ],
  workItems: 40,
  workItemsByPlatform: { android: 20, ios: 20 },
  duration: {
    workItemDurationMs: 1_000,
    provenance: "observed-p95",
    observedAt: 1_700_000_000_000,
    sampleCount: 25,
    maxAgeMs: 60_000,
  },
  deadlineMs: 180_000,
  setupHeadroomMs: 10_000,
  recoveryHeadroomMs: 20_000,
};

test("campaign capacity preflight retains its public descriptor and transport", () => {
  const definition = campaignCapacityDefinition();
  assert.deepEqual(
    {
      id: definition.id,
      label: definition.label,
      category: definition.category,
      mode: definition.mode,
      idempotency: definition.idempotency,
      targetCapabilities: definition.targetCapabilities,
      lease: definition.lease,
      confirmation: definition.confirmation,
      minimumRole: definition.minimumRole,
      progress: definition.progress,
      cancellable: definition.cancellable,
      transport: definition.transport,
      input: definition.input.description,
      output: definition.output.description,
    },
    {
      id: "campaign.capacity.preflight",
      label: "Preflight local campaign capacity",
      category: "execution",
      mode: "command",
      idempotency: "inherent",
      targetCapabilities: [],
      lease: "none",
      confirmation: "none",
      minimumRole: "runner",
      progress: false,
      cancellable: false,
      transport: { method: "POST", path: "/campaign-capacity/preflight" },
      input: "campaign.capacity.preflight input",
      output: "campaign.capacity.preflight output",
    },
  );
});

test("campaign capacity preflight validates exact local target and duration evidence", () => {
  const definition = campaignCapacityDefinition();
  assert.deepEqual(definition.input.parse(validInput), validInput);
  assert.deepEqual(
    definition.input.parse({
      ...validInput,
      queueMembers: [
        { executionQueue: "fast-ui", workMs: 5_000 },
        { executionQueue: "live-output", workMs: 45_000 },
        { executionQueue: "stateful-survival", workMs: 8_000, requiredDwellMs: 60_000 },
      ],
    }).queueMembers?.[0],
    { executionQueue: "fast-ui", workMs: 5_000 },
  );
  assert.deepEqual(
    definition.input.parse({
      ...validInput,
      targets: [{ targetId: "grok-web", platform: "browser" }],
      workItems: 8,
      workItemsByPlatform: { browser: 8 },
    }).targets[0],
    { targetId: "grok-web", platform: "browser" },
  );
  const validPreflight = {
    checkedAt: 1000,
    input: {
      targets: [
        {
          targetId: "pixel-a",
          platform: "android",
        },
        {
          targetId: "ipad-a",
          platform: "ios",
        },
      ],
      workItems: 4,
      workItemsByPlatform: {
        android: 2,
        ios: 2,
      },
      duration: {
        workItemDurationMs: 1000,
        provenance: "observed-p95",
        observedAt: 950,
        sampleCount: 24,
        maxAgeMs: 500,
      },
      deadlineMs: 5000,
      setupHeadroomMs: 500,
      recoveryHeadroomMs: 500,
    },
    duration: {
      workItemDurationMs: 1000,
      provenance: "observed-p95",
      observedAt: 950,
      sampleCount: 24,
      maxAgeMs: 500,
      assurance: "measured-current",
    },
    targets: [
      {
        targetId: "pixel-a",
        requestedPlatform: "android",
        observedPlatform: "android",
        availability: "available",
        lease: "available",
        workerId: "local:android:target:pixel-a",
        workerFact: "derived-local-lane",
      },
      {
        targetId: "ipad-a",
        requestedPlatform: "ios",
        observedPlatform: "ios",
        availability: "available",
        lease: "available",
        workerId: "local:ios:target:ipad-a",
        workerFact: "derived-local-lane",
      },
    ],
    deadline: {
      requestedMs: 5000,
      reservedHeadroomMs: 1000,
      workBudgetMs: 4000,
      estimatedParallelDurationMs: 3000,
      capacity: "within-budget",
      assurance: "measured-current",
      achievableWithCurrentCapacity: true,
    },
    plan: {
      workItems: 4,
      estimatedWorkItemDurationMs: 1000,
      slots: [
        {
          targetId: "ipad-a",
          platform: "ios",
          workerId: "local:ios:target:ipad-a",
        },
        {
          targetId: "pixel-a",
          platform: "android",
          workerId: "local:android:target:pixel-a",
        },
      ],
      excludedTargets: [],
      workers: [
        {
          workerId: "local:android:target:pixel-a",
          capacity: 1,
          active: 0,
          queued: 0,
          freeCapacity: 1,
          slotCount: 1,
        },
        {
          workerId: "local:ios:target:ipad-a",
          capacity: 1,
          active: 0,
          queued: 0,
          freeCapacity: 1,
          slotCount: 1,
        },
      ],
      hosts: [],
      platforms: [
        {
          platform: "android",
          scheduledSlots: 1,
          excludedTargets: 0,
          workItems: 2,
          serial: {
            slots: 1,
            estimatedDurationMs: 2000,
          },
          parallel: {
            slots: 1,
            estimatedDurationMs: 2000,
          },
          budget: {
            timeBudgetMs: 4000,
            achievableWithCurrentCapacity: true,
            requiredIndependentTargetSlots: 1,
            additionalIndependentTargetSlots: 0,
            minimumPossibleDurationMs: 1000,
          },
        },
        {
          platform: "ios",
          scheduledSlots: 1,
          excludedTargets: 0,
          workItems: 2,
          serial: {
            slots: 1,
            estimatedDurationMs: 2000,
          },
          parallel: {
            slots: 1,
            estimatedDurationMs: 2000,
          },
          budget: {
            timeBudgetMs: 4000,
            achievableWithCurrentCapacity: true,
            requiredIndependentTargetSlots: 1,
            additionalIndependentTargetSlots: 0,
            minimumPossibleDurationMs: 1000,
          },
        },
      ],
      serial: {
        slots: 1,
        estimatedDurationMs: 4000,
      },
      parallel: {
        slots: 2,
        estimatedDurationMs: 2000,
        idealSpeedup: 2,
      },
      budget: {
        timeBudgetMs: 4000,
        achievableWithCurrentCapacity: true,
        requiredIndependentTargetSlots: 2,
        additionalIndependentTargetSlots: 0,
        minimumPossibleDurationMs: 1000,
      },
      routeVariantConfigurations: [
        {
          platform: "android",
          configuration: {
            app: "android",
          },
          workItems: 2,
        },
        {
          platform: "ios",
          configuration: {
            app: "ios",
          },
          workItems: 2,
        },
      ],
      assumptions: [
        "Each work item is independently executable on any assigned target slot.",
        "Each physical target supplies at most one slot; work remains serial on that target.",
        "Mixed-platform deadline estimates require an explicit workItemsByPlatform partition; aggregate slots never let Android capacity stand in for iOS capacity.",
        "Parallel estimates assume equal work-item durations and do not include installation or recovery time unless the caller reserves them outside this pure planner.",
        "The serial estimate is a theoretical one-slot baseline, not authority to use an excluded target.",
        "Additional slots still need fresh, available, unleased targets with observed free worker and host capacity after active and queued work reserve their lanes.",
        "Leased, stale, unavailable, active, queued, duplicate, unknown-worker, and worker-saturated targets are never assigned.",
        "A shared host/provider ceiling is applied across otherwise independent physical target lanes.",
        "Fast UI, Live output, and Stateful/survival report separate duration targets; never a three-minute workbook promise. A required 1-minute survival outage cannot become a 10-second outage.",
        "Android, iOS, and web route variants are separate configurations, not one Test covering three platforms by name.",
      ],
    },
    assumptions: [
      "This preflight did not acquire a lease, reserve a target, or enqueue work.",
      "Each derived local lane has the scheduler's one-target capacity; observed scheduler facts replace that idle default when available.",
      "Queued or staged work reserves its target and shared-host capacity; its unbounded drain time is not included in a new deadline estimate.",
      "Setup and recovery headroom are reserved once on the campaign critical path, not multiplied by every work item.",
      "A supplied or stale duration can size work, but cannot make the deadline achievable with current capacity.",
      "Fast UI, Live output, and Stateful/survival report separate duration targets; never a three-minute workbook promise. A required 1-minute survival outage cannot become a 10-second outage.",
      "Android, iOS, and web route variants are separate configurations, not one Test covering three platforms by name.",
    ],
  };
  assert.deepEqual(definition.output.parse({ preflight: validPreflight }), {
    preflight: validPreflight,
  });

  for (const [invalid, pattern] of [
    [{ ...validInput, targets: [] }, /targets/],
    [{ ...validInput, targets: [{ targetId: "desktop-1", platform: "desktop" }] }, /platform/],
    [
      { ...validInput, duration: { workItemDurationMs: 1_000, provenance: "observed-p50" } },
      /observedAt/,
    ],
  ] as const) {
    assert.throws(() => definition.input.parse(invalid), pattern);
    assert.equal(definition.input.presentation.safeParse(invalid).success, false);
  }
  assert.throws(() => definition.output.parse({}), /preflight/);
});

test("local admission transport requires a canonical local AgentDevice target", () => {
  const definition = localCampaignAdmissionDefinition();
  const input = {
    workItems: [
      {
        id: "locale-it",
        testId: "settings",
        action: "app-map:settings:test:settings",
        target: {
          schemaVersion: 1,
          kind: "local-device" as const,
          provider: { key: "relay.local.agent-device", scope: "local" as const },
          targetId: "pixel-1",
          platform: "android" as const,
          identity: { kind: "device-serial" as const, value: "pixel-1" },
        },
      },
    ],
    request: { deadlineMs: 180_000, durationEvidence: [] },
  };
  assert.deepEqual(definition.input.parse(input), input);

  for (const target of [
    {
      ...input.workItems[0]!.target,
      provider: { key: "example.device-farm", scope: "remote" },
    },
    {
      ...input.workItems[0]!.target,
      identity: { kind: "device-serial", value: "another-pixel" },
    },
    {
      kind: "local-device",
      targetId: "pixel-1",
      platform: "android",
    },
  ]) {
    const invalid = { ...input, workItems: [{ ...input.workItems[0]!, target }] };
    assert.throws(() => definition.input.parse(invalid), /target/);
    assert.equal(definition.input.presentation.safeParse(invalid).success, false);
  }
});
