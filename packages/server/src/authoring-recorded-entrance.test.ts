import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AuthoringSessionStore,
  createAppMap,
  mutateStoredAppMap,
  readAppMap,
  runWithOperationContext,
  commitAppMapRecording,
  compileAppMapScenarioTest,
  loadFrozenRawAccessibilityEvidence,
  nativeCaptureTargetProfile,
  observeScreenIdentity,
  persistCapturedAuthoringObservation,
  preflightCompiledAppMapTestOffline,
  seedAuthoringRawRecording,
  type AuthoringRuntime,
  type CapturedAuthoringObservation,
  type Device,
  type SnapshotNode,
} from "@relay/core";
import { recordAuthoringInteraction, finishAuthoringRecording } from "@relay/core/testing";
import type {
  AppMap,
  AuthoringInteraction,
  AuthoringSession,
  AuthoringTakeRevision,
} from "@relay/protocol";
import { captureAuthoringObservation } from "./authoring-routes.js";

const label = "Quick responses · Grok 4.7";
const bundle = "ai.x.GrokApp";
const serial = "hermetic-native-entrance";
const baseNodes: SnapshotNode[] = [
  {
    type: "Application",
    label: "Grok",
    identifier: bundle,
    bundleId: bundle,
    depth: 0,
    logicalCoordinates: true,
    rect: { x: 0, y: 0, width: 1112, height: 834 },
  },
  {
    type: "Button",
    identifier: "sidebar.open.button",
    label: "Open sidebar",
    hittable: true,
    rect: { x: 16, y: 20, width: 44, height: 44 },
  },
  {
    type: "Button",
    identifier: "toolbar.model.selector.button",
    label: "Fast",
    hittable: true,
    rect: { x: 70, y: 20, width: 100, height: 44 },
  },
];
const row = {
  type: "Button",
  label,
  hittable: true,
  enabled: true,
  logicalCoordinates: true,
  rect: { x: 820, y: 82, width: 224, height: 70 },
};
const target = { kind: "device", platform: "ios", targetId: serial } as const;
const profile = nativeCaptureTargetProfile({
  ...target,
  observedAt: 100,
  viewport: { width: 1112, height: 834 },
});
const review = {
  schemaVersion: 1 as const,
  provenance: {
    schemaVersion: 1 as const,
    mode: "control-and-record" as const,
    origin: "relay-control" as const,
  },
  proof: "relay-controlled" as const,
};

