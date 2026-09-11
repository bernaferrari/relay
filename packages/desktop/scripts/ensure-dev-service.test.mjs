import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { rendererCanReachService } from "./ensure-dev-service.mjs";

test("desktop readiness requires actual renderer-origin admission", async () => {
  let allowed = false;
  const server = createServer((req, res) => {
    if (allowed) res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
    res.end(JSON.stringify({ product: "relay" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    assert.equal(await rendererCanReachService(url, "http://localhost:5173"), false);
    allowed = true;
    assert.equal(await rendererCanReachService(url, "http://localhost:5173"), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
