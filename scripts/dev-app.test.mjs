import assert from "node:assert/strict";
import test from "node:test";
import { createServer as createHttpServer } from "node:http";
import { mkdtemp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer as createViteServer } from "vite";
import {
  allowedBrowserOriginsWith,
  ensureServerLaunchArgs,
  relayAppPackage,
  relayAppLaunchArgs,
  relayBrowserOrigin,
  relayBrowserOrigins,
  relayDevelopmentOrigins,
} from "./dev-app.mjs";

test("browser development binds the exact chosen loopback origin", () => {
  assert.equal(relayBrowserOrigin(5175), "http://127.0.0.1:5175");
  assert.throws(() => relayBrowserOrigin(0), /Invalid Relay app port/u);
});

test("browser development accepts the friendly localhost URL and exact loopback host", () => {
  assert.deepEqual(relayBrowserOrigins(3000), ["http://localhost:3000", "http://127.0.0.1:3000"]);
});

test("browser development preserves reviewed origins without duplicates", () => {
  assert.equal(
    allowedBrowserOriginsWith(
      "http://127.0.0.1:5175",
      "https://relay.example, http://127.0.0.1:5175",
    ),
    "https://relay.example,http://127.0.0.1:5175",
  );
});

test("a fallback development port preserves the preferred browser origin", () => {
  assert.deepEqual(relayDevelopmentOrigins(3000, 3001), [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
  ]);
  assert.deepEqual(relayDevelopmentOrigins(3000, 3000), [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ]);
});

test("browser development always uses the React product", () => {
  assert.equal(relayAppPackage([]), "@relay/app");
  assert.throws(() => relayAppPackage(["--legacy"]), /Unknown Relay app option/u);
  assert.throws(() => relayAppPackage(["--unknown"]), /Unknown Relay app option/u);
});

test("dev-app reuses the running Relay on :8787", () => {
  assert.deepEqual(ensureServerLaunchArgs(), ["--reuse"]);
});

test("the launcher keeps the same-origin API proxy when its config is temporarily absent", async () => {
  const requests = [];
  const backend = createHttpServer((req, res) => {
    requests.push({
      method: req.method,
      path: req.url,
      origin: req.headers.origin,
      referer: req.headers.referer,
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, path: req.url }));
  });
  await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const fixtureRoot = await mkdtemp(join(tmpdir(), "relay-app-proxy-"));
  const fixtureConfig = join(fixtureRoot, "vite.config.mjs");
  const appConfig = fileURLToPath(new URL("../packages/app/vite.config.ts", import.meta.url));
  const launchArgs = relayAppLaunchArgs(3001);
  const configIndex = launchArgs.indexOf("--config");
  const originalRelayUrl = process.env.RELAY_URL;
  process.env.RELAY_URL = `http://127.0.0.1:${backend.address().port}`;
  let vite;
  try {
    await mkdir(join(fixtureRoot, "public"));
    await writeFile(
      join(fixtureRoot, "index.html"),
      "<!doctype html><html><body>fixture SPA</body></html>",
    );
    await writeFile(
      join(fixtureRoot, "public", "relay-theme-preload.js"),
      "window.fixtureTheme=true;",
    );
    await writeFile(
      join(fixtureRoot, "public", "relay-icon.png"),
      new Uint8Array([137, 80, 78, 71]),
    );
    await writeFile(
      fixtureConfig,
      `import app from ${JSON.stringify(pathToFileURL(appConfig).href)};
export default {...app, root:import.meta.dirname, plugins:[], publicDir:import.meta.dirname+'/public',
  server:{...app.server,host:'127.0.0.1',port:0,strictPort:false,watch:null}, optimizeDeps:{noDiscovery:true,include:[]}};`,
    );
    const hasExplicitConfig = configIndex >= 0;
    if (hasExplicitConfig) assert.equal(launchArgs[configIndex + 1], appConfig);
    vite = await createViteServer({
      root: fixtureRoot,
      ...(hasExplicitConfig ? { configFile: fixtureConfig } : {}),
      logLevel: "silent",
      server: { host: "127.0.0.1", port: 0, watch: null },
    });
    await vite.listen();
    const base = () => `http://127.0.0.1:${vite.httpServer.address().port}`;
    async function expectApi(path) {
      const response = await fetch(`${base()}/relay${path}`, {
        headers: { Origin: "http://fixture.test", Referer: "http://fixture.test/" },
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type"), /application\/json/u);
      assert.deepEqual(await response.json(), { ok: true, path });
    }
    await expectApi("/health");
    await expectApi("/app-maps");
    await rename(fixtureConfig, `${fixtureConfig}.held`);
    await vite.restart();
    await expectApi("/health");
    await expectApi("/devices?targetKind=device");
    await rename(`${fixtureConfig}.held`, fixtureConfig);
    await vite.restart();
    await expectApi("/app-maps");
    const theme = await fetch(`${base()}/relay-theme-preload.js`);
    assert.equal(await theme.text(), "window.fixtureTheme=true;");
    const icon = await fetch(`${base()}/relay-icon.png`);
    assert.deepEqual(new Uint8Array(await icon.arrayBuffer()), new Uint8Array([137, 80, 78, 71]));
    assert.deepEqual(
      requests.map(({ path }) => path),
      ["/health", "/app-maps", "/health", "/devices?targetKind=device", "/app-maps"],
    );
    assert.ok(
      requests.every(
        ({ method, origin, referer }) =>
          method === "GET" && origin === undefined && referer === undefined,
      ),
    );
  } finally {
    await vite?.close();
    await new Promise((resolve) => backend.close(resolve));
    await rm(fixtureRoot, { recursive: true, force: true });
    if (originalRelayUrl === undefined) delete process.env.RELAY_URL;
    else process.env.RELAY_URL = originalRelayUrl;
  }
});
