import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import {
  createAppMapTestExecutionIntent,
  enqueueJob,
  listDeviceLeases,
  listJobs,
  listPersistedRuns,
  resetControlDatabaseCache,
  revokeSavedSignIn,
  saveBrowserTarget,
  saveSavedSignIn,
} from "@relay/core";
import type { AppMapScenarioTestStep } from "@relay/protocol";
import { startServer } from "../index.js";
import { assertTargetControl } from "../access-control.js";

const PROJECT_ID = "mobile";
const APP_MAP_ID = "store";
const BROWSER_TARGET_ID = "shop-web";
const USER_CANARY = "canary-user-9f27d1";
const PASSWORD_CANARY = "canary-pass-4z8q2x";

type AdmissionCalls = {
  listDevices: number;
  observeViewport: number;
  assertTargetControl: number;
  createIntent: number;
  enqueueJob: number;
};

type AdmissionControl = {
  failIntentConstruction: boolean;
};

function clientFor(port: number): RelayClient {
  return new RelayClient({
    url: `http://127.0.0.1:${port}`,
    auth: { type: "none" },
    organizationId: "acme",
    projectId: PROJECT_ID,
    actorId: "human:designer",
    actorKind: "human",
  });
}

function instructionStep(id: string, intent: string): AppMapScenarioTestStep {
  return {
    id,
    kind: "instruction",
    intent,
    binding: { status: "unresolved", reason: "Runs from text", fromText: true },
  };
}

async function withAdmissionServer(
  root: string,
  run: (input: {
    client: RelayClient;
    calls: AdmissionCalls;
    control: AdmissionControl;
  }) => Promise<void>,
): Promise<void> {
  const previousState = process.env.RELAY_STATE_DIR;
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  const previousRecipes = process.env.RELAY_RECIPES_DIR;
  const previousTests = process.env.RELAY_TESTS_DIR;
  process.env.RELAY_STATE_DIR = root;
  process.env.RELAY_WORKSPACE_ROOT = root;
  process.env.RELAY_RECIPES_DIR = join(root, "recipes");
  process.env.RELAY_TESTS_DIR = join(root, "tests");
  resetControlDatabaseCache();
  const calls: AdmissionCalls = {
    listDevices: 0,
    observeViewport: 0,
    assertTargetControl: 0,
    createIntent: 0,
    enqueueJob: 0,
  };
  const control: AdmissionControl = { failIntentConstruction: false };
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    appMapTestRunRuntime: {
      async listDevices() {
        calls.listDevices += 1;
        return [];
      },
      async observeIosNativeViewport() {
        calls.observeViewport += 1;
        throw new Error("sign-in admission must not inspect a native viewport");
      },
      async assertTargetControl(scope, targetId) {
        calls.assertTargetControl += 1;
        return assertTargetControl(scope, targetId);
      },
      createAppMapTestExecutionIntent(input) {
        calls.createIntent += 1;
        if (control.failIntentConstruction) {
          throw new Error("injected post-admission intent failure");
        }
        return createAppMapTestExecutionIntent(input);
      },
      enqueueJob(input) {
        calls.enqueueJob += 1;
        return enqueueJob(input);
      },
    },
  });
  try {
    await run({ client: clientFor(server.port), calls, control });
  } finally {
    await server.close();
    resetControlDatabaseCache();
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    if (previousRecipes === undefined) delete process.env.RELAY_RECIPES_DIR;
    else process.env.RELAY_RECIPES_DIR = previousRecipes;
    if (previousTests === undefined) delete process.env.RELAY_TESTS_DIR;
    else process.env.RELAY_TESTS_DIR = previousTests;
  }
}

async function savePlainTextTest(
  client: RelayClient,
  input: { testId: string; steps: AppMapScenarioTestStep[] },
): Promise<number> {
  await saveBrowserTarget({
    id: BROWSER_TARGET_ID,
    name: "Shop",
    startUrl: "https://example.test/",
    headless: true,
  });
  await client.invoke("app-map.create", { appMapId: APP_MAP_ID, name: "Store" });
  const saved = await client.invoke("app-map.test.save", {
    appMapId: APP_MAP_ID,
    testId: input.testId,
    expectedRevision: 0,
    test: {
      name: "Plain text admission fixture",
      kind: "scenario",
      intentSchemaVersion: 1,
      steps: input.steps,
    } as never,
  });
  return saved.appMap.revision;
}

