import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { closeBrowserTarget } from "./browser-target.js";
import {
  captureBrowserDeviceFrame,
  controlBrowserDevice,
  openBrowserDeviceSession,
  resetBrowserDeviceSessionsForTests,
} from "./browser-device-session.js";
import { runWithTargetSupervisorStore, TargetSupervisorStore } from "./target-supervisor-store.js";
import { deleteTarget, saveBrowserTarget } from "./targets.js";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

test(
  "local Browser Device input-to-visible-frame p95 stays below 250ms",
  { skip: process.env.RELAY_BROWSER_STREAM_PERF !== "1" },
  async (context) => {
    await access(CHROME).catch(() => context.skip("Google Chrome is not installed"));
    if (context.signal.aborted) return;
    const root = await mkdtemp(join(tmpdir(), "relay-browser-stream-perf-"));
    process.env.RELAY_WORKSPACE_ROOT = root;
    const server = http.createServer((_request, response) => {
      response.setHeader("content-type", "text/html");
      response.end(
        "<!doctype html><button style='width:200px;height:100px' onclick=\"document.body.classList.toggle('changed')\">Toggle</button><style>.changed{background:#123456}</style>",
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert(address && typeof address === "object");
    const supervisor = new TargetSupervisorStore(":memory:");
    let targetId: string | undefined;
    try {
      await runWithTargetSupervisorStore(supervisor, async () => {
        const target = await saveBrowserTarget({
          name: "Browser stream benchmark",
          startUrl: `http://127.0.0.1:${address.port}`,
          executablePath: CHROME,
          headless: true,
          environment: { viewport: { width: 800, height: 600 } },
        });
        targetId = target.id;
        const session = await openBrowserDeviceSession(target.id);
        let observed = (await captureBrowserDeviceFrame(target.id)).frame;
        const samples: number[] = [];
        for (let index = 0; index < 20; index += 1) {
          const startedAt = performance.now();
          await controlBrowserDevice(target.id, {
            sessionId: session.sessionId,
            pageId: observed.pageId,
            expectedSequence: observed.sequence,
            kind: "click",
            x: 50,
            y: 50,
          });
          observed = (await captureBrowserDeviceFrame(target.id)).frame;
          samples.push(performance.now() - startedAt);
        }
        samples.sort((left, right) => left - right);
        const p95 = samples[Math.ceil(samples.length * 0.95) - 1]!;
        context.diagnostic(`Browser Device local input-to-visible-frame p95: ${p95.toFixed(1)}ms`);
        assert.ok(p95 < 250, `expected local p95 below 250ms, observed ${p95.toFixed(1)}ms`);
      });
    } finally {
      resetBrowserDeviceSessionsForTests();
      if (targetId) {
        await closeBrowserTarget(targetId, { mode: "authoring" }).catch(() => undefined);
        await deleteTarget(targetId).catch(() => undefined);
      }
      supervisor.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      delete process.env.RELAY_WORKSPACE_ROOT;
      await rm(root, { recursive: true, force: true });
    }
  },
);
