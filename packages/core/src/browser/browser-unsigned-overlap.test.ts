import assert from "node:assert/strict";
import test from "node:test";
import { ensureControl, requestCancel, clearControl } from "../execution/control.js";
import {
  acquireUnsignedBrowserOverlap,
  resetUnsignedBrowserOverlapForTests,
  unsignedBrowserOverlapAdmissionForJob,
  unsignedBrowserOverlapSnapshot,
} from "./browser-unsigned-overlap.js";

test("shared holders overlap while an exclusive holder waits for them to drain", async () => {
  resetUnsignedBrowserOverlapForTests();
  const first = await acquireUnsignedBrowserOverlap({ targetId: "web-a", mode: "shared" });
  const second = await acquireUnsignedBrowserOverlap({ targetId: "web-a", mode: "shared" });
  assert.deepEqual(unsignedBrowserOverlapSnapshot("web-a"), {
    readers: 2,
    writerActive: false,
    queued: 0,
    queuedExclusive: 0,
  });

  let writerGranted = false;
  const writer = acquireUnsignedBrowserOverlap({ targetId: "web-a", mode: "exclusive" }).then(
    (release) => {
      writerGranted = true;
      return release;
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writerGranted, false);
  assert.equal(unsignedBrowserOverlapSnapshot("web-a").queuedExclusive, 1);

  first();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writerGranted, false, "one remaining reader still holds the writer");
  second();
  const releaseWriter = await writer;
  assert.equal(writerGranted, true);
  assert.equal(unsignedBrowserOverlapSnapshot("web-a").writerActive, true);
  releaseWriter();
  assert.deepEqual(unsignedBrowserOverlapSnapshot("web-a"), {
    readers: 0,
    writerActive: false,
    queued: 0,
    queuedExclusive: 0,
  });
});