async function compiledRootSteps(
  client: RelayClient,
  testId: string,
): Promise<Array<Record<string, unknown>>> {
  const preview = await client.invoke("app-map.test.compile", {
    appMapId: APP_MAP_ID,
    testId,
  });
  const root = preview.plan.recipes[preview.plan.rootRecipeId];
  assert.ok(root, "expected the compiled fixture to have a root recipe");
  return root.steps as unknown as Array<Record<string, unknown>>;
}

function runTest(client: RelayClient, testId: string, revision: number): Promise<unknown> {
  return client.invoke("app-map.test.run", {
    appMapId: APP_MAP_ID,
    testId,
    expectedRevision: revision,
    target: { kind: "browser", targetId: BROWSER_TARGET_ID, platform: "browser" },
  });
}

async function expectConflict(
  promise: Promise<unknown>,
  code: string,
): Promise<{ error: ApiError; body: Record<string, unknown> }> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  assert.ok(error instanceof ApiError, `expected a ${code} ApiError`);
  assert.equal(error.status, 409);
  assert.ok(error.body && typeof error.body === "object" && !Array.isArray(error.body));
  const body = error.body as Record<string, unknown>;
  assert.equal(body.code, code);
  return { error, body };
}

function assertNoSecretMaterial(body: Record<string, unknown>, canaries: string[]): void {
  const serialized = JSON.stringify(body);
  for (const canary of canaries) {
    assert.equal(serialized.includes(canary), false, `response leaked plaintext canary ${canary}`);
  }
  for (const key of ["username", "password", "secret", "ciphertext", "plaintext"]) {
    assert.equal(Object.hasOwn(body, key), false, `response exposed ${key}`);
  }
  const recoveryAction = body.recoveryAction as { input?: unknown } | undefined;
  assert.deepEqual(Object.keys((recoveryAction?.input ?? {}) as object), ["key"]);
}

function assertSavedSignInMetadataOnly(body: Record<string, unknown>): void {
  assert.deepEqual(
    Object.keys(body).sort(),
    ["code", "error", "recovery", "recoveryAction", "signInKey", "signInStatus"].sort(),
  );
  assertNoSecretMaterial(body, [USER_CANARY, PASSWORD_CANARY]);
}

function assertTestInboxMetadataOnly(body: Record<string, unknown>): void {
  assert.deepEqual(
    Object.keys(body).sort(),
    ["code", "error", "inboxKey", "inboxStatus", "recovery", "recoveryAction"].sort(),
  );
  assertNoSecretMaterial(body, [USER_CANARY, PASSWORD_CANARY]);
}

type ArtifactSnapshot = {
  jobIds: Set<string>;
  runIds: Set<string>;
  leaseIds: Set<string>;
};

async function artifactSnapshot(): Promise<ArtifactSnapshot> {
  return {
    jobIds: new Set(listJobs(500).map((job) => job.id)),
    runIds: new Set((await listPersistedRuns(500)).map((run) => run.id)),
    leaseIds: new Set((await listDeviceLeases(PROJECT_ID)).map((lease) => lease.id)),
  };
}

function newIds(after: Set<string>, before: Set<string>): string[] {
  return [...after].filter((id) => !before.has(id)).sort();
}

async function assertNoNewRunArtifacts(before: ArtifactSnapshot): Promise<void> {
  const after = await artifactSnapshot();
  assert.deepEqual(newIds(after.jobIds, before.jobIds), [], "blocked admission created a job");
  assert.deepEqual(newIds(after.runIds, before.runIds), [], "blocked admission persisted a run");
  assert.deepEqual(
    newIds(after.leaseIds, before.leaseIds),
    [],
    "blocked admission persisted a lease",
  );
}

function assertAdmissionStoppedBeforeTargetAndQueue(calls: AdmissionCalls): void {
  assert.deepEqual(calls, {
    listDevices: 0,
    observeViewport: 0,
    assertTargetControl: 0,
    createIntent: 0,
    enqueueJob: 0,
  });
}

