import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { TargetDefinition } from "@relay/protocol";
import { createBrowserContextFactory } from "./browser-context.js";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let root = "";
let server: http.Server;
let startUrl = "";

before(async () => {
  root = await mkdtemp(join(tmpdir(), "relay-browser-context-"));
  process.env.RELAY_WORKSPACE_ROOT = root;
  server = http.createServer((request, response) => {
    response.setHeader("content-type", "text/html");
    if (request.url?.startsWith("/seed")) {
      response.setHeader("set-cookie", "relay-authoring=present; Path=/");
      response.end("<script>localStorage.setItem('relay-authoring', 'present')</script>seed");
      return;
    }
    response.end("<title>context fixture</title>fixture");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  startUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  delete process.env.RELAY_WORKSPACE_ROOT;
  await rm(root, { recursive: true, force: true });
});

function target(): TargetDefinition {
  return {
    id: "browser-context-test",
    name: "Browser context fixture",
    kind: "browser",
    createdAt: 1,
    updatedAt: 1,
    browser: {
      startUrl,
      headless: true,
      environment: {
        engine: "chromium",
        viewport: { width: 900, height: 600 },
        locale: "en-US",
        timezoneId: "UTC",
      },
    },
  };
}

test("authoring context is separate while proof contexts are fresh and explicitly closable", async (t) => {
  await access(CHROME).catch(() => t.skip("Google Chrome is not installed"));
  if (t.signal.aborted) return;

  const factory = createBrowserContextFactory(target());
  let authoring;
  let proof;
  let secondProof;
  let thirdProof;
  try {
    authoring = await factory.openAuthoring({ headless: true });
    const authoringPage = authoring.context.pages()[0] ?? (await authoring.context.newPage());
    await authoringPage.goto(`${startUrl}/seed`);
    // Set one cookie through the browser API as well as the fixture response:
    // this keeps the test about profile persistence rather than Set-Cookie
    // header behavior across installed Chrome versions.
    await authoring.context.addCookies([
      { name: "relay-authoring", value: "present", url: startUrl },
    ]);
    assert.equal(
      await authoringPage.evaluate(() => localStorage.getItem("relay-authoring")),
      "present",
    );
    await authoring.close();
    authoring = undefined;

    proof = await factory.openProof(undefined, { headless: true });
    assert.equal(proof.purpose, "proof");
    const proofBrowser = proof.context.browser();
    const proofPage = await proof.context.newPage();
    await proofPage.goto(startUrl);
    assert.equal(await proofPage.evaluate(() => document.cookie), "");
    assert.equal(await proofPage.evaluate(() => localStorage.getItem("relay-authoring")), null);
    await proof.close();
    proof = undefined;
    assert.equal(proofBrowser?.isConnected(), false);

    secondProof = await factory.openProof(undefined, { headless: true });
    const secondPage = await secondProof.context.newPage();
    await secondPage.goto(`${startUrl}/seed`);
    await secondProof.close();
    secondProof = undefined;
    thirdProof = await factory.openProof(undefined, { headless: true });
    const thirdPage = await thirdProof.context.newPage();
    await thirdPage.goto(startUrl);
    assert.equal(await thirdPage.evaluate(() => document.cookie), "");
    assert.equal(await thirdPage.evaluate(() => localStorage.getItem("relay-authoring")), null);
  } finally {
    await authoring?.close().catch(() => undefined);
    await proof?.close().catch(() => undefined);
    await secondProof?.close().catch(() => undefined);
    await thirdProof?.close().catch(() => undefined);
  }
});

test("requested fixture-backed environments fail before browser launch", async () => {
  const factory = createBrowserContextFactory({
    ...target(),
    browser: {
      ...target().browser!,
      environment: {
        ...target().browser!.environment,
        authenticationFixtureId: "fixture:missing",
      },
    },
  });

  await assert.rejects(
    factory.openProof(undefined, { headless: true }),
    /unavailable host resolvers: authenticationFixtureId/u,
  );
});

test("explicit browser revisions fail closed until a host resolver exists", async () => {
  const factory = createBrowserContextFactory({
    ...target(),
    browser: {
      ...target().browser!,
      environment: {
        ...target().browser!.environment,
        revision: "chromium-123.0.0",
      },
    },
  });

  await assert.rejects(
    factory.openProof(undefined, { headless: true }),
    /unavailable host resolvers: revision/u,
  );
});
