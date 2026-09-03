import assert from "node:assert/strict";
import test from "node:test";
import { renderToString } from "solid-js/web";
import { createServer } from "vite";
import solid from "vite-plugin-solid";
import { createGuardedRetry } from "../lib/offline-retry";

type OfflineGateSurface = (props: {
  offline: boolean;
  serverUrl: string;
  retryControl: string;
  children: string;
}) => unknown;

function renderGate(Surface: OfflineGateSurface, offline: boolean, busy = false): string {
  return renderToString(
    () =>
      Surface({
        offline,
        serverUrl: "http://127.0.0.1:8787",
        retryControl: busy ? "Checking…" : "Check now",
        children: "workspace identity",
      }) as never,
  );
}

test("renders checking, offline, busy retry, and recovered states without remounting content", async () => {
  const vite = await createServer({
    configFile: false,
    plugins: [solid({ ssr: true, hot: false })],
    server: { middlewareMode: true, ws: { port: 24681 } },
    appType: "custom",
  });
  try {
    const module = await vite.ssrLoadModule("/src/components/offline-gate-surface.tsx");
    const Surface = module.OfflineGateSurface as OfflineGateSurface;
    const checking = renderGate(Surface, false);
    const offline = renderGate(Surface, true);
    const retrying = renderGate(Surface, true, true);
    const recovered = renderGate(Surface, false);

    assert.equal(checking.match(/role="alertdialog"/g)?.length ?? 0, 0);
    assert.doesNotMatch(checking, / inert(?:>|\s)/);
    assert.equal(offline.match(/role="alertdialog"/g)?.length, 1);
    assert.match(offline, /inert/);
    assert.match(offline, /aria-hidden="true"/);
    assert.match(offline, /Relay reconnects automatically when the service starts\./);
    assert.doesNotMatch(offline, /animate-pulse/);
    assert.match(offline, /Check now/);
    assert.match(retrying, /Checking…/);
    assert.equal(recovered.match(/role="alertdialog"/g)?.length ?? 0, 0);
    assert.match(recovered, /workspace identity/);
  } finally {
    await vite.close();
  }
});

test("retry is guarded while pending and can run again after recovery", async () => {
  let calls = 0;
  let release!: () => void;
  const busy: boolean[] = [];
  const retry = createGuardedRetry(
    () => {
      calls += 1;
      return calls === 1 ? new Promise<void>((resolve) => (release = resolve)) : Promise.resolve();
    },
    (value) => busy.push(value),
  );
  const first = retry();
  const second = retry();
  assert.equal(first, second);
  assert.equal(calls, 1);
  assert.deepEqual(busy, [true]);
  release();
  await first;
  await retry();
  assert.equal(calls, 2);
  assert.deepEqual(busy, [true, false, true, false]);
});