test("missing saved sign-in rejects before discovery, control, queueing, or persistence", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-sign-in-admission-missing-"));
  try {
    await withAdmissionServer(root, async ({ client, calls }) => {
      const key = "admission-missing-member";
      const testId = "missing-sign-in";
      const revision = await savePlainTextTest(client, {
        testId,
        steps: [instructionStep("sign-in", `Sign in with the saved account "${key}"`)],
      });
      const steps = await compiledRootSteps(client, testId);
      assert.equal(steps[0]?.kind, "act");
      assert.deepEqual(steps[0]?.auth, { type: "sign-in", accountKey: key });

      const before = await artifactSnapshot();
      const { body } = await expectConflict(
        runTest(client, testId, revision),
        "SAVED_SIGN_IN_UNAVAILABLE",
      );
      assert.equal(body.signInKey, key);
      assert.equal(body.signInStatus, "missing");
      assertSavedSignInMetadataOnly(body);
      assertAdmissionStoppedBeforeTargetAndQueue(calls);
      await assertNoNewRunArtifacts(before);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("revoked saved sign-in rejects before discovery, control, queueing, or persistence", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-sign-in-admission-revoked-"));
  try {
    await withAdmissionServer(root, async ({ client, calls }) => {
      const key = "admission-revoked-member";
      const testId = "revoked-sign-in";
      await saveSavedSignIn({
        projectId: PROJECT_ID,
        appMapId: APP_MAP_ID,
        key,
        name: "Member",
        username: USER_CANARY,
        password: PASSWORD_CANARY,
        createdBy: "human:designer",
      });
      await revokeSavedSignIn({
        projectId: PROJECT_ID,
        key,
        revokedBy: "human:designer",
      });
      const revision = await savePlainTextTest(client, {
        testId,
        steps: [instructionStep("sign-in", `Sign in with the saved account "${key}"`)],
      });
      const steps = await compiledRootSteps(client, testId);
      assert.deepEqual(steps[0]?.auth, { type: "sign-in", accountKey: key });

      const before = await artifactSnapshot();
      const { body } = await expectConflict(
        runTest(client, testId, revision),
        "SAVED_SIGN_IN_UNAVAILABLE",
      );
      assert.equal(body.signInKey, key);
      assert.equal(body.signInStatus, "revoked");
      assertSavedSignInMetadataOnly(body);
      assertAdmissionStoppedBeforeTargetAndQueue(calls);
      await assertNoNewRunArtifacts(before);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing linked test inbox rejects before discovery, control, queueing, or persistence", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-sign-in-admission-inbox-"));
  try {
    await withAdmissionServer(root, async ({ client, calls }) => {
      const accountKey = "admission-inbox-member";
      const inboxKey = "admission-missing-inbox";
      const testId = "missing-inbox";
      await saveSavedSignIn({
        projectId: PROJECT_ID,
        appMapId: APP_MAP_ID,
        key: accountKey,
        name: "Member",
        inboxKey,
        username: USER_CANARY,
        password: PASSWORD_CANARY,
        createdBy: "human:designer",
      });
      const revision = await savePlainTextTest(client, {
        testId,
        steps: [
          instructionStep("sign-in", `Sign in with the saved account "${accountKey}"`),
          instructionStep("email-code", "Enter the code from the email"),
        ],
      });
      const steps = await compiledRootSteps(client, testId);
      assert.deepEqual(steps[0]?.auth, { type: "sign-in", accountKey });
      assert.equal(steps[1]?.kind, "inbox");
      assert.equal(steps[1]?.action, "type-code");
      assert.equal(steps[1]?.inboxKey, undefined);

      const before = await artifactSnapshot();
      const { body } = await expectConflict(
        runTest(client, testId, revision),
        "TEST_INBOX_UNAVAILABLE",
      );
      assert.equal(body.inboxKey, inboxKey);
      assert.equal(body.inboxStatus, "missing");
      assertTestInboxMetadataOnly(body);
      assertAdmissionStoppedBeforeTargetAndQueue(calls);
      await assertNoNewRunArtifacts(before);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("near-miss sign-in wording has no sign-in authority and reaches post-admission validation", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-sign-in-admission-negative-"));
  try {
    await withAdmissionServer(root, async ({ client, calls, control }) => {
      const testId = "near-miss-sign-in";
      const revision = await savePlainTextTest(client, {
        testId,
        steps: [instructionStep("sign-in", "Sign in with a saved account")],
      });
      const steps = await compiledRootSteps(client, testId);
      assert.equal(steps[0]?.kind, "act");
      assert.equal(steps[0]?.auth, undefined);

      control.failIntentConstruction = true;
      const before = await artifactSnapshot();
      const { body } = await expectConflict(
        runTest(client, testId, revision),
        "TEST_OFFLINE_PREFLIGHT_BLOCKED",
      );
      assert.notEqual(body.code, "SAVED_SIGN_IN_UNAVAILABLE");
      assert.match(
        typeof body.detail === "string" ? body.detail : "",
        /injected post-admission intent failure/u,
      );
      assert.equal(calls.createIntent, 1);
      assert.equal(calls.listDevices, 0);
      assert.equal(calls.observeViewport, 0);
      assert.equal(calls.assertTargetControl, 0);
      assert.equal(calls.enqueueJob, 0);
      await assertNoNewRunArtifacts(before);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
