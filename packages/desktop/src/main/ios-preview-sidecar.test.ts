import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  type IosPreviewSidecarFileSystem,
  preflightBundledIosPreviewProducer,
} from "./ios-preview-sidecar.ts";

function machO(arch: "arm64" | "x64"): Buffer {
  const output = Buffer.alloc(16);
  output.writeUInt32LE(0xfeedfacf, 0);
  output.writeUInt32LE(arch === "arm64" ? 0x0100000c : 0x01000007, 4);
  return output;
}

function checksum(contents: Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}

function fixture(
  options: { arch?: "arm64" | "x64"; corrupt?: boolean; missingSource?: boolean } = {},
): IosPreviewSidecarFileSystem {
  const arch = options.arch ?? "arm64";
  const binary = machO(arch);
  const files = new Map<string, Buffer>([
    ["/Relay.app/Contents/Resources/ios-preview/relay-ios-preview", binary],
  ]);
  const manifest = {
    schemaVersion: 1,
    kind: "relay.safe-ios-preview-sidecar",
    platform: "darwin",
    ...(options.missingSource
      ? {}
      : {
          source: {
            module: "github.com/relay/ios-preview-producer",
            sourceSha256: "a".repeat(64),
            goModSha256: "b".repeat(64),
            goSumSha256: "c".repeat(64),
            goIosVersion: "v1.2.2-0.20260805152531-ebec9a0b076c",
          },
        }),
    artifacts: [
      {
        platform: "darwin",
        arch,
        path: "relay-ios-preview",
        buildBytes: binary.byteLength,
        buildSha256: options.corrupt ? "different" : checksum(binary),
      },
    ],
  };
  files.set(
    "/Relay.app/Contents/Resources/ios-preview/manifest.json",
    Buffer.from(JSON.stringify(manifest)),
  );
  return {
    readFile(path) {
      const contents = files.get(path);
      if (!contents) throw new Error(`missing ${path}`);
      return contents;
    },
    access(path) {
      if (!files.has(path)) throw new Error(`missing ${path}`);
    },
  };
}

const testSignatureVerifier = () => {};

test("preflight accepts only the matching reviewed native sidecar", () => {
  assert.deepEqual(
    preflightBundledIosPreviewProducer({
      resourcesPath: "/Relay.app/Contents/Resources",
      arch: "arm64",
      filesystem: fixture(),
      signatureVerifier: testSignatureVerifier,
    }),
    {
      ready: true,
      path: "/Relay.app/Contents/Resources/ios-preview/relay-ios-preview",
    },
  );
});

test("preflight fails closed when a packaged sidecar's build provenance is malformed", () => {
  const result = preflightBundledIosPreviewProducer({
    resourcesPath: "/Relay.app/Contents/Resources",
    arch: "arm64",
    filesystem: fixture({ corrupt: true }),
    signatureVerifier: testSignatureVerifier,
  });
  assert.equal(result.ready, false);
  if (!result.ready) {
    assert.match(result.reason, /native arm64 macOS artifact is missing or malformed/i);
    assert.match(result.reason, /will not download, build, or replace/i);
  }
});

test("preflight fails closed when the signed app seal or sidecar signature is invalid", () => {
  const result = preflightBundledIosPreviewProducer({
    resourcesPath: "/Relay.app/Contents/Resources",
    arch: "arm64",
    filesystem: fixture(),
    signatureVerifier: () => {
      throw new Error("macOS signature verification failed");
    },
  });
  assert.equal(result.ready, false);
  if (!result.ready) {
    assert.match(result.reason, /macOS signature verification failed/i);
    assert.match(result.reason, /will not download, build, or replace/i);
  }
});

test("preflight rejects a sidecar built for a different macOS target", () => {
  const result = preflightBundledIosPreviewProducer({
    resourcesPath: "/Relay.app/Contents/Resources",
    arch: "x64",
    filesystem: fixture({ arch: "arm64" }),
    signatureVerifier: testSignatureVerifier,
  });
  assert.equal(result.ready, false);
  if (!result.ready) {
    assert.match(result.reason, /native x64 macOS artifact is missing or malformed/i);
  }
});

test("preflight requires source provenance as well as a matching native binary", () => {
  const result = preflightBundledIosPreviewProducer({
    resourcesPath: "/Relay.app/Contents/Resources",
    arch: "arm64",
    filesystem: fixture({ missingSource: true }),
    signatureVerifier: testSignatureVerifier,
  });
  assert.equal(result.ready, false);
  if (!result.ready) {
    assert.match(result.reason, /provenance manifest is not recognized/i);
  }
});

test("preflight declines unsupported macOS CPU architectures without a fallback", () => {
  const result = preflightBundledIosPreviewProducer({
    resourcesPath: "/Relay.app/Contents/Resources",
    arch: "ia32",
    filesystem: fixture(),
    signatureVerifier: testSignatureVerifier,
  });
  assert.deepEqual(result, {
    ready: false,
    path: "/Relay.app/Contents/Resources/ios-preview/relay-ios-preview",
    reason: "Relay's built-in iOS preview supports macOS arm64 and x64, not ia32.",
  });
});
