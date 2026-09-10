import { controlledMutation } from "./device-dispatch.js";
import { InputNotDispatchedError } from "./input-not-dispatched.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  BrowserMutationOutcomeUnknownError,
  BrowserSupervisionRequiredError,
  runSupervisedBrowserMutation,
} from "./browser-mutation-supervision.js";
import { runWithTargetSupervisorStore, TargetSupervisorStore } from "./target-supervisor-store.js";

test("browser mutation supervision persists completed and not-dispatched outcomes", async () => {
  const store = new TargetSupervisorStore(":memory:");
  try {
    const completed = await runWithTargetSupervisorStore(store, () =>
      runSupervisedBrowserMutation({
        targetId: "browser-a",
        intent: "Click Save",
        dispatch: async () => "done",
      }),
    );
    assert.equal(completed, "done");
    assert.equal(store.health({ id: "browser-a", kind: "browser" }).input.state, "ready");
    assert.ok(
      store
        .health({ id: "browser-a", kind: "browser" })
        .events.some(({ code }) => code === "INPUT_COMPLETED"),
    );

    let dispatched = 0;
    await assert.rejects(
      runWithTargetSupervisorStore(store, () =>
        runSupervisedBrowserMutation({
          targetId: "browser-a",
          intent: "Navigate",
          beforeDispatch: () => {
            throw new Error("lease expired");
          },
          dispatch: async () => {
            dispatched += 1;
          },
        }),
      ),
      (error: unknown) =>
        error instanceof InputNotDispatchedError && /lease expired/u.test(error.message),
    );
    assert.equal(dispatched, 0);
    assert.equal(store.health({ id: "browser-a", kind: "browser" }).input.state, "ready");
    assert.ok(
      store
        .health({ id: "browser-a", kind: "browser" })
        .events.some(({ code }) => code === "INPUT_NOT_DISPATCHED"),
    );
  } finally {
    store.close();
  }
});

test("a browser dispatch failure survives restart as outcome-unknown and blocks retry", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-browser-supervision-"));
  const path = join(root, "supervisors.sqlite");
  const first = new TargetSupervisorStore(path);
  try {
    await assert.rejects(
      runWithTargetSupervisorStore(first, () =>
        runSupervisedBrowserMutation({
          targetId: "browser-a",
          intent: "Click Save",
          dispatch: async () => {
            throw new Error("connection closed after dispatch");
          },
        }),
      ),
      BrowserMutationOutcomeUnknownError,
    );
    assert.equal(first.health({ id: "browser-a", kind: "browser" }).input.state, "uncertain");
  } finally {
    first.close();
  }

  const restarted = new TargetSupervisorStore(path);
  let dispatched = 0;
  try {
    assert.equal(restarted.health({ id: "browser-a", kind: "browser" }).input.state, "uncertain");
    await assert.rejects(
      runWithTargetSupervisorStore(restarted, () =>
        runSupervisedBrowserMutation({
          targetId: "browser-a",
          intent: "Click Save again",
          dispatch: async () => {
            dispatched += 1;
          },
        }),
      ),
      (error) =>
        error instanceof BrowserMutationOutcomeUnknownError &&
        error.mutationId.startsWith("browser-input-"),
    );
    assert.equal(dispatched, 0);
  } finally {
    restarted.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("browser mutation supervision is required by default", async () => {
  await assert.rejects(
    runSupervisedBrowserMutation({
      targetId: "browser-a",
      intent: "Click Save",
      dispatch: async () => undefined,
    }),
    BrowserSupervisionRequiredError,
  );
});

test("browser selector rejection remains not-dispatched through device control", async () => {
  const store = new TargetSupervisorStore(":memory:");
  let clicks = 0;
  try {
    await assert.rejects(
      runWithTargetSupervisorStore(store, () =>
        controlledMutation("press", () =>
          runSupervisedBrowserMutation({
            targetId: "ambiguous-browser",
            intent: "New chat",
            beforeDispatch: () => {
              throw new Error("Browser locator was ambiguous for label");
            },
            dispatch: async () => {
              clicks++;
            },
          }),
        ),
      ),
      InputNotDispatchedError,
    );
    assert.equal(clicks, 0);
  } finally {
    store.close();
  }
});
