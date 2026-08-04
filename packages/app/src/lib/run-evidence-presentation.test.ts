import assert from "node:assert/strict";
import test from "node:test";
import type { EvidenceChannelRecord } from "@relay/protocol";
import { evidenceChannelIsInspectable, evidenceChannelNote } from "./run-evidence-presentation";

function channel(status: EvidenceChannelRecord["status"]): EvidenceChannelRecord {
  return {
    channel: "network",
    status,
    entries: 0,
    bytes: 0,
    dropped: 0,
    redactions: 0,
  };
}

test("collector controls appear only when evidence can be inspected", () => {
  assert.equal(evidenceChannelIsInspectable(channel("captured"), 0), true);
  assert.equal(evidenceChannelIsInspectable(channel("partial"), 0), true);
  assert.equal(evidenceChannelIsInspectable(channel("unsupported"), 0), false);
  assert.equal(evidenceChannelIsInspectable(channel("denied"), 0), false);
  assert.equal(evidenceChannelIsInspectable(channel("failed"), 1), true);
  assert.equal(evidenceChannelIsInspectable(undefined, 0, true), true);
});

test("collector notes describe unavailable evidence without pretending it was captured", () => {
  assert.equal(
    evidenceChannelNote(channel("unsupported")),
    "This target does not support this collector.",
  );
  assert.equal(
    evidenceChannelNote(channel("denied")),
    "Workspace policy did not allow this evidence.",
  );
  assert.equal(evidenceChannelNote(channel("captured")), "0 entries captured");
  assert.equal(
    evidenceChannelNote({ ...channel("failed"), message: "ADB collector exited early" }),
    "ADB collector exited early",
  );
});