test("an exclusive holder blocks later shared readers in FIFO order", async () => {
  resetUnsignedBrowserOverlapForTests();
  const releaseWriter = await acquireUnsignedBrowserOverlap({
    targetId: "web-b",
    mode: "exclusive",
  });
  let readerGranted = false;
  const reader = acquireUnsignedBrowserOverlap({ targetId: "web-b", mode: "shared" }).then(
    (release) => {
      readerGranted = true;
      return release;
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(readerGranted, false);
  releaseWriter();
  const releaseReader = await reader;
  assert.equal(readerGranted, true);
  releaseReader();
});

test("a queued exclusive writer turns later readers back even when earlier readers hold", async () => {
  resetUnsignedBrowserOverlapForTests();
  const firstReader = await acquireUnsignedBrowserOverlap({ targetId: "web-c", mode: "shared" });
  const writer = acquireUnsignedBrowserOverlap({ targetId: "web-c", mode: "exclusive" });
  void writer.catch(() => undefined);
  let lateReaderGranted = false;
  const lateReader = acquireUnsignedBrowserOverlap({ targetId: "web-c", mode: "shared" }).then(
    (release) => {
      lateReaderGranted = true;
      return release;
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  // FIFO fairness: the late reader queues behind the writer instead of
  // starving it behind an endless stream of independent runs.
  assert.equal(lateReaderGranted, false);
  firstReader();
  const releaseWriter = await writer;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lateReaderGranted, false);
  releaseWriter();
  const releaseLateReader = await lateReader;
  releaseLateReader();
});

test("cancelling a queued waiter removes it without consuming a grant", async () => {
  resetUnsignedBrowserOverlapForTests();
  const jobId = "job-cancelled-waiter";
  ensureControl(jobId);
  const blocker = await acquireUnsignedBrowserOverlap({ targetId: "web-d", mode: "exclusive" });
  const waiting = acquireUnsignedBrowserOverlap({ targetId: "web-d", mode: "shared", jobId });
  const assertion = assert.rejects(waiting, /cancelled/iu);
  await new Promise((resolve) => setImmediate(resolve));
  requestCancel(jobId);
  await assertion;
  assert.deepEqual(unsignedBrowserOverlapSnapshot("web-d"), {
    readers: 0,
    writerActive: true,
    queued: 0,
    queuedExclusive: 0,
  });
  blocker();
  clearControl(jobId);
});

test("a grant that races cancellation is released instead of leaking a reader", async () => {
  resetUnsignedBrowserOverlapForTests();
  const jobId = "job-racing-grant";
  ensureControl(jobId);
  // Already cancelled before acquiring: the grant is immediately available,
  // so the acquire race must still release it when the cancellation wins.
  requestCancel(jobId);
  await assert.rejects(
    acquireUnsignedBrowserOverlap({ targetId: "web-e", mode: "shared", jobId }),
    /cancelled/iu,
  );
  assert.deepEqual(unsignedBrowserOverlapSnapshot("web-e"), {
    readers: 0,
    writerActive: false,
    queued: 0,
    queuedExclusive: 0,
  });
  clearControl(jobId);
});

test("independent classified jobs are readers; unclassified bare jobs are writers", () => {
  assert.deepEqual(
    unsignedBrowserOverlapAdmissionForJob({
      targetKind: "browser",
      browserTargetId: "web-f",
      browserIsolation: "independent",
    }),
    { targetId: "web-f", mode: "shared" },
  );
  assert.deepEqual(
    unsignedBrowserOverlapAdmissionForJob({
      targetKind: "browser",
      browserTargetId: "web-f",
    }),
    { targetId: "web-f", mode: "exclusive" },
  );
  assert.equal(
    unsignedBrowserOverlapAdmissionForJob({
      targetKind: "browser",
      browserTargetId: "web-f",
      browserCaseProfile: { authenticationFixtureId: "authfx:a:1" },
    }),
    undefined,
    "fixture accounts keep their own account lane outside the unsigned gate",
  );
  assert.equal(
    unsignedBrowserOverlapAdmissionForJob({
      targetKind: "browser",
      browserTargetId: "web-f",
      laneId: "nightly-a",
    }),
    undefined,
    "invoked lanes keep their explicit serialization outside the unsigned gate",
  );
  assert.equal(
    unsignedBrowserOverlapAdmissionForJob({
      targetKind: "device",
      browserTargetId: undefined,
    }),
    undefined,
  );
});

test("overlap admission is scoped per target", async () => {
  resetUnsignedBrowserOverlapForTests();
  const writer = await acquireUnsignedBrowserOverlap({ targetId: "web-g", mode: "exclusive" });
  const otherTargetReader = await acquireUnsignedBrowserOverlap({
    targetId: "web-h",
    mode: "shared",
  });
  writer();
  otherTargetReader();
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

function accountJob(input: {
  targetId?: string;
  accountKeys?: string[];
  sharing?: "safe-shared-read" | "isolated-account" | "isolated-lane";
  projectId?: string;
  batchId?: string;
}) {
  const accountKeys = input.accountKeys ?? ["member"];
  return {
    targetKind: "browser",
    browserTargetId: input.targetId ?? "web-accounts",
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    browserAccountOverlap: {
      accountKeys,
      sharing: input.sharing ?? "safe-shared-read",
    },
    recipeGraph: signInGraph(...accountKeys),
    ...(input.batchId ? { batchId: input.batchId } : {}),
  } as const;
}

test("different runtime sign-in accounts overlap while the same account serializes", async () => {
  resetUnsignedBrowserOverlapForTests();
  const first = await acquireUnsignedBrowserOverlap({
    targetId: "web-account-gate",
    mode: "account",
    accountKeys: ['["project","admin"]'],
    accountSharing: "safe-shared-read",
  });
  const different = await acquireUnsignedBrowserOverlap({
    targetId: "web-account-gate",
    mode: "account",
    accountKeys: ['["project","member"]'],
    accountSharing: "safe-shared-read",
  });
  assert.equal(unsignedBrowserOverlapSnapshot("web-account-gate").readers, 2);

  let sameGranted = false;
  const same = acquireUnsignedBrowserOverlap({
    targetId: "web-account-gate",
    mode: "account",
    accountKeys: ['["project","admin"]'],
    accountSharing: "safe-shared-read",
  }).then((release) => {
    sameGranted = true;
    return release;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sameGranted, false);
  first();
  const releaseSame = await same;
  assert.equal(sameGranted, true);
  releaseSame();
  different();
});

test("multi-account runs serialize when their account sets intersect", async () => {
  resetUnsignedBrowserOverlapForTests();
  const first = await acquireUnsignedBrowserOverlap({
    targetId: "web-multi-account",
    mode: "account",
    accountKeys: ['["project","admin"]', '["project","member"]'],
    accountSharing: "isolated-account",
  });
  let overlappingGranted = false;
  const overlapping = acquireUnsignedBrowserOverlap({
    targetId: "web-multi-account",
    mode: "account",
    accountKeys: ['["project","member"]', '["project","viewer"]'],
    accountSharing: "isolated-account",
  }).then((release) => {
    overlappingGranted = true;
    return release;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(overlappingGranted, false);
  first();
  (await overlapping)();
});

test("safe account lanes overlap unsigned readers but isolated account lanes do not", async () => {
  resetUnsignedBrowserOverlapForTests();
  const unsigned = await acquireUnsignedBrowserOverlap({
    targetId: "web-unsigned-interaction",
    mode: "shared",
  });
  const safeAccount = await acquireUnsignedBrowserOverlap({
    targetId: "web-unsigned-interaction",
    mode: "account",
    accountKeys: ['["project","member"]'],
    accountSharing: "safe-shared-read",
  });
  assert.equal(unsignedBrowserOverlapSnapshot("web-unsigned-interaction").readers, 2);

  let isolatedGranted = false;
  const isolated = acquireUnsignedBrowserOverlap({
    targetId: "web-unsigned-interaction",
    mode: "account",
    accountKeys: ['["project","admin"]'],
    accountSharing: "isolated-account",
  }).then((release) => {
    isolatedGranted = true;
    return release;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(isolatedGranted, false, "unsigned is not proof of a distinct account");
  unsigned();
  safeAccount();
  (await isolated)();
});

test("account lanes preserve FIFO fairness with exclusive work and unsigned readers", async () => {
  resetUnsignedBrowserOverlapForTests();
  const account = await acquireUnsignedBrowserOverlap({
    targetId: "web-fair-accounts",
    mode: "account",
    accountKeys: ['["project","member"]'],
    accountSharing: "safe-shared-read",
  });
  const writer = acquireUnsignedBrowserOverlap({
    targetId: "web-fair-accounts",
    mode: "exclusive",
  });
  void writer.catch(() => undefined);
  let readerGranted = false;
  const reader = acquireUnsignedBrowserOverlap({
    targetId: "web-fair-accounts",
    mode: "shared",
  }).then((release) => {
    readerGranted = true;
    return release;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(readerGranted, false, "reader must not bypass the earlier writer");
  account();
  const releaseWriter = await writer;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(readerGranted, false);
  releaseWriter();
  (await reader)();
});

test("validated sign-in jobs derive account admission; unknown identity stays exclusive", () => {
  const admission = unsignedBrowserOverlapAdmissionForJob(accountJob({ projectId: "project" }));
  assert.equal(admission?.mode, "account");
  assert.deepEqual(admission?.accountKeys, ['["project","member"]']);
  assert.equal(admission?.accountSharing, "safe-shared-read");

  assert.equal(
    unsignedBrowserOverlapAdmissionForJob(accountJob({}))?.mode,
    "exclusive",
    "a missing project scope cannot prove the account identity",
  );
  assert.equal(
    unsignedBrowserOverlapAdmissionForJob({
      ...accountJob({ projectId: "project" }),
      browserAccountOverlap: { accountKeys: ["other"], sharing: "safe-shared-read" },
    })?.mode,
    "exclusive",
    "admission must match the frozen graph exactly",
  );
  assert.equal(
    unsignedBrowserOverlapAdmissionForJob(accountJob({ projectId: "project", batchId: "batch" }))
      ?.mode,
    "exclusive",
  );
  assert.equal(
    unsignedBrowserOverlapAdmissionForJob({
      targetKind: "browser",
      browserTargetId: "web-f",
      browserIsolation: "independent",
      recipeGraph: signInGraph("member"),
    })?.mode,
    "exclusive",
    "a signed-in graph can never pose as an unsigned independent reader",
  );
});