type Request = { includeLabels?: readonly string[]; includeIdentifiers?: readonly string[] };
async function recorded(
  run: (value: {
    session: AuthoringSession;
    compile(revision?: AuthoringTakeRevision): Promise<{
      map: AppMap;
      plan: ReturnType<typeof compileAppMapScenarioTest>["plan"];
      preflight: ReturnType<typeof preflightCompiledAppMapTestOffline>;
    }>;
    captures: Request[];
    runtime: AuthoringRuntime;
    reset(): void;
    dependencies: Parameters<typeof captureAuthoringObservation>[1];
  }) => Promise<void>,
  options: { duplicate?: boolean; interaction?: AuthoringInteraction; stop?: boolean } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "relay-entrance-"));
  const oldState = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = directory;
  let clock = Date.now();
  let dispatched = false;
  const captures: Request[] = [];
  const dependencies = {
    async captureProfile() {
      return profile;
    },
    async resolveDevice() {
      return {} as Device;
    },
    async captureSnapshot(_device: Device, request?: Request) {
      captures.push(request ?? {});
      const extra =
        !dispatched && request?.includeLabels?.includes(label)
          ? [row, ...(options.duplicate ? [{ ...row, rect: { ...row.rect, y: 180 } }] : [])].map(
              (node) => ({ ...node, recordingSelectorSupplemental: true }),
            )
          : [];
      const nodes = [...baseNodes, ...extra];
      return {
        serial,
        capturedAt: (clock = Date.now()),
        nodes,
        interactive: nodes,
        inspectable: true,
        source: "sdk" as const,
        treeApp: bundle,
        foregroundApp: bundle,
        bindingState: "matched" as const,
        bounds: { width: 1112, height: 834 },
        screenIdentity: observeScreenIdentity(baseNodes),
      };
    },
    async captureScreenshot() {
      const bytes = Buffer.from("same-current-home-pixels");
      return {
        serial,
        capturedAt: (clock = Date.now()),
        mime: "image/png" as const,
        base64: bytes.toString("base64"),
        path: join(directory, "ephemeral.png"),
        bytes: bytes.length,
        width: 2224,
        height: 1668,
      };
    },
  };
  const runtime: AuthoringRuntime = {
    observe: (session, request?: Request) =>
      captureAuthoringObservation(session, dependencies, request),
    execute: async (_session, interaction) => {
      assert.ok(interaction.kind === "tap" || interaction.kind === "steps");
      const intent = JSON.parse(
        await readFile(join(directory, "intent.json"), "utf8"),
      ) as AuthoringSession;
      assert.equal(intent.take!.rawEvents!.at(-1)!.kind, "interaction-intent");
      dispatched = interaction.kind !== "tap" || !interaction.target.identifier;
    },
    replay: async () => {
      throw new Error("no replay");
    },
  };
  try {
    const shell: AuthoringSession = {
      schemaVersion: 1,
      id: "entrance-session",
      organizationId: "org",
      projectId: "project",
      actorId: "human",
      actorKind: "human",
      appMapId: "map",
      originApplication: bundle,
      sourceScreenId: "home",
      pendingConnectionId: "pick-row",
      destination: { kind: "screen", screenId: "home" },
      state: "recording",
      target,
      leaseId: "lease",
      expectedAppMapRevision: 1,
      createdAt: clock,
      updatedAt: clock,
    };
    const initial = await persistCapturedAuthoringObservation(await runtime.observe(shell));
    const before = initial.observation;
    const lifecycle: Parameters<
      typeof recordAuthoringInteraction<CapturedAuthoringObservation>
    >[3] = {
      now: () => (clock = Date.now()),
      persistObservation: persistCapturedAuthoringObservation,
      persistEvidence: async () => {
        throw new Error("no video");
      },
      writeSession: (next) => writeFile(join(directory, "intent.json"), JSON.stringify(next)),
      nextRevision(current, reason, mutate) {
        const last = current.take!.revisions.at(-1)!;
        const next = mutate(structuredClone(last));
        next.revision = last.revision + 1;
        next.id = `take:${next.revision}`;
        next.reason = reason;
        return {
          ...current,
          take: {
            ...current.take!,
            currentRevision: next.revision,
            revisions: [...current.take!.revisions, next],
          },
        };
      },
    };
    let session = await recordAuthoringInteraction<CapturedAuthoringObservation>(
      {
        ...shell,
        take: {
          id: "take",
          state: "recording",
          createdAt: clock,
          updatedAt: clock,
          currentRevision: 1,
          revisions: [
            {
              id: "take:1",
              takeId: "take",
              revision: 1,
              createdAt: clock,
              createdBy: "human",
              reason: "recording",
              actions: [],
              evidence: initial.evidence,
              observations: [before],
              before,
              after: before,
            },
          ],
          replayAttempts: [],
          ...seedAuthoringRawRecording({
            target,
            trigger: "recording",
            recordedAt: clock,
            observation: before,
          }),
        },
      },
      options.interaction ?? { kind: "tap", target: { label } },
      runtime,
      lifecycle,
    );
    if (options.stop) session = await finishAuthoringRecording(session, runtime, lifecycle);
    const compile = async (revision = session.take!.revisions.at(-1)!) => {
      const scope = { organizationId: "org", projectId: "project", appMapId: "map" };
      const map: AppMap = {
        schemaVersion: 1,
        id: "map",
        organizationId: "org",
        projectId: "project",
        name: "Native row",
        revision: 1,
        notes: {},
        groups: {},
        screens: {
          home: {
            ...scope,
            id: "home",
            title: "Home",
            identity: {
              schemaVersion: 1,
              fingerprint: before.screen.fingerprint,
              aliases: [observeScreenIdentity(baseNodes).fingerprint],
            },
            variantIds: [],
            createdAt: 1,
            updatedAt: 1,
          },
        },
        screenVariants: {},
        connections: {
          "pick-row": {
            ...scope,
            id: "pick-row",
            fromScreenId: "home",
            destination: { kind: "screen", screenId: "home" },
            state: "ready",
            actions: [{ id: "old-row", kind: "tap", target: { label } }],
            createdAt: 1,
            updatedAt: 1,
          },
        },
        caseStacks: {},
        variables: {},
        tests: {},
        combines: {},
        routines: {},
        flows: {},
        runs: {},
        targetResults: {},
        proposals: {},
        activity: {},
        createdAt: 1,
        updatedAt: 1,
      };
      const evidence = revision.evidence;
      const committed = commitAppMapRecording(
        map,
        {
          sessionId: session.id,
          target,
          targetProfile: profile,
          takeId: "take",
          takeRevision: revision.revision,
          entranceCaptureVersion: revision.entranceCaptureVersion,
          actions: revision.actions,
          observations: revision.observations,
          before: revision.before,
          after: revision.after,
          sourceScreenId: "home",
          pendingConnectionId: "pick-row",
          destination: { kind: "screen", screenId: "home" },
          testId: "row-test",
          testName: "Pick native menu row",
          originApplication: bundle,
          captureReview: review,
          evidenceIds: evidence.map((item) => item.id),
          evidenceUrisById: Object.fromEntries(evidence.map((item) => [item.id, item.uri])),
          evidenceKindsById: Object.fromEntries(evidence.map((item) => [item.id, item.kind])),
          evidenceById: Object.fromEntries(evidence.map((item) => [item.id, item])),
        },
        {
          expectedRevision: 1,
          eventId: session.id,
          actorId: "human",
          actorKind: "human",
          at: (clock = Date.now()),
        },
      );
      const plan = compileAppMapScenarioTest(
        committed.appMap,
        committed.appMap.tests["row-test"]!,
        { runtimeTargetProfile: profile },
      ).plan;
      const preflight = preflightCompiledAppMapTestOffline(
        plan,
        await loadFrozenRawAccessibilityEvidence(plan),
        { targetProfileId: profile.id },
      );
      return { map: committed.appMap, plan, preflight };
    };
    await run({
      session,
      compile,
      captures,
      runtime,
      dependencies,
      reset() {
        dispatched = false;
      },
    });
  } finally {
    if (oldState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = oldState;
    await rm(directory, { recursive: true, force: true });
  }
}

