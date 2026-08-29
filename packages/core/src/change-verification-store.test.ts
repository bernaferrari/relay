import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { ChangeVerification } from "@relay/protocol";
import {
  advanceChangeVerification,
  ChangeVerificationConflictError,
  createChangeVerification,
  listChangeVerifications,
  readChangeVerification,
  readChangeVerificationHistory,
  supersedeChangeVerification,
  type CreateChangeVerificationInput,
} from "./change-verification-store.js";
import {
  CONTROL_DB_NAME,
  CONTROL_SCHEMA_VERSION,
  openControlDatabase,
  resetControlDatabaseCache,
} from "./collaboration-db.js";
import { withControlStore } from "./collaboration-store.js";

const baseSha = "1".repeat(40);
const headSha = "2".repeat(40);
const repairedHeadSha = "3".repeat(40);
const digest = `sha256:${"a".repeat(64)}` as const;
const repairedDigest = `sha256:${"b".repeat(64)}` as const;
const scope = { organizationId: "acme", projectId: "relay" } as const;

async function withStateRoot(operation: () => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "relay-change-proof-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  try {
    await operation();
  } finally {
    resetControlDatabaseCache();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

function createInput(
  overrides: Partial<CreateChangeVerificationInput> = {},
): CreateChangeVerificationInput {
  return {
    ...scope,
    id: "proof-1",
    change: {
      repository: "acme/settings",
      baseSha,
      headSha,
      pullRequest: 184,
      agentClaim: {
        summary: "Implemented Arabic settings",
        acceptanceCriteria: ["Settings render in Arabic without RTL overlap"],
      },
    },
    policy: { id: "relay.default", version: 3 },
    requestedBy: "agent:coder",
    actorId: "agent:coder",
    requestId: "request-start",
    requestDigest: digest,
    at: 100,
    ...overrides,
  };
}

function buildsFor(sourceSha = headSha, artifactDigest = digest): ChangeVerification["builds"] {
  return [
    {
      id: "web",
      platform: "web",
      artifactDigest,
      sourceSha,
      configuration: "production",
      environmentRevision: "fixture-v1",
    },
  ];
}

function selection(): ChangeVerification["selection"] {
  return {
    affectedJourneys: [
      {
        appMapId: "settings",
        testId: "settings-language",
        appMapRevision: 7,
        reason: "The changed localization resources are bound to this Test.",
        confidence: "definite",
      },
    ],
    targetCases: [
      {
        id: "chromium-compact-ar",
        executionTarget: {
          schemaVersion: 1,
          kind: "local-browser",
          provider: { key: "relay.local.browser", scope: "local" },
          targetId: "web",
          platform: "browser",
          identity: { kind: "browser-target", value: "web" },
        },
        targetProfile: {
          id: "web:compact:ar",
          targetId: "web",
          source: "browser",
          platform: "browser",
          name: "Compact Chromium Arabic",
          viewport: { width: 390, height: 844 },
          browserCaseProfile: {
            schemaVersion: 1,
            engine: "chromium",
            viewport: { width: 390, height: 844 },
            deviceScaleFactor: 2,
            mobile: true,
            touch: true,
            locale: "ar",
            timezoneId: "UTC",
            colorScheme: "dark",
            reducedMotion: "no-preference",
            permissions: [],
            offline: false,
            environmentRevision: "fixture-v1",
          },
          capabilities: ["snapshot", "screenshot", "tap", "type"],
          observedAt: 100,
        },
        dimensions: { locale: "ar", viewport: "compact" },
        required: true,
      },
    ],
  };
}

function planApproval(): NonNullable<ChangeVerification["planApproval"]> {
  return {
    decisionId: "decision-1",
    approvedBy: "human:reviewer",
    approvedAt: 200,
    reason: "The selected journeys and targets cover the stated change.",
  };
}

test("Change Verification persistence is append-only and compare-and-set", async () => {
  await withStateRoot(async () => {
    const created = await createChangeVerification(createInput());
    assert.equal(created.state, "awaiting-build");
    assert.equal(created.version, 1);

    const ready = await advanceChangeVerification({
      ...scope,
      proofId: created.id,
      expectedVersion: created.version,
      state: "ready",
      actorId: "human:reviewer",
      requestId: "request-approve",
      requestDigest: digest,
      action: "approve-plan",
      at: 200,
      builds: buildsFor(),
      selection: selection(),
      planApproval: planApproval(),
    });
    assert.equal(ready.version, 2);

    const running = await advanceChangeVerification({
      ...scope,
      proofId: ready.id,
      expectedVersion: ready.version,
      state: "running-pilot",
      actorId: "agent:relay",
      requestId: "request-pilot",
      requestDigest: digest,
      action: "start-pilot",
      at: 300,
      runIds: ["run-1"],
      evidenceDigests: [digest],
    });
    const rejected = await advanceChangeVerification({
      ...scope,
      proofId: running.id,
      expectedVersion: running.version,
      state: "rejected",
      actorId: "agent:relay",
      requestId: "request-reject",
      requestDigest: digest,
      action: "record-decision",
      at: 400,
      firstCausalFailure: {
        runId: "run-1",
        testId: "settings-language",
        targetCaseId: "chromium-compact-ar",
        summary: "Primary action overlaps the Arabic description.",
        evidenceRefs: [digest],
      },
    });
    assert.equal(rejected.decision, "rejected");

    const history = await readChangeVerificationHistory(scope, created.id);
    assert.deepEqual(
      history.map(({ version, state }) => ({ version, state })),
      [
        { version: 1, state: "awaiting-build" },
        { version: 2, state: "ready" },
        { version: 3, state: "running-pilot" },
        { version: 4, state: "rejected" },
      ],
    );
    assert.equal(history[2]!.decision, undefined);

    await assert.rejects(
      advanceChangeVerification({
        ...scope,
        proofId: ready.id,
        expectedVersion: ready.version,
        state: "running-pilot",
        actorId: "agent:stale",
        requestId: "request-stale",
        requestDigest: digest,
        action: "start-pilot",
        at: 500,
      }),
      (error) => error instanceof ChangeVerificationConflictError && error.code === "PROOF_STALE",
    );
  });
});

test("Proof reads and lists are isolated by organization and project", async () => {
  await withStateRoot(async () => {
    await createChangeVerification(createInput());
    assert.equal((await listChangeVerifications(scope)).length, 1);
    assert.equal(
      await readChangeVerification(
        { organizationId: "other", projectId: scope.projectId },
        "proof-1",
      ),
      undefined,
    );
    assert.deepEqual(
      await listChangeVerifications({ organizationId: scope.organizationId, projectId: "other" }),
      [],
    );
  });
});

test("running Proofs only permit same-state append through record-runs", async () => {
  await withStateRoot(async () => {
    const created = await createChangeVerification(
      createInput({ builds: buildsFor(), selection: selection() }),
    );
    const ready = await advanceChangeVerification({
      ...scope,
      proofId: created.id,
      expectedVersion: created.version,
      state: "ready",
      actorId: "human:reviewer",
      requestId: "request-approve",
      requestDigest: digest,
      action: "approve-plan",
      at: 200,
      planApproval: planApproval(),
    });
    const pilot = await advanceChangeVerification({
      ...scope,
      proofId: ready.id,
      expectedVersion: ready.version,
      state: "running-pilot",
      actorId: "agent:relay",
      requestId: "request-pilot",
      requestDigest: digest,
      action: "start-pilot",
      at: 300,
    });
    const running = await advanceChangeVerification({
      ...scope,
      proofId: pilot.id,
      expectedVersion: pilot.version,
      state: "running",
      actorId: "agent:relay",
      requestId: "request-expansion",
      requestDigest: digest,
      action: "start-required-coverage",
      at: 400,
    });
    await assert.rejects(
      advanceChangeVerification({
        ...scope,
        proofId: running.id,
        expectedVersion: running.version,
        state: "running",
        actorId: "agent:relay",
        requestId: "request-invalid-same-state",
        requestDigest: digest,
        action: "approve-plan",
        at: 500,
      }),
      (error) =>
        error instanceof ChangeVerificationConflictError && error.code === "PROOF_IMMUTABLE",
    );
  });
});

test("a repaired head creates a new Proof and supersedes without rewriting history", async () => {
  await withStateRoot(async () => {
    const created = await createChangeVerification(
      createInput({ builds: buildsFor(), selection: selection() }),
    );
    const ready = await advanceChangeVerification({
      ...scope,
      proofId: created.id,
      expectedVersion: created.version,
      state: "ready",
      actorId: "human:reviewer",
      requestId: "request-approve",
      requestDigest: digest,
      action: "approve-plan",
      at: 200,
      planApproval: planApproval(),
    });
    const running = await advanceChangeVerification({
      ...scope,
      proofId: ready.id,
      expectedVersion: ready.version,
      state: "running-pilot",
      actorId: "agent:relay",
      requestId: "request-pilot",
      requestDigest: digest,
      action: "start-pilot",
      at: 300,
      runIds: ["run-1"],
      evidenceDigests: [digest],
    });
    const rejected = await advanceChangeVerification({
      ...scope,
      proofId: running.id,
      expectedVersion: running.version,
      state: "rejected",
      actorId: "agent:relay",
      requestId: "request-reject",
      requestDigest: digest,
      action: "record-decision",
      at: 400,
    });

    const superseded = await supersedeChangeVerification({
      ...scope,
      proofId: rejected.id,
      expectedVersion: rejected.version,
      actorId: "agent:relay",
      requestId: "request-rerun",
      requestDigest: digest,
      at: 500,
      replacement: createInput({
        id: "proof-2",
        change: {
          ...createInput().change,
          baseSha: headSha,
          headSha: repairedHeadSha,
        },
        builds: buildsFor(repairedHeadSha, repairedDigest),
        actorId: "agent:coder",
        at: 500,
      }),
    });
    assert.equal(superseded.previous.state, "superseded");
    assert.equal(superseded.previous.supersededByProofId, "proof-2");
    assert.equal(superseded.replacement.supersedesProofId, "proof-1");
    assert.equal(superseded.replacement.change.headSha, repairedHeadSha);

    const oldHistory = await readChangeVerificationHistory(scope, "proof-1");
    assert.equal(oldHistory.at(-2)?.state, "rejected");
    assert.equal(oldHistory.at(-2)?.decision, "rejected");
    assert.equal(oldHistory.at(-1)?.state, "superseded");
    assert.equal((await listChangeVerifications(scope)).length, 2);
  });
});

test("stale supersession rolls back the replacement Proof atomically", async () => {
  await withStateRoot(async () => {
    const created = await createChangeVerification(createInput());
    await assert.rejects(
      supersedeChangeVerification({
        ...scope,
        proofId: created.id,
        expectedVersion: created.version + 1,
        actorId: "agent:coder",
        requestId: "request-stale-rerun",
        requestDigest: digest,
        at: 200,
        replacement: createInput({
          id: "orphan-must-not-exist",
          change: { ...createInput().change, baseSha: headSha, headSha: repairedHeadSha },
          at: 200,
        }),
      }),
      (error) => error instanceof ChangeVerificationConflictError && error.code === "PROOF_STALE",
    );
    assert.equal(await readChangeVerification(scope, "orphan-must-not-exist"), undefined);
    assert.deepEqual(
      (await listChangeVerifications(scope)).map(({ id }) => id),
      [created.id],
    );
  });
});

test("recorded runs, evidence, and the first causal failure cannot be rewritten", async () => {
  await withStateRoot(async () => {
    const created = await createChangeVerification(
      createInput({ builds: buildsFor(), selection: selection() }),
    );
    const ready = await advanceChangeVerification({
      ...scope,
      proofId: created.id,
      expectedVersion: created.version,
      state: "ready",
      actorId: "human:reviewer",
      requestId: "request-approve",
      requestDigest: digest,
      action: "approve-plan",
      at: 200,
      planApproval: planApproval(),
    });
    const running = await advanceChangeVerification({
      ...scope,
      proofId: ready.id,
      expectedVersion: ready.version,
      state: "running-pilot",
      actorId: "agent:relay",
      requestId: "request-pilot",
      requestDigest: digest,
      action: "start-pilot",
      at: 300,
      runIds: ["run-1"],
      evidenceDigests: [digest],
      firstCausalFailure: {
        runId: "run-1",
        summary: "Original failure",
        evidenceRefs: [digest],
      },
    });
    await assert.rejects(
      advanceChangeVerification({
        ...scope,
        proofId: running.id,
        expectedVersion: running.version,
        state: "rejected",
        actorId: "agent:relay",
        requestId: "request-reject",
        requestDigest: digest,
        action: "record-decision",
        at: 400,
        runIds: [],
        firstCausalFailure: {
          runId: "run-1",
          summary: "Rewritten failure",
          evidenceRefs: [digest],
        },
      }),
      (error) =>
        error instanceof ChangeVerificationConflictError && error.code === "PROOF_IMMUTABLE",
    );
  });
});

test("schema v7 migration preserves existing control data", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-change-proof-migration-"));
  const path = join(root, CONTROL_DB_NAME);
  try {
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO metadata(key, value) VALUES ('legacy-marker', 'preserved');
      PRAGMA user_version = 6;
    `);
    legacy.close();

    const migrated = openControlDatabase(path);
    try {
      const version = migrated.prepare("PRAGMA user_version").get() as { user_version: number };
      const marker = migrated
        .prepare("SELECT value FROM metadata WHERE key = 'legacy-marker'")
        .get() as { value: string };
      const proofTable = migrated
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'change_verification_versions'",
        )
        .get() as { name?: string } | undefined;
      const publicationTable = migrated
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'change_proof_publications'",
        )
        .get() as { name?: string } | undefined;
      assert.equal(Number(version.user_version), CONTROL_SCHEMA_VERSION);
      assert.equal(marker.value, "preserved");
      assert.equal(proofTable?.name, "change_verification_versions");
      assert.equal(publicationTable?.name, "change_proof_publications");
    } finally {
      migrated.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("malformed persisted Proofs fail closed when read", async () => {
  await withStateRoot(async () => {
    await withControlStore((store) => {
      store.insertChangeVerification({
        id: "malformed",
        version: 1,
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        state: "planning",
        change: { repository: "acme/settings", baseSha, headSha },
        updatedAt: 100,
      } as ChangeVerification);
    });
    await assert.rejects(readChangeVerification(scope, "malformed"));
    await assert.rejects(listChangeVerifications(scope));
  });
});

test("persisted v1 Proof documents project to review-required v2", async () => {
  await withStateRoot(async () => {
    const current = await createChangeVerification(createInput({ id: "current-shape" }));
    const {
      lastMutation: _receipt,
      planApproval: _approval,
      cancellation: _cancellation,
      ...legacy
    } = current;
    await withControlStore((store) => {
      store.insertChangeVerification({
        ...legacy,
        schemaVersion: 1,
        id: "legacy-proof",
      } as unknown as ChangeVerification);
    });

    const migrated = await readChangeVerification(scope, "legacy-proof");
    assert.equal(migrated?.schemaVersion, 2);
    assert.equal(migrated?.state, "needs-review");
    assert.equal(migrated?.decision, "needs-review");
    assert.equal(migrated?.lastMutation.action, "legacy-v1-migration");
  });
});
