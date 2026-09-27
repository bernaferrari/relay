import assert from "node:assert/strict";
import test from "node:test";
import type { TracePackExportResponse } from "@relay/protocol";
import { runEvidenceExportDocument, walkthroughExportDocument } from "./run-evidence-export.js";

const digest = `sha256:${"a".repeat(64)}`;

function exported(runId: string, options: { digest?: string } = {}): TracePackExportResponse {
  const packDigest = options.digest ?? digest;
  return {
    tracePack: {
      schemaVersion: 1,
      kind: "relay-trace-pack",
      digest: packDigest,
      createdAt: 1,
      source: {
        runId,
        runSchemaVersion: 5,
        status: "ok",
        action: "test",
        inputDigest: "b".repeat(64),
        writtenAt: 1,
      },
      redaction: { status: "applied-at-persistence", redactedChannels: [] },
      completeness: { status: "complete", channels: {}, missing: [], artifacts: [] },
      objects: [
        {
          path: "run.json",
          kind: "frozen-run",
          mediaType: "application/json",
          encoding: "json",
          digest: packDigest,
          bytes: 2,
          content: {},
        },
      ],
    },
    analysis: {
      schemaVersion: 1,
      mode: "trace-pack-offline-analysis",
      tracePackDigest: packDigest,
      sourceRunId: runId,
      historicalVerdict: "failed",
      futureTransitionVerdict: "unknown",
      proved: [],
      unknown: [
        {
          code: "MISSING_EVIDENCE",
          statement: "The fixture has no verified future-device claim.",
          resolution: "Replay the frozen Test on the intended target.",
        },
      ],
      smallestLiveVerification: {
        kind: "replay-frozen-test",
        reason: "Offline export cannot prove a later device.",
        requiresTarget: true,
      },
    },
  };
}

test("run evidence export keeps the requested Run identity on the file", () => {
  const document = runEvidenceExportDocument("run-184", exported("run-184"));
  assert.equal(document.fileName, "relay-run-run-184.json");
  assert.equal(document.digest, digest);
  const parsed = JSON.parse(document.body) as TracePackExportResponse;
  assert.equal(parsed.tracePack.source.runId, "run-184");
  assert.equal(parsed.analysis.sourceRunId, "run-184");
  assert.equal(parsed.analysis.futureTransitionVerdict, "unknown");
});

test("run evidence export rejects a TracePack from a different Run", () => {
  assert.throws(
    () => runEvidenceExportDocument("run-184", exported("run-from-test-B")),
    /different Run/u,
  );
});

test("run evidence export rejects analysis that does not match the pack digest", () => {
  const result = exported("run-184");
  result.analysis.tracePackDigest = `sha256:${"c".repeat(64)}`;
  assert.throws(() => runEvidenceExportDocument("run-184", result), /different evidence digest/u);
});

