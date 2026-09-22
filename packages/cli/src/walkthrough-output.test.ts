import assert from "node:assert/strict";
import test from "node:test";
import { formatWalkthroughPackResult } from "./walkthrough-output.js";

const digest = `sha256:${"a".repeat(64)}`;

test("human walkthrough output is a passive page and ordinary results stay untouched", () => {
  const html = formatWalkthroughPackResult({
    pack: {
      schemaVersion: 1,
      kind: "relay-walkthrough-pack",
      digest,
      manifest: {
        schemaVersion: 1,
        pinned: {
          appMapId: "map",
          appMapRevision: 1,
          runIds: ["run-member"],
          generatedAt: 1,
        },
        states: [{ id: "settings", title: "Settings" }],
        variants: [{ id: "member", label: "Firefox · Member" }],
        captures: [
          {
            stateId: "settings",
            variantId: "member",
            runId: "run-member",
            framePath: "frames/001.png",
          },
        ],
      },
      frames: [
        {
          runId: "run-member",
          framePath: "frames/001.png",
          imageSha256: "6105d6cc76af400325e94d588ce511be5bfdbb73b437dc51eca43917d7a43e3d",
          content: "aW1hZ2U=",
        },
      ],
    },
  });
  assert.match(html ?? "", /data:image\/png;base64,aW1hZ2U=/u);
  assert.equal(/https?:\/\//u.test(html ?? ""), false);
  assert.equal(formatWalkthroughPackResult({ tracePack: {} }), undefined);
  assert.match(html ?? "", /data:image\/png;base64,aW1hZ2U=/u);
  assert.match(html ?? "", /A downloaded copy cannot be recalled/u);
});
