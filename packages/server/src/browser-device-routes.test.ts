import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import {
  closeBrowserTarget,
  resetBrowserDeviceSessionsForTests,
  resetControlDatabaseCache,
} from "@relay/core";
import { startServer } from "./index.js";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

test("Browser Device routes bind input to the painted page sequence", async (t) => {
  await access(CHROME).catch(() => t.skip("Google Chrome is not installed"));
  if (t.signal.aborted) return;
  const root = await mkdtemp(join(tmpdir(), "relay-browser-device-route-"));
  const previousState = process.env.RELAY_STATE_DIR;
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_STATE_DIR = root;
  process.env.RELAY_WORKSPACE_ROOT = root;
  resetControlDatabaseCache();
  const product = http.createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end("<!doctype html><title>Browser Device test</title><button>Continue</button>");
  });
  await new Promise<void>((resolve) => product.listen(0, "127.0.0.1", resolve));
  const productAddress = product.address();
  assert(productAddress && typeof productAddress === "object");
  const startUrl = `http://127.0.0.1:${productAddress.port}`;
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  const client = new RelayClient({
    url: `http://127.0.0.1:${server.port}`,
    auth: { type: "none" },
    organizationId: "relay",
    projectId: "browser-device",
    actorId: "human:browser-device-route-test",
    actorKind: "human",
  });
  try {
    const { target } = await client.invoke("target.create", {
      id: "browser-device-route",
      name: "Browser Device route",
      startUrl,
      headless: true,
      environment: { viewport: { width: 800, height: 600 } },
    });
    const opened = await client.invoke("target.browser-device.open", { targetId: target.id });
    assert.equal(opened.session.ownership, "controlled");
    const first = await client.invoke("target.browser-device.frame", { targetId: target.id });
    assert.equal(first.frame.sequence, 1);
    assert.equal(first.frame.sessionId, opened.session.sessionId);
    await client.invoke("target.browser-device.control", {
      targetId: target.id,
      input: {
        sessionId: first.session.sessionId,
        pageId: first.frame.pageId,
        expectedSequence: first.frame.sequence,
        kind: "navigate",
        url: `${startUrl}/next`,
      },
    });
    await assert.rejects(
      client.invoke("target.browser-device.control", {
        targetId: target.id,
        input: {
          sessionId: first.session.sessionId,
          pageId: first.frame.pageId,
          expectedSequence: first.frame.sequence,
          kind: "click",
          x: 10,
          y: 10,
        },
      }),
      (error) => error instanceof ApiError && error.status === 409,
    );
    const second = await client.invoke("target.browser-device.frame", {
      targetId: target.id,
      afterSequence: first.frame.sequence,
    });
    assert.equal(second.frame.sequence, 2);
    assert.match(second.frame.pageUrl, /\/next$/u);
    await client.invoke("target.delete", { targetId: target.id });
    await assert.rejects(
      client.invoke("target.browser-device.frame", { targetId: target.id }),
      (error) => error instanceof ApiError && error.status === 404,
    );
    await assert.rejects(
      client.invoke("target.browser-device.control", {
        targetId: target.id,
        input: {
          sessionId: second.session.sessionId,
          pageId: second.frame.pageId,
          expectedSequence: second.frame.sequence,
          kind: "click",
          x: 10,
          y: 10,
        },
      }),
      (error) => error instanceof ApiError && error.status === 404,
    );
  } finally {
    await closeBrowserTarget(undefined, { mode: "authoring" });
    resetBrowserDeviceSessionsForTests();
    await server.close();
    await new Promise<void>((resolve, reject) =>
      product.close((error) => (error ? reject(error) : resolve())),
    );
    resetControlDatabaseCache();
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    await rm(root, { recursive: true, force: true });
  }
});
