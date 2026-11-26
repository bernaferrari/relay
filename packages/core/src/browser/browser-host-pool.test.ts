import assert from "node:assert/strict";
import { test } from "node:test";
import type { Browser, BrowserContext, BrowserType } from "playwright-core";
import type { BrowserEngine } from "@relay/protocol";
import {
  BrowserHostPool,
  BrowserHostPoolLimitError,
  type BrowserHostIdentity,
} from "./browser-host-pool.js";

type FakeContext = BrowserContext & { state: Map<string, string>; closed: boolean };
type FakeBrowser = Browser & {
  contextsCreated: FakeContext[];
  disconnect: () => void;
  closeCalls: number;
};

function fakeBrowser(): FakeBrowser {
  const listeners = new Set<() => void>();
  const contextsCreated: FakeContext[] = [];
  let disconnected = false;
  const browser = {
    contextsCreated,
    closeCalls: 0,
    on(event: string, listener: () => void) {
      if (event === "disconnected") listeners.add(listener);
      return browser;
    },
    async newContext() {
      const context = {
        state: new Map<string, string>(),
        closed: false,
        async close() {
          context.closed = true;
        },
      } as FakeContext;
      contextsCreated.push(context);
      return context;
    },
    async close() {
      browser.closeCalls += 1;
      if (disconnected) return;
      disconnected = true;
      for (const listener of listeners) listener();
    },
    disconnect() {
      disconnected = true;
      for (const listener of listeners) listener();
    },
  } as unknown as FakeBrowser;
  return browser;
}

const browserType = {} as BrowserType;
const contextOptions = { viewport: { width: 390, height: 844 } };

function identity(
  engine: BrowserEngine = "chromium",
  options: { channel?: string; revision?: string; executablePath?: string } = {},
): BrowserHostIdentity {
  return {
    engine,
    ...(options.channel === undefined ? {} : { channel: options.channel }),
    ...(options.revision === undefined ? {} : { revision: options.revision }),
    launchOptions: {
      headless: true,
      ...(options.executablePath === undefined ? {} : { executablePath: options.executablePath }),
    },
  };
}

async function open(
  pool: BrowserHostPool,
  currentIdentity: BrowserHostIdentity = identity(),
): Promise<Awaited<ReturnType<BrowserHostPool["openContext"]>>> {
  return pool.openContext({ identity: currentIdentity, browserType, contextOptions });
}

test("reuses one compatible host while every context remains fresh", async () => {
  const launched: FakeBrowser[] = [];
  const pool = new BrowserHostPool({
    launchBrowser: async () => {
      const browser = fakeBrowser();
      launched.push(browser);
      return browser;
    },
  });
  const first = await open(pool);
  const second = await open(pool);
  const firstContext = first.context as FakeContext;
  const secondContext = second.context as FakeContext;

  assert.equal(launched.length, 1);
  assert.equal(first.browser, second.browser);
  assert.notEqual(firstContext, secondContext);
  firstContext.state.set("cookie", "first-run");
  assert.equal(secondContext.state.get("cookie"), undefined);

  await first.close();
  await second.close();
  assert.deepEqual(pool.getStats(), {
    hosts: 1,
    contexts: 0,
    drainingHosts: 0,
    maxHosts: 4,
    maxContextsPerHost: 16,
  });
  await pool.close();
  assert.equal(launched[0]?.closeCalls, 1);
});

test("never substitutes a browser host across engine or launch identity", async () => {
  const launched: FakeBrowser[] = [];
  const pool = new BrowserHostPool({
    launchBrowser: async () => {
      const browser = fakeBrowser();
      launched.push(browser);
      return browser;
    },
  });
  const chromiumContext = await open(pool, identity("chromium", { revision: "r1" }));
  const chromiumSame = await open(pool, identity("chromium", { revision: "r1" }));
  const chromiumDifferentRevision = await open(pool, identity("chromium", { revision: "r2" }));
  const firefoxContext = await open(pool, identity("firefox", { revision: "r1" }));
  const differentExecutable = await open(
    pool,
    identity("chromium", { revision: "r1", executablePath: "/other/chrome" }),
  );

  assert.equal(launched.length, 4);
  assert.equal(chromiumContext.browser, chromiumSame.browser);
  assert.notEqual(chromiumContext.browser, chromiumDifferentRevision.browser);
  assert.notEqual(chromiumContext.browser, firefoxContext.browser);
  assert.notEqual(chromiumContext.browser, differentExecutable.browser);
  await Promise.all([
    chromiumContext.close(),
    chromiumSame.close(),
    chromiumDifferentRevision.close(),
    firefoxContext.close(),
    differentExecutable.close(),
  ]);
  await pool.close();
});

test("enforces host and context bounds before launching another browser", async () => {
  let launches = 0;
  const pool = new BrowserHostPool({
    maxHosts: 1,
    maxContextsPerHost: 1,
    launchBrowser: async () => {
      launches += 1;
      return fakeBrowser();
    },
  });
  const first = await open(pool);
  await assert.rejects(open(pool), (error: unknown) => {
    assert(error instanceof BrowserHostPoolLimitError);
    return true;
  });
  assert.equal(launches, 1);
  await first.close();
  const second = await open(pool);
  // Closing a context releases only the context slot; the healthy host is
  // retained for the next proof Run.
  assert.equal(launches, 1);
  await second.close();
  await pool.close();
});

test("evicts crashed hosts and admits a fresh compatible host", async () => {
  const launched: FakeBrowser[] = [];
  const pool = new BrowserHostPool({
    launchBrowser: async () => {
      const browser = fakeBrowser();
      launched.push(browser);
      return browser;
    },
  });
  const first = await open(pool);
  (first.browser as FakeBrowser).disconnect();
  assert.equal(pool.getStats().hosts, 0);
  await first.close();
  const second = await open(pool);
  assert.equal(launched.length, 2);
  assert.notEqual(first.browser, second.browser);
  await second.close();
  await pool.close();
});

test("drain waits for contexts, then allows later hosts; close force-cleans", async () => {
  const launched: FakeBrowser[] = [];
  const pool = new BrowserHostPool({
    launchBrowser: async () => {
      const browser = fakeBrowser();
      launched.push(browser);
      return browser;
    },
  });
  const first = await open(pool);
  let drained = false;
  const draining = pool.drain().then(() => {
    drained = true;
  });
  await Promise.resolve();
  assert.equal(drained, false);
  await first.close();
  await draining;
  assert.equal(launched[0]?.closeCalls, 1);
  const second = await open(pool);
  await pool.close();
  assert.equal(launched[1]?.closeCalls, 1);
  await second.close();
  assert.equal(pool.getStats().hosts, 0);
});
