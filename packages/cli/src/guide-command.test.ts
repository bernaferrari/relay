import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { relayTaskGuideCatalog } from "@relay/workflows/task-guides";
import { parseCli } from "./config.js";
import { parseEverydayCommand } from "./everyday-commands.js";
import { runCli } from "./index.js";
import { isInteractiveReview } from "./review-command.js";

async function guide(argv: string[]) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = "";
  let err = "";
  stdout.on("data", (chunk) => {
    out += String(chunk);
  });
  stderr.on("data", (chunk) => {
    err += String(chunk);
  });
  const code = await runCli(argv, {
    streams: { stdout, stderr },
    env: { RELAY_URL: "http://127.0.0.1:1", RELAY_CREDENTIAL_SOURCE: "env:MISSING_TOKEN" },
    createClient() {
      throw new Error("Offline guides must not create a server client");
    },
    async ensureOutcomeServer() {
      throw new Error("Offline guides must not start a server");
    },
    registerSignalHandlers: false,
  });
  return { code, out, err };
}

test("guides remain discoverable with an unavailable server and missing credentials", async () => {
  const result = await guide(["guide", "--json"]);
  assert.equal(result.code, 0);
  assert.equal(result.err, "");
  const envelope = JSON.parse(result.out);
  assert.equal(envelope.operationId, "local.guide");
  assert.equal(envelope.result.topic, "start");
  assert.deepEqual(
    envelope.result.topics.map((item: { topic: string }) => item.topic),
    relayTaskGuideCatalog.map((item) => item.topic),
  );
});

test("each task prints one machine result and its own local guidance", async () => {
  for (const item of relayTaskGuideCatalog) {
    const result = await guide(["--json", "guide", item.topic]);
    assert.equal(result.code, 0, item.topic);
    const envelope = JSON.parse(result.out);
    assert.equal(envelope.result.topic, item.topic);
    assert.ok(envelope.result.markdown.includes(item.title));
  }
});

test("guide rejects unknown topics, extra arguments, and flags that would imply remote execution", async () => {
  for (const argv of [
    ["guide", "../../secrets"],
    ["guide", "run", "extra"],
    ["guide", "--server", "http://example.test"],
    ["guide", "--confirm"],
    ["guide", "--json", "--ndjson"],
  ]) {
    const result = await guide(argv);
    assert.equal(result.code, 2);
  }
});

test("bundled command examples use the current shipped parser", () => {
  for (const guide of relayTaskGuideCatalog) {
    for (const example of guide.examples) {
      const label = `${guide.topic}: ${example.join(" ")}`;
      if (example[0] === "review") assert.ok(isInteractiveReview(example), label);
      // Everyday verbs (new, ci, ...) are checked by their own parser, which
      // throws on an unknown flag; everything else goes through parseCli.
      else if (!parseEverydayCommand(example)) {
        assert.doesNotThrow(() => parseCli(example, {}), label);
      }
    }
  }
});
