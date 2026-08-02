import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { isCompatibleServer, waitForCompatibleServer } from "./server-readiness.ts";

async function listen(
  handler: http.RequestListener,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

test("recognizes only the expected Relay server identity", async () => {
  const server = await listen((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ product: "relay", version: "0.1.0" }));
  });
  try {
    assert.equal(
      await isCompatibleServer(server.url, {
        product: "relay",
        version: "0.1.0",
        timeoutMs: 100,
      }),
      true,
    );
    assert.equal(
      await isCompatibleServer(server.url, {
        product: "relay",
        version: "9.9.9",
        timeoutMs: 100,
      }),
      false,
    );
  } finally {
    await server.close();
  }
});

test("waits through startup failures until the owned server becomes ready", async () => {
  let probes = 0;
  const server = await listen((_request, response) => {
    probes += 1;
    response.statusCode = probes < 3 ? 503 : 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ product: "relay", version: "0.1.0" }));
  });
  try {
    assert.equal(
      await waitForCompatibleServer(server.url, {
        product: "relay",
        version: "0.1.0",
        attempts: 4,
        delayMs: 1,
        timeoutMs: 100,
      }),
      true,
    );
    assert.equal(probes, 3);
  } finally {
    await server.close();
  }
});

test("authenticates readiness probes for a protected local service", async () => {
  const token = "desktop-readiness-token";
  const server = await listen((request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.statusCode = 401;
      response.end();
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ product: "relay", version: "0.1.0" }));
  });
  try {
    assert.equal(
      await isCompatibleServer(server.url, {
        product: "relay",
        version: "0.1.0",
        authorizationToken: token,
        timeoutMs: 100,
      }),
      true,
    );
  } finally {
    await server.close();
  }
});
