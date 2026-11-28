import assert from "node:assert/strict";
import test from "node:test";
import { compileBrowserEnvironment } from "@relay/protocol";
import { createSessionJob } from "./session-job-factory.js";
import { scheduledSessionJob } from "./session-batch-admission.js";
import { jobSchedulingTargetId } from "../browser/browser-account-lane.js";
import { executionTargetRefForJob } from "../target/target-driver.js";
import { TargetWorkerScheduler } from "../target/target-worker.js";
import type { EnqueueJobInput, TestJob } from "./session-contract.js";

function deferred() {
  let resolve!: () => void;
  return {
    promise: new Promise<void>((done) => {
      resolve = done;
    }),
    resolve,
  };
}

function makeJob(input: EnqueueJobInput): TestJob {
  return createSessionJob(input, {
    findJob: () => undefined,
    toTransport: (job) => job,
  });
}

function browserInput(input: Partial<EnqueueJobInput> = {}): EnqueueJobInput {
  return {
    recipe: "recipe:web-proof",
    targetKind: "browser",
    browserTargetId: "shop-web",
    browserCaseProfile: compileBrowserEnvironment({ engine: "chromium" }),
    ...input,
  };
}

function schedulingTargetId(job: TestJob): string {
  return jobSchedulingTargetId({
    executionTarget: executionTargetRefForJob(job),
    browserCaseProfile: job.browserCaseProfile,
    unsignedLaneId: job.unsignedLaneId,
  });
}

test("independent classified unsigned browser jobs receive per-run lanes and fan out", async () => {
  const jobs = ["a", "b", "c"].map((name) =>
    makeJob(browserInput({ title: name, browserIsolation: "independent" })),
  );
  // Every run owns a distinct per-run unsigned lane identity, so neither the
  // scheduler lane nor the Playwright session key can collide.
  assert.equal(new Set(jobs.map((job) => job.unsignedLaneId)).size, 3);
  for (const job of jobs) {
    assert.match(job.unsignedLaneId!, /^unsigned-run:/u);
    assert.equal(job.browserIsolation, "independent");
    assert.equal(job.laneId, undefined, "a synthetic lane is not user-invoked provenance");
    assert.notEqual(schedulingTargetId(job), "shop-web#signed-out");
  }

  const scheduler = new TargetWorkerScheduler();
  const gates = jobs.map(() => deferred());
  const started: string[] = [];
  const finished: string[] = [];
  const startedAt = new Map<string, number>();
  const endedAt = new Map<string, number>();
  for (const [index, job] of jobs.entries()) {
    scheduler.enqueue(
      scheduledSessionJob({
        job,
        run: async () => {
          started.push(job.id);
          startedAt.set(job.id, performance.now());
          await gates[index]!.promise;
          endedAt.set(job.id, performance.now());
          finished.push(job.id);
        },
      }),
    );
  }
  await new Promise((resolve) => setImmediate(resolve));
  // All three overlap in execution: every run started before any finished.
  assert.deepEqual(started.length, 3);
  assert.deepEqual(finished, []);
  for (const gate of gates) gate.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished.length, 3);
  for (const job of jobs) {
    assert.ok(startedAt.get(job.id)! < [...endedAt.values()].reduce((a, b) => Math.max(a, b)));
  }
});

test("unclassified unsigned browser jobs keep the legacy shared lane and serialize", async () => {
  const jobs = ["a", "b"].map((name) => makeJob(browserInput({ title: name })));
  for (const job of jobs) {
    assert.equal(job.unsignedLaneId, undefined);
    assert.equal(job.browserIsolation, undefined);
    assert.equal(schedulingTargetId(job), "shop-web#signed-out");
  }
  const scheduler = new TargetWorkerScheduler();
  const gates = [deferred(), deferred()];
  const started: string[] = [];
  for (const [index, job] of jobs.entries()) {
    scheduler.enqueue(
      scheduledSessionJob({
        job,
        run: async () => {
          started.push(job.id);
          await gates[index]!.promise;
        },
      }),
    );
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started.length, 1, "the shared unsigned lane is still one-at-a-time");
  gates[0]!.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started.length, 2);
  gates[1]!.resolve();
});

test("batched cells never receive per-run isolation even when classified", () => {
  const job = makeJob(
    browserInput({ browserIsolation: "independent", batchId: "batch-1", caseIndex: 0 }),
  );
  assert.equal(job.unsignedLaneId, undefined);
  assert.equal(job.browserIsolation, undefined);
  assert.equal(schedulingTargetId(job), "shop-web#signed-out");
});