test("walkthrough export keeps the requested Run and rejects a different pack", () => {
  const pack = {
    pack: {
      schemaVersion: 1 as const,
      kind: "relay-walkthrough-pack" as const,
      digest,
      manifest: {
        schemaVersion: 1 as const,
        pinned: {
          appMapId: "map",
          appMapRevision: 1,
          runIds: ["run-184", "run-admin"],
          generatedAt: 1,
        },
        states: [
          { id: "home", title: "Home" },
          { id: "settings", title: "Settings <script>" },
        ],
        variants: [{ id: "member", label: "Firefox · Member" }],
        captures: [
          {
            stateId: "home",
            variantId: "member",
            runId: "run-184",
            framePath: "frames/001.png",
            caption: "Home",
          },
          {
            stateId: "home",
            variantId: "admin",
            runId: "run-admin",
            framePath: "frames/003.png",
            caption: "Admin home",
          },
          {
            stateId: "settings",
            variantId: "member",
            runId: "run-184",
            framePath: "frames/002.png",
            imageSha256: "c".repeat(64),
            caption: "Settings",
            capturedAt: 2,
          },
        ],
        connections: [
          {
            kind: "recorded",
            label: "Open settings",
            fromStateId: "home",
            toStateId: "settings",
            provenance: { runId: "run-184" },
            hotspot: { rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 } },
          },
          {
            kind: "authored",
            label: "Open language",
            fromStateId: "home",
            toStateId: "language",
          },
          {
            kind: "recorded",
            label: "Open missing",
            fromStateId: "home",
            toStateId: "language",
            provenance: { runId: "run-184" },
          },
          {
            kind: "recorded",
            label: "Admin only",
            fromStateId: "home",
            toStateId: "settings",
            provenance: { runId: "run-other" },
          },
          {
            kind: "suggested",
            label: "Guess settings",
            fromStateId: "home",
            toStateId: "settings",
            provenance: { runId: "run-184" },
            hotspot: { point: { x: 0.8, y: 0.8 } },
          },
          {
            kind: "authored",
            label: "Open help",
            fromStateId: "home",
            toStateId: "settings",
            hotspot: { point: { x: 0.9, y: 0.9 } },
          },
        ],
        missing: [
          {
            variantId: "admin",
            stateId: "settings",
            reason: "Arabic compact was not captured",
          },
          {
            variantId: "signed-out",
            stateId: "home",
            reason: "Signed out was not captured",
          },
        ],
        findings: [
          {
            runId: "run-184",
            captureId: `frames/002.png::${"c".repeat(64)}`,
            action: "accept",
            decidedAt: 1,
            decidedBy: "QA <lead>",
            reviewVersion: 1,
          },
          {
            runId: "run-184",
            captureId: `frames/002.png::${"c".repeat(64)}`,
            action: "issue",
            note: "Save overlaps <b>the description",
            decidedAt: 3,
            decidedBy: "QA <lead>",
            reviewVersion: 2,
          },
        ],
      },
      frames: [
        {
          runId: "run-184",
          framePath: "frames/001.png",
          imageSha256: "b".repeat(64),
          content: "aW1hZ2U=",
        },
        {
          runId: "run-184",
          framePath: "frames/002.png",
          imageSha256: "c".repeat(64),
          content: "dGFtcGVy",
        },
      ],
    },
  };
  const document = walkthroughExportDocument("run-184", pack);
  assert.match(
    document.body,
    /Current review · issue · Save overlaps &lt;b&gt;the description · QA &lt;lead&gt; · v2 · 1970-01-01T00:00:00.003Z[\s\S]*Earlier review · accept · QA &lt;lead&gt; · v1 · 1970-01-01T00:00:00.001Z/u,
  );
  assert.equal(document.body.includes("data:image/png;base64,"), false);
  assert.match(document.body, /A downloaded copy cannot be recalled/u);
  assert.equal(document.body.includes("dGFtcGVy"), false);
  assert.equal(document.body.includes("aW1hZ2U="), false);
  assert.match(
    document.body,
    /This recorded frame was not embedded because its bytes do not match the recorded digest\./u,
  );
  assert.match(document.body, new RegExp(`Image ${"c".repeat(64)}`));
  assert.match(document.body, /Recorded · Firefox · Member/u);
  assert.match(document.body, /Not captured · signed-out · Settings &lt;script&gt;/u);
  assert.match(
    document.body,
    /Authored · Open language · destination not captured in this configuration/u,
  );
  assert.match(
    document.body,
    /Recorded · Open missing · destination not captured in this configuration/u,
  );
  assert.match(document.body, /Suggested · Guess settings/u);
  assert.equal(document.body.includes("left:80%"), false);
  assert.equal(document.body.includes("Recorded · Guess settings"), false);
  assert.equal(document.body.includes("Admin only"), false);
  assert.match(document.body, new RegExp(`Image ${"c".repeat(64)}`));
  assert.match(document.body, /href="#capture-2">Recorded · Open settings/u);
  assert.match(document.body, /id="capture-2"[\s\S]*href="#capture-0">Back/u);
  assert.match(document.body, /href="#capture-0">Firefox · Member · issue/u);
  assert.match(document.body, /href="#capture-1">admin · missing Settings &lt;script&gt;<\/a>/u);
  assert.match(document.body, /signed-out · missing Home/u);
  assert.match(document.body, /Not captured · signed-out · Settings &lt;script&gt;/u);
  assert.match(
    document.body,
    /Missing · admin · Settings &lt;script&gt; · Arabic compact was not captured/u,
  );
  assert.match(document.body, /id="capture-2"[\s\S]*href="#capture-0">Back/u);
  assert.match(
    document.body,
    /class="hotspot region" style="left:10%;top:20%;width:30%;height:40%;"/u,
  );
  assert.match(document.body, /Settings &lt;script&gt;/u);
  assert.match(
    document.body,
    /Pinned · map · revision 1 · run-184, run-admin · 1970-01-01T00:00:00.001Z/u,
  );
  assert.match(document.body, /Recorded · Firefox · Member · 1970-01-01T00:00:00.002Z/u);
  assert.match(
    document.body,
    /Current review · issue · Save overlaps &lt;b&gt;the description · QA &lt;lead&gt; · v2 · 1970-01-01T00:00:00.003Z[\s\S]*Earlier review · accept · QA &lt;lead&gt; · v1 · 1970-01-01T00:00:00.001Z/u,
  );
  assert.match(document.body, /href="#capture-0">Back/u);
  assert.match(document.body, /Authored · Open help/u);
  assert.equal(document.body.includes("left:90%"), false);
  assert.equal(document.body.includes("<script"), false);
});
