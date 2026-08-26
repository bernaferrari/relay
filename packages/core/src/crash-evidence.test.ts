import assert from "node:assert/strict";
import test from "node:test";
import { crashLogEntryIsCandidate, parseDevicectlCrashEntries } from "./crash-evidence.js";
import { runWithTargetContext } from "./target-context.js";

test("crash-log candidates are filtered by extension and modification date", () => {
  const since = Date.parse("2026-08-01T00:00:00Z");
  assert.equal(crashLogEntryIsCandidate("MyApp-2026-08-02-120000.ips", undefined, since), true);
  assert.equal(
    crashLogEntryIsCandidate(
      "MyApp-2026-07-01-120000.ips",
      Date.parse("2026-07-01T00:00:00Z"),
      since,
    ),
    false,
    "entries older than the window must not be copied",
  );
  assert.equal(
    crashLogEntryIsCandidate(
      "MyApp-2026-07-01-120000.ips",
      Date.parse("2026-08-05T00:00:00Z"),
      since,
    ),
    true,
  );
  assert.equal(
    crashLogEntryIsCandidate("unrelated.txt", Date.parse("2026-08-05T00:00:00Z"), since),
    false,
    "non-crash files must never be pulled over the wire",
  );
});

test("devicectl JSON listings yield candidate entries with paths and dates", () => {
  const payload = JSON.stringify({
    result: {
      files: [
        {
          fileName: "Grok-2026-08-20-101010.ips",
          path: "Grok-2026-08-20-101010.ips",
          modificationDate: "2026-08-20T10:10:10Z",
        },
        { fileName: "notes.txt" },
      ],
    },
  });
  const entries = parseDevicectlCrashEntries(payload);
  assert.deepEqual(entries, [
    {
      name: "Grok-2026-08-20-101010.ips",
      path: "Grok-2026-08-20-101010.ips",
      modifiedAt: Date.parse("2026-08-20T10:10:10Z"),
    },
    { name: "notes.txt" },
  ]);
});

test("physical iOS targets go straight to devicectl instead of simctl spawn", async () => {
  const serial = "00008101-001A4D2E0E3A001E";
  await runWithTargetContext({ kind: "device", platform: "ios", serial }, async () => {
    const { captureNativeCrashEvidence } = await import("./crash-evidence.js");
    // On this host xcrun exists but no device is attached: the physical path
    // surfaces its own bounded failure, never a simctl "Invalid device"
    // round-trip.
    await assert.rejects(captureNativeCrashEvidence(Date.now() - 60_000), (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      return !/simctl|Invalid/i.test(message);
    });
  });
});