test("fixture accounts keep their account lane instead of per-run isolation", () => {
  const job = makeJob(
    browserInput({
      browserIsolation: "independent",
      browserCaseProfile: compileBrowserEnvironment({
        engine: "chromium",
        authenticationFixtureId: "authfx:member:1",
      }),
    }),
  );
  assert.equal(job.unsignedLaneId, undefined);
  assert.equal(job.browserIsolation, undefined);
  assert.equal(schedulingTargetId(job), "shop-web#authfx:member:1");
});

test("two independent jobs sharing one account fixture still serialize", async () => {
  const fixtureProfile = compileBrowserEnvironment({
    engine: "chromium",
    authenticationFixtureId: "authfx:member:1",
  });
  const jobs = ["a", "b"].map((name) =>
    makeJob(browserInput({ title: name, browserCaseProfile: fixtureProfile })),
  );
  const scheduler = new TargetWorkerScheduler();
  const gates = [deferred(), deferred()];
  const started: string[] = [];
  for (const [index, job] of jobs.entries()) {
    scheduler.enqueue(
      scheduledSessionJob({
        job,
        run: async () => {
          started.push(job.id);
          await gates[index]!.promise;
        },
      }),
    );
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started.length, 1, "one server-side account remains one-at-a-time");
  gates[0]!.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started.length, 2);
  gates[1]!.resolve();
});

test("invoked lanes keep their lane identity instead of per-run isolation", () => {
  const job = makeJob(browserInput({ browserIsolation: "independent", laneId: "nightly-a" }));
  assert.equal(job.unsignedLaneId, "nightly-a");
  assert.equal(job.browserIsolation, undefined);
  assert.equal(schedulingTargetId(job), "shop-web#signed-out:nightly-a");
});

test("independent lanes respect the browser host ceiling", async () => {
  const scheduler = new TargetWorkerScheduler();
  const count = 10;
  const jobs = Array.from({ length: count }, (_, index) =>
    makeJob(browserInput({ title: `job-${index}`, browserIsolation: "independent" })),
  );
  const gates = jobs.map(() => deferred());
  let active = 0;
  let maxActive = 0;
  for (const [index, job] of jobs.entries()) {
    scheduler.enqueue(
      scheduledSessionJob({
        job,
        run: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await gates[index]!.promise;
          active -= 1;
        },
      }),
    );
  }
  await new Promise((resolve) => setImmediate(resolve));
  // The default browser host ceiling admits 8 isolated runs at once; the rest
  // queue behind the ceiling rather than behind one another.
  assert.equal(maxActive, 8);
  for (const gate of gates.slice(0, 8)) gate.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(maxActive <= 8);
  for (const gate of gates) gate.resolve();
});

test("a retry of an independent run earns a fresh per-run lane, not the parent's", () => {
  const parent = makeJob(browserInput({ browserIsolation: "independent" }));
  assert.match(parent.unsignedLaneId!, /^unsigned-run:/u);
  const retry = createSessionJob(
    browserInput({ browserIsolation: "independent", retryOf: parent.id }),
    { findJob: () => parent, toTransport: (job) => job },
  );
  assert.equal(retry.browserIsolation, "independent");
  assert.match(retry.unsignedLaneId!, /^unsigned-run:/u);
  assert.notEqual(retry.unsignedLaneId, parent.unsignedLaneId);
});

test("a retry of a Lane-bound run keeps the user-invoked lane", () => {
  const parent = makeJob(browserInput({ laneId: "nightly-a" }));
  const retry = createSessionJob(browserInput({ retryOf: parent.id }), {
    findJob: () => parent,
    toTransport: (job) => job,
  });
  assert.equal(retry.unsignedLaneId, "nightly-a");
  assert.equal(retry.browserIsolation, undefined);
});

function signInGraph(...accountKeys: string[]) {
  return {
    root: {
      id: "root",
      title: "root",
      source: "custom" as const,
      createdAt: 1,
      updatedAt: 1,
      steps: accountKeys.map((accountKey) => ({
        kind: "act" as const,
        intent: `Sign in with the saved account "${accountKey}"`,
        auth: { type: "sign-in" as const, accountKey },
      })),
    },
  };
}

function accountBrowserInput(
  accountKey: string,
  input: Partial<EnqueueJobInput> = {},
): EnqueueJobInput {
  const recipeGraph = signInGraph(accountKey);
  return browserInput({
    projectId: "project",
    recipeGraph,
    browserAccountOverlap: { accountKeys: [accountKey], sharing: "safe-shared-read" },
    ...input,
  });
}

