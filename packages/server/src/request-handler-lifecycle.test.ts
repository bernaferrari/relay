import assert from "node:assert/strict";
import test from "node:test";
import { createRequestHandlerLifecycle } from "./request-handler-lifecycle.js";

test("request lifecycle blocks new handler work and drains detached handlers", async () => {
  let release!: () => void;
  const active = new Promise<void>((resolve) => {
    release = resolve;
  });
  const lifecycle = createRequestHandlerLifecycle();
  assert.equal(
    lifecycle.run(() => active),
    true,
  );
  lifecycle.stopAdmission();

  let admittedAfterStop = false;
  assert.equal(
    lifecycle.run(async () => {
      admittedAfterStop = true;
    }),
    false,
  );
  assert.equal(admittedAfterStop, false);

  let drained = false;
  const draining = lifecycle.drain().then(() => {
    drained = true;
  });
  await Promise.resolve();
  assert.equal(drained, false);
  release();
  await draining;
  assert.equal(drained, true);
});