function tapIn(plan: ReturnType<typeof compileAppMapScenarioTest>["plan"]) {
  return Object.values(plan.recipes)
    .flatMap((recipe) => recipe.steps)
    .find((step) => step.kind === "tap")!;
}

test("actual native capture→record→commit→compile retains an exact menu entrance after Home→Home overwrites latest tree", async () => {
  await recorded(async ({ session, compile, captures }) => {
    assert.ok(
      captures.some((request) => request.includeLabels?.includes(label)),
      "named tap must capture its requested label before input",
    );
    const action = session.take!.revisions.at(-1)!.actions[0]!;
    const { map, plan, preflight } = await compile();
    const step = tapIn(plan);
    assert.ok(step.recordedEntrance, "exact recorded step entrance must be frozen");
    assert.ok(step.recordedEntrance.status === "captured");
    assert.equal(step.recordedEntrance.actionId, action.id);
    assert.equal(step.recordedEntrance.observationId, action.entranceObservationId);
    assert.equal(preflight.findings.filter((finding) => finding.severity === "blocker").length, 0);
    const selector = preflight.selectors.find((item) => item.stepKind === "tap")!;
    assert.equal(selector.status, "resolved");
    assert.match(selector.detail ?? "", /entrance|native.*uniqueness/i);
    const variant = Object.values(map.screenVariants)[0]!;
    assert.ok(variant.observation);
    assert.ok(!variant.observation.nodes.some((node) => node.label === label));
    const latest = await loadFrozenRawAccessibilityEvidence(plan);
    assert.ok(
      !latest.rawSourcesByScreenId!.home!.some((source) =>
        source.nodes!.some((node) => node.label === label),
      ),
    );
    assert.deepEqual(map.screens.home!.identity!.aliases, [
      observeScreenIdentity(baseNodes).fingerprint,
    ]);
  });
});

