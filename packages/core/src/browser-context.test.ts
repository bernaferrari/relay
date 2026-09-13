import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { compileBrowserEnvironment, type TargetDefinition } from "@relay/protocol";
import { chromium } from "playwright-core";
import { browserContextOptionsForProfile, createBrowserContextFactory } from "./browser-context.js";
import { saveBrowserAuthenticationFixture } from "./browser-authentication-fixtures.js";
import { closeBrowserHostPool } from "./browser-host-pool.js";
import { browserProofSessionForTarget, closeBrowserTarget } from "./browser-target.js";
import { acquirePreparedSessionDevice } from "./session-provider-execution.js";
import { deleteTarget, saveBrowserTarget } from "./targets.js";
import type { TestJob } from "./session.js";

const CHROME =
  process.env.RELAY_TEST_CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let root = "";
let server: http.Server;
let startUrl = "";

before(async () => {
  root = await mkdtemp(join(tmpdir(), "relay-browser-context-"));
  process.env.RELAY_WORKSPACE_ROOT = root;
  server = http.createServer((request, response) => {
    if (request.url === "/proof-worker.js") {
      response.setHeader("content-type", "text/javascript");
      response.end("self.addEventListener('fetch', () => undefined)");
      return;
    }
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
  await closeBrowserHostPool();
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

test("Playwright contexts receive no implicit permissions", () => {
  const defaultProfile = compileBrowserEnvironment();
  assert.deepEqual(browserContextOptionsForProfile(defaultProfile, {}).permissions, []);

  const reviewedProfile = compileBrowserEnvironment({ permissions: ["clipboard-read"] });
  assert.deepEqual(browserContextOptionsForProfile(reviewedProfile, {}).permissions, [
    "clipboard-read",
  ]);
});

test("redacted frozen proof runs disable Playwright context video recording", async (t) => {
  try {
    await access(CHROME);
  } catch {
    t.skip("Google Chrome is not installed");
    return;
  }
  if (t.signal.aborted) return;

  const target = await saveBrowserTarget({
    id: "browser-redacted-proof",
    name: "Redacted proof browser",
    startUrl,
    headless: true,
    environment: { viewport: { width: 900, height: 600 } },
  });
  const profile = compileBrowserEnvironment(target.browser?.environment ?? {});
  const job = {
    id: "redacted-proof-run",
    targetKind: "browser",
    browserTargetId: target.id,
    targetContext: { kind: "browser", platform: "browser", targetId: target.id },
    browserCaseProfile: profile,
    projectId: "default",
    artifacts: [],
    evidencePolicy: {
      schemaVersion: 1,
      sensitive: {},
      redaction: { enabled: true, source: "workspace", locked: false },
    },
  } as unknown as TestJob;
  try {
    await acquirePreparedSessionDevice(
      job,
      { browserTarget: target, deviceAvailable: true },
      () => undefined,
    );
    const session = await browserProofSessionForTarget(target.id);
    assert.equal(session.recordVideo, false);
    assert.equal(session.context.pages()[0]?.video(), null);
    assert.equal(session.headless, true);
  } finally {
    await closeBrowserTarget(target.id, { mode: "proof" }).catch(() => undefined);
    await deleteTarget(target.id).catch(() => undefined);
  }
});

test("proof jobs stay headless when the saved browser target is headed", async (t) => {
  try {
    await access(CHROME);
  } catch {
    t.skip("Google Chrome is not installed");
    return;
  }
  if (t.signal.aborted) return;

  const target = await saveBrowserTarget({
    id: "browser-headed-proof",
    name: "Headed authoring browser",
    startUrl,
    headless: false,
    environment: { viewport: { width: 900, height: 600 } },
  });
  const profile = compileBrowserEnvironment(target.browser?.environment ?? {});
  const job = {
    id: "headed-target-headless-proof",
    targetKind: "browser",
    browserTargetId: target.id,
    targetContext: { kind: "browser", platform: "browser", targetId: target.id },
    browserCaseProfile: profile,
    projectId: "default",
    artifacts: [],
    evidencePolicy: {
      schemaVersion: 1,
      sensitive: {},
      redaction: { enabled: false, source: "workspace", locked: false },
    },
  } as unknown as TestJob;
  try {
    await acquirePreparedSessionDevice(
      job,
      { browserTarget: target, deviceAvailable: true },
      () => undefined,
    );
    const session = await browserProofSessionForTarget(target.id);
    assert.equal(session.headless, true);
  } finally {
    await closeBrowserTarget(target.id, { mode: "proof" }).catch(() => undefined);
    await deleteTarget(target.id).catch(() => undefined);
  }
});

test("authoring context is separate while proof contexts are fresh and explicitly closable", async (t) => {
  try {
    await access(CHROME);
  } catch {
    t.skip("Google Chrome is not installed");
    return;
  }
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
    // Proof contexts are fresh, but their compatible browser process remains
    // pooled for the next proof Run.
    assert.equal(proofBrowser?.isConnected(), true);

    secondProof = await factory.openProof(undefined, { headless: true });
    assert.equal(secondProof.context.browser(), proofBrowser);
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

test("proof contexts import only the exact encrypted authentication fixture revision", async (t) => {
  try {
    await access(CHROME);
  } catch {
    t.skip("Google Chrome is not installed");
    return;
  }
  if (t.signal.aborted) return;

  const fixture = await saveBrowserAuthenticationFixture({
    projectId: "browser-context-project",
    targetId: target().id,
    name: "Reviewed member state",
    createdBy: "human:test-reviewer",
    storageState: {
      cookies: [{ name: "member", value: "yes", url: startUrl }],
      origins: [
        {
          origin: startUrl,
          localStorage: [{ name: "relay-member", value: "yes" }],
        },
      ],
    },
  });
  const profile = compileBrowserEnvironment({
    ...target().browser!.environment,
    authenticationFixtureId: fixture.reference,
  });
  const context = await createBrowserContextFactory(target()).openProof(profile, {
    headless: true,
    projectId: "browser-context-project",
  });
  try {
    const page = context.context.pages()[0] ?? (await context.context.newPage());
    await page.goto(startUrl);
    assert.match(await page.evaluate(() => document.cookie), /(?:^|; )member=yes(?:;|$)/u);
    assert.equal(await page.evaluate(() => localStorage.getItem("relay-member")), "yes");
  } finally {
    await context.close();
  }
});

test("100 sequential proof Run contexts leak no browser state", async (t) => {
  try {
    await access(CHROME);
  } catch {
    t.skip("Google Chrome is not installed");
    return;
  }
  if (t.signal.aborted) return;

  const profile = compileBrowserEnvironment({
    viewport: { width: 390, height: 844 },
    locale: "pt-BR",
    timezoneId: "America/Maceio",
    colorScheme: "dark",
    touch: true,
  });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    for (let index = 0; index < 100; index += 1) {
      const marker = `proof-${String(index).padStart(2, "0")}`;
      const context = await browser.newContext(
        browserContextOptionsForProfile(profile, { headless: true }),
      );
      try {
        const page = await context.newPage();
        await page.goto(startUrl);
        assert.deepEqual(await context.cookies(), []);
        assert.deepEqual(
          await page.evaluate(async () => ({
            local: localStorage.getItem("relay-proof"),
            caches: await caches.keys(),
            workers: (await navigator.serviceWorker.getRegistrations()).length,
            language: navigator.language,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            dark: matchMedia("(prefers-color-scheme: dark)").matches,
          })),
          {
            local: null,
            caches: [],
            workers: 0,
            language: "pt-BR",
            timezone: "America/Maceio",
            dark: true,
          },
        );
        await context.addCookies([
          { name: "relay-proof", value: marker, url: startUrl, httpOnly: true },
        ]);
        await page.evaluate(async (value) => {
          localStorage.setItem("relay-proof", value);
          const cache = await caches.open("relay-proof");
          await cache.put("/proof-cache", new Response(value));
          await navigator.serviceWorker.register("/proof-worker.js");
          await navigator.serviceWorker.ready;
        }, marker);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
});

test("requested fixture-backed environments require exact project-scoped ciphertext", async () => {
  const factory = createBrowserContextFactory({
    ...target(),
    browser: {
      ...target().browser!,
      environment: {
        ...target().browser!.environment,
        authenticationFixtureId: "authfx:00000000-0000-4000-8000-000000000000:1",
      },
    },
  });

  await assert.rejects(
    factory.openProof(undefined, { headless: true }),
    /requires one explicit project scope/u,
  );
  await assert.rejects(
    factory.openProof(undefined, { headless: true, projectId: "project-a" }),
    /not found in this project and target/u,
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
