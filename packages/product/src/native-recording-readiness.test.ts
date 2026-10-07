import assert from "node:assert/strict";
import test from "node:test";
import { createRelayRecordingOutcomeJobs } from "@relay/workflows/recording-outcomes";
import { createScriptedRelayClient } from "@relay/workflows/testing";
import { createProductRecordingJourney } from "./recording-journey.js";

test("current iOS pixels with unavailable recording control offer explicit native recovery before input", async () => {
  const scripted = createScriptedRelayClient([
    {
      id: "target.devices.list",
      output: {
        devices: [
          {
            id: "private-ipad",
            serial: "private-ipad",
            name: "iPad",
            platform: "ios",
            kind: "Physical device",
            booted: true,
            readiness: {
              previewPixels: {
                mode: "pixels",
                state: "proven",
                freshness: "current",
                proof: { at: 1 },
              },
              semanticControl: {
                mode: "accessibility",
                state: "unavailable",
                freshness: "unproven",
                reason: "probe-failed",
              },
              evidenceCapture: {
                mode: "evidence",
                state: "proven",
                freshness: "current",
                proof: { at: 1 },
              },
            },
          },
        ],
      },
    },
  ]);
  const journey = createProductRecordingJourney({
    jobs: createRelayRecordingOutcomeJobs(scripted.client, { actorId: "agent:fixture" }),
  });
  const state = await journey.connect({ targetKind: "device", targetId: "private-ipad" });
  assert.equal(state.recovery?.sourceCode, "native-recording-target-not-ready");
  assert.equal(state.recovery?.title, "Device needs reconnecting");
  assert.match(
    state.recovery?.detail ?? "",
    /show the screen, but recording control is unavailable/u,
  );
  assert.equal(state.recovery?.retryable, false);
  assert.doesNotMatch(
    JSON.stringify(state.recovery),
    /private-ipad|XCTest|UiAutomation|Something went wrong/u,
  );
  assert.equal(state.targets.length, 0);
  assert.equal(state.selectedTarget, undefined);
  assert.deepEqual(
    scripted.invocations.map((call) => call.id),
    ["target.devices.list"],
  );
  assert.deepEqual(scripted.invocations[0]?.input, {
    targetKind: "device",
    targetId: "private-ipad",
  });
});