test("duplicate native entrance candidates remain ambiguous instead of claiming tap uniqueness", async () => {
  await recorded(
    async ({ compile }) => {
      const { preflight } = await compile();
      const selector = preflight.selectors.find((item) => item.stepKind === "tap")!;
      assert.equal(selector.status, "ambiguous");
      assert.equal(selector.rawCandidateCount, 2);
      assert.ok(preflight.findings.some((finding) => finding.severity === "blocker"));
    },
    { duplicate: true },
  );
});

test("edited or reordered Take action cannot borrow its former entrance", async () => {
  await recorded(async ({ session, compile }) => {
    for (const mode of ["edited", "reordered"] as const) {
      const revision = structuredClone(session.take!.revisions.at(-1)!);
      revision.revision += 1;
      const action = revision.actions[0]!;
      delete action.entranceObservationId;
      delete action.exitObservationId;
      delete action.proofStatus;
      if (mode === "edited")
        action.steps = [{ ...action.steps[0]!, kind: "tap", target: { label: "Open sidebar" } }];
      const { preflight } = await compile(revision);
      assert.ok(
        preflight.findings.some((finding) => finding.severity === "blocker"),
        `${mode} action must require new entrance proof`,
      );
    }
  });
});

// Exercise the real session Stop and connection-only atomic commit path.
for (const replayEdited of [false, true])
  test(
    replayEdited
      ? "edited native replay reacquires exact action entrances before connection-only commit"
      : "two unchanged native entrances survive ordinary actions and Stop in a connection-only commit",
    async () => {
      await recorded(async ({ compile, runtime, reset, captures }) => {
        const { map } = await compile();
        const requestId = crypto.randomUUID();
        await runWithOperationContext(
          {
            schemaVersion: 1,
            actorId: "human",
            actorKind: "human",
            organizationId: "org",
            projectId: "project",
            operationId: "authoring.test",
            requestId,
            idempotencyKey: requestId,
            issuedAt: Date.now(),
          },
          async () => {
            await createAppMap({
              organizationId: "org",
              projectId: "project",
              appMapId: "map",
              name: "Native row",
            });
            const seeded = await mutateStoredAppMap("project", "map", (current) => ({
              ...map,
              activity: {},
              revision: current.revision + 1,
            }));
            const store = new AuthoringSessionStore();
            const actualRuntime: AuthoringRuntime = {
              ...runtime,
              prepareReplaySource: async () => reset(),
              observeReplayActionEndpoint: runtime.observe,
              async replayAction(session, action) {
                const step = action.steps[0]!;
                if (step.kind !== "tap") throw new Error("tap expected");
                await runtime.execute(session, { kind: "tap", target: step.target });
              },
              async execute(session, interaction) {
                const durable = await store.get(session.id);
                assert.equal(durable.take!.rawEvents!.at(-1)!.kind, "interaction-intent");
                await runtime.execute(session, interaction);
              },
            };
            let session = await store.create({
              appMapId: "map",
              sourceScreenId: "home",
              pendingConnectionId: "pick-row",
              target,
              originApplication: bundle,
              leaseId: "test-lease",
              expectedAppMapRevision: seeded.revision,
            });
            reset();
            session = await store.observe(session.id, actualRuntime);
            session = await store.start(session.id, actualRuntime);
            for (const stepTarget of [{ identifier: "toolbar.model.selector.button" }, { label }]) {
              session = await store.interact(
                session.id,
                { kind: "tap", target: stepTarget },
                actualRuntime,
              );
            }
            session = await store.stop(session.id, actualRuntime);
            if (replayEdited) {
              const count = captures.filter((request) =>
                request.includeLabels?.includes(label),
              ).length;
              session = await store.reorder(
                session.id,
                session.take!.revisions.at(-1)!.actions.map((action) => action.id),
              );
              assert.ok(
                session
                  .take!.revisions.at(-1)!
                  .actions.every((action) => !action.entranceObservationId),
              );
              session = await store.replay(session.id, actualRuntime);
              assert.equal(session.take!.replayAttempts.at(-1)!.outcome, "passed");
              assert.equal(
                captures.filter((request) => request.includeLabels?.includes(label)).length,
                count + 1,
              );
            }
            session = await store.commit(session.id, {});
            assert.equal(session.committedTestId, undefined);
            const saved = (await readAppMap("project", "map"))!;
            const action = saved.connections["pick-row"]!.actions[0]!;
            assert.equal(action.kind, "recorded");
            if (action.kind !== "recorded") throw new Error("recorded action expected");
            assert.equal(action.steps.length, 2);
            assert.ok(
              action.steps.every((step) => step.recordedEntrance?.status === "captured"),
              JSON.stringify(action.steps.map((step) => step.recordedEntrance?.status)),
            );
            const plan = compileAppMapScenarioTest(saved, saved.tests["row-test"]!, {
              runtimeTargetProfile: profile,
            }).plan;
            const result = preflightCompiledAppMapTestOffline(
              plan,
              await loadFrozenRawAccessibilityEvidence(plan),
              { targetProfileId: profile.id },
            );
            assert.equal(result.summary.blockers, 0, JSON.stringify(result.findings));
          },
        );
      });
    },
  );