test("runtime sign-in accounts receive stable account lanes plus fresh session lanes", () => {
  const admin = makeJob(accountBrowserInput("admin"));
  const member = makeJob(accountBrowserInput("member"));
  assert.deepEqual(admin.browserAccountOverlap, {
    accountKeys: ["admin"],
    sharing: "safe-shared-read",
  });
  assert.match(admin.unsignedLaneId!, /^unsigned-run:/u);
  assert.equal(admin.browserIsolation, undefined, "signed-in work is not an unsigned reader");

  const adminTarget = scheduledSessionJob({ job: admin, run: async () => {} }).targetId;
  const memberTarget = scheduledSessionJob({ job: member, run: async () => {} }).targetId;
  assert.match(adminTarget, /^shop-web#signed-out:account:/u);
  assert.notEqual(adminTarget, memberTarget);
  assert.notEqual(
    adminTarget,
    schedulingTargetId(admin),
    "account serialization is broader than the one-shot session key",
  );
});

test("different sign-in accounts fan out while one account stays serialized in the scheduler", async () => {
  const firstAdmin = makeJob(
    accountBrowserInput("admin", { title: "first admin", hostWorkerCapacity: 2 }),
  );
  const member = makeJob(accountBrowserInput("member", { title: "member", hostWorkerCapacity: 2 }));
  const secondAdmin = makeJob(
    accountBrowserInput("admin", { title: "second admin", hostWorkerCapacity: 2 }),
  );
  const jobs = [firstAdmin, member, secondAdmin];
  assert.equal(
    scheduledSessionJob({ job: firstAdmin, run: async () => {} }).targetId,
    scheduledSessionJob({ job: secondAdmin, run: async () => {} }).targetId,
  );

  const scheduler = new TargetWorkerScheduler();
  const gates = jobs.map(() => deferred());
  const started: string[] = [];
  for (const [index, job] of jobs.entries()) {
    scheduler.enqueue(
      scheduledSessionJob({
        job,
        run: async () => {
          started.push(job.title);
          await gates[index]!.promise;
        },
      }),
    );
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started.sort(), ["first admin", "member"]);
  gates[0]!.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started.includes("second admin"), true);
  gates[1]!.resolve();
  gates[2]!.resolve();
});

test("unknown or mismatched sign-in identity keeps the legacy exclusive lane", () => {
  const graphOnly = makeJob(
    browserInput({
      projectId: "project",
      browserIsolation: "independent",
      recipeGraph: signInGraph("member"),
    }),
  );
  assert.equal(graphOnly.unsignedLaneId, undefined);
  assert.equal(graphOnly.browserIsolation, undefined);
  assert.equal(schedulingTargetId(graphOnly), "shop-web#signed-out");

  const mismatched = makeJob(
    browserInput({
      projectId: "project",
      recipeGraph: signInGraph("member"),
      browserAccountOverlap: { accountKeys: ["admin"], sharing: "safe-shared-read" },
    }),
  );
  assert.equal(mismatched.browserAccountOverlap, undefined);
  assert.equal(mismatched.unsignedLaneId, undefined);
  assert.equal(schedulingTargetId(mismatched), "shop-web#signed-out");
});

test("batched and Lane-bound sign-in work never earns account overlap", () => {
  for (const input of [
    accountBrowserInput("member", { batchId: "batch-1" }),
    accountBrowserInput("member", { laneId: "nightly-a" }),
  ]) {
    const job = makeJob(input);
    assert.equal(job.browserAccountOverlap, undefined);
    assert.equal(job.unsignedLaneId, input.laneId ? "nightly-a" : undefined);
  }
});

test("a retry of an account-overlap run earns a fresh session lane and keeps its account", () => {
  const parent = makeJob(accountBrowserInput("member"));
  const retry = createSessionJob(browserInput({ retryOf: parent.id }), {
    findJob: () => parent,
    toTransport: (job) => job,
  });
  assert.deepEqual(retry.browserAccountOverlap, parent.browserAccountOverlap);
  assert.match(retry.unsignedLaneId!, /^unsigned-run:/u);
  assert.notEqual(retry.unsignedLaneId, parent.unsignedLaneId);
  assert.equal(
    scheduledSessionJob({ job: retry, run: async () => {} }).targetId,
    scheduledSessionJob({ job: parent, run: async () => {} }).targetId,
    "the retry still belongs to the same server-side account lane",
  );
});
