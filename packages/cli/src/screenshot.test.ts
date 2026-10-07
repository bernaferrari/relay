import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { runCli } from "./index.js";
import { ExitCode } from "./errors.js";

const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const png = Buffer.from(pngBase64, "base64");
const resolution = {
  method: "label",
  point: { x: 200, y: 120 },
  bounds: { x: 180, y: 100, width: 40, height: 40 },
};

async function previewFile(metadata: Record<string, unknown>) {
  const directory = await mkdtemp(join(tmpdir(), "relay-cli-preview-"));
  const file = join(directory, "preview.png");
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let output = "";
  let errors = "";
  stdout.on("data", (chunk) => (output += String(chunk)));
  stderr.on("data", (chunk) => (errors += String(chunk)));
  const calls: unknown[] = [];
  try {
    const code = await runCli(
      [
        "target",
        "interact",
        "ipad",
        "--preview",
        "--file",
        file,
        "--input",
        '{"kind":"label","label":"Fast"}',
        "--json",
      ],
      {
        streams: { stdout, stderr },
        createClient: () => ({
          invoke: async (operationId, input) => {
            calls.push({ operationId, input });
            return {
              ok: true,
              preview: true,
              inspectable: true,
              mime: "image/png",
              base64: pngBase64,
              bytes: png.byteLength,
              ...metadata,
            };
          },
          events: async () => {},
        }),
        registerSignalHandlers: false,
        env: {},
      },
    );
    assert.equal(code, ExitCode.success, errors);
    assert.deepEqual(calls, [
      {
        operationId: "target.interact",
        input: { serial: "ipad", kind: "label", label: "Fast", preview: true },
      },
    ]);
    assert.deepEqual(await readFile(file), png);
    const lines = output.trim().split("\n");
    assert.equal(lines.length, 1, "stdout contains exactly one JSON receipt");
    const receipt = JSON.parse(lines[0]!);
    assert.equal(receipt.type, "result");
    assert.equal(receipt.ok, true);
    assert.equal(receipt.operationId, "target.interact");
    assert.equal(receipt.result.file, file);
    assert.equal(receipt.result.bytes, png.byteLength);
    assert.equal(receipt.result.mime, "image/png");
    const { file: _file, ...result } = receipt.result;
    return { result, output };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("preview --file keeps the resolved observation beside the PNG receipt", async () => {
  const { result } = await previewFile({ resolution });
  assert.deepEqual(result, {
    bytes: png.byteLength,
    mime: "image/png",
    preview: true,
    inspectable: true,
    resolution,
  });
});

test("an unmarked legacy preview retains inspection state without inventing a resolution", async () => {
  const { result } = await previewFile({ inspectable: false });
  assert.deepEqual(result, {
    bytes: png.byteLength,
    mime: "image/png",
    preview: true,
    inspectable: false,
  });
});

test("a resolved preview retains its typed state and exact observation", async () => {
  const { result } = await previewFile({ resolutionState: "resolved", resolution });
  assert.deepEqual(result, {
    bytes: png.byteLength,
    mime: "image/png",
    preview: true,
    inspectable: true,
    resolutionState: "resolved",
    resolution,
  });
});

for (const state of ["ambiguous", "unresolved", "unavailable"] as const) {
  test(`an ${state} preview file preserves its typed state without a location`, async () => {
    const inspectable = state !== "unavailable";
    const { result } = await previewFile({ resolutionState: state, inspectable });
    assert.deepEqual(result, {
      bytes: png.byteLength,
      mime: "image/png",
      preview: true,
      inspectable,
      resolutionState: state,
    });
  });
}

for (const [name, metadata] of [
  ["resolved state without a location", { resolutionState: "resolved" }],
  ["ambiguous state with a location", { resolutionState: "ambiguous", resolution }],
  [
    "ambiguous state with a malformed location",
    { resolutionState: "ambiguous", resolution: "private-location" },
  ],
  ["unresolved state with a location", { resolutionState: "unresolved", resolution }],
  ["unavailable state with a location", { resolutionState: "unavailable", resolution }],
  ["unknown state", { resolutionState: "private-state", resolution }],
  ["unknown method", { resolution: { ...resolution, method: "private-method" } }],
  ["non-finite point", { resolution: { ...resolution, point: { x: Infinity, y: 120 } } }],
  [
    "invalid bounds",
    { resolution: { ...resolution, bounds: { ...resolution.bounds, width: -1 } } },
  ],
  ["unknown activation", { resolution: { ...resolution, activation: "private-activation" } }],
] as const) {
  test(`preview file excludes invalid selection metadata: ${name}`, async () => {
    const { result, output } = await previewFile(metadata);
    assert.deepEqual(result, {
      bytes: png.byteLength,
      mime: "image/png",
      preview: true,
      inspectable: true,
    });
    assert.doesNotMatch(output, /private/u);
  });
}

test("preview file metadata excludes raw payloads and projects only resolution fields", async () => {
  const { result, output } = await previewFile({
    serial: "private-serial",
    nodes: [{ label: "private prompt", identifier: "private-control" }],
    error: "private error",
    iosSessionLifecycle: { detail: "private session" },
    resolution: {
      ...resolution,
      activation: "snapshot-point",
      secret: "private resolution",
      point: { ...resolution.point, token: "private point" },
      bounds: { ...resolution.bounds, identifier: "private bounds" },
    },
  });
  assert.deepEqual(result, {
    bytes: png.byteLength,
    mime: "image/png",
    preview: true,
    inspectable: true,
    resolution: { ...resolution, activation: "snapshot-point" },
  });
  assert.doesNotMatch(output, /private|base64|nodes|iosSessionLifecycle/u);
});