test("current action provenance rejects stale, foreign, mismatched and outdated saved entrances", async () => {
  await recorded(async ({ session, compile }) => {
    for (const mode of ["stale", "foreign", "geometry", "digest"] as const) {
      const revision = structuredClone(session.take!.revisions.at(-1)!);
      const action = revision.actions[0]!;
      const entrance = revision.observations!.find(
        (item) => item.id === action.entranceObservationId,
      )!;
      if (mode === "stale") entrance.proof!.semantics.status = "stale";
      if (mode === "foreign") entrance.capture!.treeApp = "com.apple.SafariViewService";
      if (mode === "geometry") entrance.bounds!.width = 834;
      if (mode === "digest")
        action.steps = [
          {
            ...action.steps[0]!,
            kind: "tap",
            target: { identifier: "toolbar.model.selector.button" },
          },
        ];
      const { preflight } = await compile(revision);
      assert.ok(preflight.summary.blockers > 0, mode);
    }
    const { map } = await compile();
    const action = map.connections["pick-row"]!.actions[0]!;
    if (action.kind !== "recorded") throw new Error("recorded action expected");
    action.takeRevision += 1;
    map.connections["pick-row"]!.recordingSource!.takeRevision = action.takeRevision;
    const plan = compileAppMapScenarioTest(map, map.tests["row-test"]!, {
      runtimeTargetProfile: profile,
    }).plan;
    assert.equal(tapIn(plan).recordedEntrance?.status, "unavailable");
    assert.ok(
      preflightCompiledAppMapTestOffline(plan, await loadFrozenRawAccessibilityEvidence(plan), {
        targetProfileId: profile.id,
      }).summary.blockers > 0,
    );
  });
});

