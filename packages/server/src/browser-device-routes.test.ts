import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import {
  browserMutationAdmissionStats,
  closeBrowserTarget,
  MAX_BROWSER_DEVICE_INPUT_QUEUE,
  resetBrowserDeviceSessionsForTests,
  resetBrowserMutationAdmissionsForTests,
  resetControlDatabaseCache,
} from "@relay/core";
import { startServer } from "./index.js";

const CHROME =
  process.env.RELAY_TEST_CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SATURATED_SUITE_CLIENT_TIMEOUT_MS = 45_000;

test(
  "Browser Device routes bind input to the painted page sequence",
  { timeout: 90_000 },
  async (t) => {
    try {
      await access(CHROME);
    } catch {
      t.skip("Google Chrome is not installed");
      return;
    }
    if (t.signal.aborted) return;
    const root = await mkdtemp(join(tmpdir(), "relay-browser-device-route-"));
    const previousState = process.env.RELAY_STATE_DIR;
    const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
    process.env.RELAY_STATE_DIR = root;
    process.env.RELAY_WORKSPACE_ROOT = root;
    resetControlDatabaseCache();
    let releaseSlowNavigation: (() => void) | undefined;
    const slowNavigation = new Promise<void>((resolve) => {
      releaseSlowNavigation = resolve;
    });
    const product = http.createServer(async (request, response) => {
      if (request.url === "/slow") await slowNavigation;
      response.setHeader("content-type", "text/html");
      response.end(
        request.url === "/mutating"
          ? "<!doctype html><title>Browser Device test</title><button>Continue</button><script>setTimeout(() => { document.body.style.background = 'rgb(255, 0, 0)'; document.querySelector('button').textContent = 'Changed'; }, 600)</script>"
          : "<!doctype html><title>Browser Device test</title><button>Continue</button>",
      );
    });
    await new Promise<void>((resolve) => product.listen(0, "127.0.0.1", resolve));
    const productAddress = product.address();
    assert(productAddress && typeof productAddress === "object");
    const startUrl = `http://127.0.0.1:${productAddress.port}`;
    const server = await startServer({ host: "127.0.0.1", port: 0 });
    const client = new RelayClient(
      {
        url: `http://127.0.0.1:${server.port}`,
        auth: { type: "none" },
        organizationId: "relay",
        projectId: "browser-device",
        actorId: "human:browser-device-route-test",
        actorKind: "human",
      },
      { timeoutMs: SATURATED_SUITE_CLIENT_TIMEOUT_MS },
    );
    try {
      const { target } = await client.invoke("target.create", {
        id: "browser-device-route",
        name: "Browser Device route",
        startUrl,
        headless: true,
        environment: { viewport: { width: 800, height: 600 } },
      });
      await assert.rejects(
        client.invoke("target.browser-auth.save", {
          targetId: target.id,
          name: "Missing reviewed session",
          confirm: true,
        }),
        (error) =>
          error instanceof ApiError &&
          error.status === 409 &&
          /Open the managed browser/u.test(error.message),
      );
      const opened = await client.invoke("target.browser-device.open", { targetId: target.id });
      assert.equal(opened.session.ownership, "controlled");
      const savedAuthentication = await client.invoke("target.browser-auth.save", {
        targetId: target.id,
        name: "Reviewed signed-in state",
        confirm: true,
      });
      assert.match(savedAuthentication.fixture.reference, /^authfx:.+:1$/u);
      assert.equal(
        savedAuthentication.target.browser?.environment?.authenticationFixtureId,
        savedAuthentication.fixture.reference,
      );
      const fixtures = await client.invoke("target.browser-auth.list", { targetId: target.id });
      assert.equal(fixtures.fixtures.length, 1);
      const listed = fixtures.fixtures[0]!;
      const { health, ...listedWithoutHealth } = listed;
      assert.deepEqual(listedWithoutHealth, savedAuthentication.fixture);
      assert.equal(health?.status, "ready");
      const agentClient = new RelayClient(
        {
          url: `http://127.0.0.1:${server.port}`,
          auth: { type: "none" },
          organizationId: "relay",
          projectId: "browser-device",
          actorId: "agent:browser-device-route-test",
          actorKind: "agent",
        },
        { timeoutMs: SATURATED_SUITE_CLIENT_TIMEOUT_MS },
      );
      await assert.rejects(
        agentClient.invoke("target.browser-auth.save", {
          targetId: target.id,
          name: "Unreviewed agent state",
          confirm: true,
        }),
        (error) => error instanceof ApiError && error.status === 403,
      );
      const first = await client.invoke("target.browser-device.frame", { targetId: target.id });
      assert.equal(first.frame.sequence, 1);
      assert.equal(first.frame.sessionId, opened.session.sessionId);
      const inspected = await client.invoke("target.browser-device.inspect", {
        targetId: target.id,
        sessionId: first.frame.sessionId,
        pageId: first.frame.pageId,
        expectedSequence: first.frame.sequence,
      });
      assert.equal(inspected.overlay.sessionId, first.frame.sessionId);
      assert.equal(inspected.overlay.pageId, first.frame.pageId);
      assert.equal(inspected.overlay.sequence, first.frame.sequence);
      assert.equal(inspected.overlay.visualFingerprint, first.frame.visualFingerprint);
      assert.equal(inspected.overlay.candidates[0]?.label, "Continue");
      assert.equal(inspected.overlay.candidates[0]?.locator?.strategy, "role-name");
      await client.invoke("target.browser-device.control", {
        targetId: target.id,
        input: {
          sessionId: first.session.sessionId,
          pageId: first.frame.pageId,
          expectedSequence: first.frame.sequence,
          kind: "navigate",
          url: `${startUrl}/mutating`,
        },
      });
      const autonomousFrame = await client.invoke("target.browser-device.frame", {
        targetId: target.id,
        afterSequence: first.frame.sequence,
      });
      await new Promise((resolve) => setTimeout(resolve, 800));
      await assert.rejects(
        client.invoke("target.browser-device.inspect", {
          targetId: target.id,
          sessionId: autonomousFrame.frame.sessionId,
          pageId: autonomousFrame.frame.pageId,
          expectedSequence: autonomousFrame.frame.sequence,
        }),
        (error) => error instanceof ApiError && error.status === 409,
      );
      const freshAutonomousFrame = await client.invoke("target.browser-device.frame", {
        targetId: target.id,
        afterSequence: autonomousFrame.frame.sequence,
      });
      await client.invoke("target.browser-device.control", {
        targetId: target.id,
        input: {
          sessionId: freshAutonomousFrame.frame.sessionId,
          pageId: freshAutonomousFrame.frame.pageId,
          expectedSequence: freshAutonomousFrame.frame.sequence,
          kind: "navigate",
          url: `${startUrl}/next`,
        },
      });
      await assert.rejects(
        client.invoke("target.browser-device.inspect", {
          targetId: target.id,
          sessionId: first.frame.sessionId,
          pageId: first.frame.pageId,
          expectedSequence: first.frame.sequence,
        }),
        (error) => error instanceof ApiError && error.status === 409,
      );
      await assert.rejects(
        client.invoke("target.browser-device.control", {
          targetId: target.id,
          input: {
            sessionId: first.frame.sessionId,
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
        afterSequence: freshAutonomousFrame.frame.sequence,
      });
      assert.equal(second.frame.sequence, 4);
      assert.match(second.frame.pageUrl, /\/next$/u);

      const semanticClick = await client.invoke("target.browser-device.control", {
        targetId: target.id,
        input: {
          sessionId: second.session.sessionId,
          pageId: second.frame.pageId,
          expectedSequence: second.frame.sequence,
          kind: "click",
          x: 10,
          y: 10,
        },
      });
      assert.equal(semanticClick.resolution?.outcome, "semantic");
      assert.equal(semanticClick.resolution?.reviewedCoordinateFallback, false);
      const controlFrame = await client.invoke("target.browser-device.frame", {
        targetId: target.id,
        afterSequence: second.frame.sequence,
      });

      const slowInput = client.invoke("target.browser-device.control", {
        targetId: target.id,
        input: {
          sessionId: controlFrame.session.sessionId,
          pageId: controlFrame.frame.pageId,
          expectedSequence: controlFrame.frame.sequence,
          kind: "navigate",
          url: `${startUrl}/slow`,
        },
      });
      // Attach a terminal observer immediately. Under a saturated full-suite
      // runner the request may settle before the admission assertions below;
      // delaying allSettled until then would create an unhandled rejection.
      const slowInputSettled = Promise.allSettled([slowInput]);
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (browserMutationAdmissionStats(target.id).pending > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.equal(browserMutationAdmissionStats(target.id).pending, 1);
      const queuedInputs = Array.from({ length: MAX_BROWSER_DEVICE_INPUT_QUEUE - 1 }, () =>
        client.invoke("target.browser-device.control", {
          targetId: target.id,
          input: {
            sessionId: controlFrame.session.sessionId,
            pageId: controlFrame.frame.pageId,
            expectedSequence: controlFrame.frame.sequence,
            kind: "click",
            x: 10,
            y: 10,
          },
        }),
      );
      const queuedInputsSettled = Promise.allSettled(queuedInputs);
      for (let attempt = 0; attempt < 2_000; attempt += 1) {
        if (browserMutationAdmissionStats(target.id).pending >= MAX_BROWSER_DEVICE_INPUT_QUEUE)
          break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.equal(
        browserMutationAdmissionStats(target.id).pending,
        MAX_BROWSER_DEVICE_INPUT_QUEUE,
      );
      await assert.rejects(
        client.invoke("target.browser-device.control", {
          targetId: target.id,
          input: {
            sessionId: controlFrame.session.sessionId,
            pageId: controlFrame.frame.pageId,
            expectedSequence: controlFrame.frame.sequence,
            kind: "click",
            x: 10,
            y: 10,
          },
        }),
        (error) =>
          error instanceof ApiError &&
          error.status === 429 &&
          (error.body as { code?: unknown } | undefined)?.code === "BROWSER_INPUT_OVERLOADED",
      );
      releaseSlowNavigation?.();
      await Promise.all([slowInputSettled, queuedInputsSettled]);
      const binary = await client.binaryResource(
        `/targets/${encodeURIComponent(target.id)}/browser-device/frame.bin?afterSequence=${controlFrame.frame.sequence}`,
      );
      assert.equal(binary.headers.get("x-relay-browser-device-transport"), "binary");
      assert.equal(binary.headers.get("content-type"), "application/x-relay-browser-device-frame");
      assert(binary.bytes.byteLength > 4);
      const metadataLength = new DataView(
        binary.bytes.buffer,
        binary.bytes.byteOffset,
        4,
      ).getUint32(0);
      const metadataEnd = 4 + metadataLength;
      const metadata = JSON.parse(
        new TextDecoder().decode(binary.bytes.subarray(4, metadataEnd)),
      ) as {
        transport: string;
        session: { sessionId: string };
        frame: { sessionId: string; pageId: string; sequence: number; visualFingerprint: string };
      };
      assert.equal(metadata.transport, "binary");
      assert.equal(metadata.session.sessionId, controlFrame.session.sessionId);
      assert.equal(metadata.frame.sessionId, controlFrame.frame.sessionId);
      assert.equal(metadata.frame.pageId, controlFrame.frame.pageId);
      assert.equal(metadata.frame.sequence, controlFrame.frame.sequence + 1);
      assert.equal(typeof metadata.frame.visualFingerprint, "string");
      const revokedAuthentication = await client.invoke("target.browser-auth.revoke", {
        targetId: target.id,
        reference: savedAuthentication.fixture.reference,
        confirm: true,
      });
      assert.equal(revokedAuthentication.fixture.revokedBy, "human:browser-device-route-test");
      assert.equal(
        revokedAuthentication.target.browser?.environment?.authenticationFixtureId,
        undefined,
      );
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
      releaseSlowNavigation?.();
      await closeBrowserTarget(undefined, { mode: "authoring" });
      resetBrowserDeviceSessionsForTests();
      resetBrowserMutationAdmissionsForTests();
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
  },
);
