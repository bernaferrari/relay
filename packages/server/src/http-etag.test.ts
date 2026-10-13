import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { jsonIfChanged } from "./http.js";

test("an unchanged read is answered with 304 before the body is built", async () => {
  let built = 0;
  let version = "v1";
  const server = http.createServer((req, res) =>
    jsonIfChanged(req, res, version, () => {
      built += 1;
      return { ok: true };
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  try {
    const first = await fetch(url);
    const etag = first.headers.get("etag");
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { ok: true });
    assert.ok(etag);
    assert.equal(first.headers.get("cache-control"), "no-cache");

    const again = await fetch(url, { headers: { "If-None-Match": etag } });
    assert.equal(again.status, 304);
    assert.equal(built, 1);

    version = "v2";
    const changed = await fetch(url, { headers: { "If-None-Match": etag } });
    assert.equal(changed.status, 200);
    assert.notEqual(changed.headers.get("etag"), etag);
    assert.equal(built, 2);
  } finally {
    server.close();
  }
});
