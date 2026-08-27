import assert from "node:assert/strict";
import test from "node:test";
import { createSingleFlightAction } from "./single-flight-action";

test("a second activation is dropped while the deliberate action is in flight", async () => {
  let calls = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => (release = resolve));
  const busy: boolean[] = [];
  const action = createSingleFlightAction({
    action: async () => {
      calls += 1;
      await pending;
    },
    onBusyChange: (value) => busy.push(value),
  });

  const first = action();
  const second = action();
  assert.equal(calls, 1);
  assert.equal(await second, undefined);
  release();
  await first;
  assert.deepEqual(busy, [true, false]);
});
