import { EventEmitter } from "node:events";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import test from "node:test";
import { publish } from "@relay/core";
import { createSseHub } from "./sse.js";

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address) resolve(address.port);
      else reject(new Error("SSE test server did not bind a port"));
    });
  });
}

test("SSE clients that cannot drain are paused and then dropped", async () => {
  const hub = createSseHub({});
  const server = createServer((req, res) => {
    const original = res.write.bind(res);
    let writes = 0;
    res.write = ((chunk: unknown, encoding?: unknown, callback?: unknown) => {
      writes += 1;
      if (writes > 3) {
        if (typeof encoding === "function") encoding();
        else if (typeof callback === "function") callback();
        return false;
      }
      return original(chunk as string, encoding as BufferEncoding, callback as () => void);
    }) as ServerResponse["write"];
    hub.attach(req as IncomingMessage, res);
  });
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/events`);
    assert.equal(response.ok, true);
    assert.equal(hub.count(), 1);
    for (let index = 0; index < 60; index += 1) {
      publish({ type: "error", at: Date.now(), message: `backpressure-${index}` });
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(hub.count(), 0);
    await response.body?.cancel().catch(() => undefined);
  } finally {
    hub.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("backpressure buffers complete events and eviction closes the transport", () => {
  const hub = createSseHub({});
  const req = new EventEmitter() as IncomingMessage;
  req.headers = {};
  const chunks: string[] = [];
  let blocked = false;
  const res = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
    writeHead() {},
    write(chunk: string) {
      chunks.push(chunk);
      return !blocked;
    },
    destroy() {
      this.destroyed = true;
    },
    end() {
      this.writableEnded = true;
    },
  });
  try {
    hub.attach(req, res as unknown as ServerResponse);
    chunks.length = 0;
    blocked = true;
    publish({ type: "error", at: 1, message: "first" });
    assert.equal(chunks.length, 1);
    assert.match(chunks[0]!, /id: .*\nevent: error\ndata: .*first.*\n\n/);
    publish({ type: "error", at: 2, message: "second" });
    assert.equal(chunks.length, 1);
    blocked = false;
    res.emit("drain");
    assert.equal(chunks.length, 2);
    assert.match(chunks[1]!, /second/);
    blocked = true;
    for (let i = 0; i < 53; i++) publish({ type: "error", at: i, message: "burst" });
    assert.equal(hub.count(), 0);
    assert.equal(res.destroyed, true);
  } finally {
    hub.close();
  }
});