test("immutable raw proof must match observation, owner and selected profile after reload", async () => {
  await recorded(async ({ compile }) => {
    const { plan } = await compile();
    for (const mode of ["observation", "profile", "owner", "missing"] as const) {
      const modified = structuredClone(plan);
      const entrance = tapIn(modified).recordedEntrance;
      if (entrance?.status !== "captured") throw new Error("captured entrance expected");
      if (mode === "observation") entrance.observationId = "another-observation";
      if (mode === "profile") entrance.profile.targetId = "another-device";
      if (mode === "owner") entrance.originApplication = "com.apple.SafariViewService";
      const evidence = await loadFrozenRawAccessibilityEvidence(
        modified,
        mode === "missing" ? { readEvidence: async () => null } : {},
      );
      assert.ok(
        preflightCompiledAppMapTestOffline(modified, evidence, { targetProfileId: profile.id })
          .summary.blockers > 0,
        mode,
      );
    }
  });
});

test("modern multi-step native actions cannot borrow their first named entrance", async () => {
  await recorded(
    async ({ compile }) => {
      const { plan, preflight } = await compile();
      const steps = Object.values(plan.recipes)
        .flatMap((recipe) => recipe.steps)
        .filter((step) => step.kind === "tap");
      assert.ok(steps.every((step) => step.recordedEntrance?.status === "unavailable"));
      assert.equal(
        preflight.selectors.filter(
          (selector) => selector.stepKind === "tap" && selector.status === "resolved",
        ).length,
        0,
      );
    },
    {
      interaction: {
        kind: "steps",
        steps: [
          { kind: "tap", target: { identifier: "toolbar.model.selector.button" } },
          { kind: "tap", target: { label } },
        ],
      },
    },
  );
});

test("modern saved action with omitted entrance cannot use legacy global chrome", async () => {
  await recorded(async ({ compile }) => {
    const { map } = await compile();
    const action = map.connections["pick-row"]!.actions[0]!;
    if (action.kind !== "recorded") throw new Error("recorded action expected");
    action.steps = [{ kind: "tap", target: { identifier: "toolbar.model.selector.button" } }];
    const plan = compileAppMapScenarioTest(map, map.tests["row-test"]!, {
      runtimeTargetProfile: profile,
    }).plan;
    assert.equal(tapIn(plan).recordedEntrance?.status, "unavailable");
    assert.ok(
      preflightCompiledAppMapTestOffline(plan, await loadFrozenRawAccessibilityEvidence(plan), {
        targetProfileId: profile.id,
      }).summary.blockers > 0,
    );
  });
});

test("explicit native point survives recording and Stop without semantic entrance evidence", async () => {
  await recorded(
    async ({ compile }) => {
      const { plan, preflight } = await compile();
      const step = tapIn(plan);
      assert.equal(step.kind, "tap");
      if (step.kind !== "tap") throw new Error("tap expected");
      assert.ok(step.target.point);
      assert.equal(step.recordedEntrance, undefined);
      assert.equal(preflight.summary.blockers, 0, JSON.stringify(preflight.findings));
    },
    {
      interaction: {
        kind: "tap",
        target: { point: { x: 600, y: 730, referenceBounds: { width: 1112, height: 834 } } },
      },
      stop: true,
    },
  );
});

test("genuine legacy recordings retain their existing global catalog validation", async () => {
  await recorded(async ({ session, compile }) => {
    const revision = structuredClone(session.take!.revisions.at(-1)!);
    delete revision.entranceCaptureVersion;
    const action = revision.actions[0]!;
    delete action.entranceCaptureVersion;
    delete action.entranceCaptureRevision;
    delete action.entranceStepDigest;
    action.steps = [{ kind: "tap", target: { identifier: "toolbar.model.selector.button" } }];
    const { plan, preflight } = await compile(revision);
    assert.equal(tapIn(plan).recordedEntrance, undefined);
    assert.equal(preflight.summary.blockers, 0);
  });
});
