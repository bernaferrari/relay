import assert from "node:assert/strict";
import test from "node:test";
import { parseAndroidApplicationLabels } from "./android-app-inventory.js";

function outputFor(payload: string, chunkBytes = 2048): string {
  const bytes = Buffer.from(payload);
  const count = Math.ceil(bytes.length / chunkBytes);
  const statuses: string[] = [];
  for (let index = 0; index < count; index += 1) {
    statuses.push(
      "INSTRUMENTATION_STATUS: relayProtocol=relay-android-app-inventory-v1",
      "INSTRUMENTATION_STATUS: outputFormat=application-labels-json",
      `INSTRUMENTATION_STATUS: chunkIndex=${index}`,
      `INSTRUMENTATION_STATUS: chunkCount=${count}`,
      `INSTRUMENTATION_STATUS: payloadBase64=${bytes.subarray(index * chunkBytes, (index + 1) * chunkBytes).toString("base64")}`,
      "INSTRUMENTATION_STATUS_CODE: 1",
    );
  }
  return [
    ...statuses,
    "INSTRUMENTATION_RESULT: relayProtocol=relay-android-app-inventory-v1",
    "INSTRUMENTATION_RESULT: outputFormat=application-labels-json",
    "INSTRUMENTATION_RESULT: ok=true",
    "INSTRUMENTATION_CODE: 0",
  ].join("\n");
}

test("reassembles chunked UTF-8 labels without confusing package identity", () => {
  const labels = parseAndroidApplicationLabels(
    outputFor(
      JSON.stringify([
        { package: "com.example.notes", name: "ملاحظات" },
        { package: "com.facebook.katana", name: "Facebook" },
      ]),
      17,
    ),
  );
  assert.deepEqual(
    labels,
    new Map([
      ["com.example.notes", "ملاحظات"],
      ["com.facebook.katana", "Facebook"],
    ]),
  );
});

test("rejects unavailable, incomplete, mismatched, malformed, or failed instrumentation", () => {
  const output = outputFor('[{"package":"com.example.notes","name":"Notes"}]');
  for (const invalid of [
    "INSTRUMENTATION_FAILED: unable to find instrumentation info",
    output.replace("chunkCount=1", "chunkCount=2"),
    output.replace("chunkIndex=0", "chunkIndex=2"),
    output.replaceAll("relay-android-app-inventory-v1", "other-protocol"),
    output.replaceAll("application-labels-json", "uiautomator-xml"),
    output.replace("ok=true", "ok=false"),
    output.replace("INSTRUMENTATION_CODE: 0", "INSTRUMENTATION_CODE: 1"),
    output.replace("INSTRUMENTATION_CODE: 0", ""),
    outputFor("not JSON"),
    outputFor("{}"),
    output.replace("payloadBase64=", "payloadBase64=!"),
    output.replace("chunkCount=1", "chunkCount=257"),
    outputFor(JSON.stringify([{ package: "com.example.notes", name: "x".repeat(2100) }]), 4096),
  ])
    assert.equal(parseAndroidApplicationLabels(invalid), undefined);
});

test("invalid or ambiguous labels cannot replace a valid fallback", () => {
  const labels = parseAndroidApplicationLabels(
    outputFor(
      JSON.stringify([
        { package: "com.example.good", name: "  Good \n App  " },
        { package: "com.example.blank", name: " " },
        { package: "com.example.internal", name: "com.example.internal" },
        { package: "com.example.control", name: "Invalid\u0000Name" },
        { package: "com.example.long", name: "x".repeat(257) },
        { package: "-invalid.package", name: "Invalid" },
        { package: "com.example.bad/name", name: "Invalid" },
        { package: "com.example.duplicate", name: "One" },
        { package: "com.example.duplicate", name: "Two" },
        null,
        { package: "com.example.invalid", name: 5 },
      ]),
    ),
  );
  assert.deepEqual(labels, new Map([["com.example.good", "Good App"]]));
});
