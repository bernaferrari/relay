import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import type { ReviewInboxResult } from "@relay/protocol";
import {
  changeLabel,
  inlineImage,
  inlineImageProtocol,
  isInteractiveReview,
  runInteractiveReview,
} from "./review-command.js";

const inbox: ReviewInboxResult = {
  runsConsidered: 1,
  totals: { captured: 2, missing: 0, pending: 2, accepted: 0, issue: 0, needMoreEvidence: 0 },
  entries: [
    {
      runId: "run-1",
      title: "Checkout",
      targetName: "Chrome",
      finishedAt: 1,
      items: [
        {
          captureId: "new",
          caption: "step:x:Cart",
          status: "pending",
          reference: { state: "new", comparedAt: 1 },
        },
        {
          captureId: "changed",
          caption: "step:x:Pay",
          status: "pending",
          reference: {
            state: "changed",
            comparedAt: 1,
            changeRatio: 0.018,
            changedBounds: { x: 0.8, y: 0.05, width: 0.1, height: 0.1 },
          },
        },
      ],
    },
  ],
};

test("only bare `relay review` is interactive", () => {
  assert.equal(isInteractiveReview(["review"]), true);
  assert.equal(isInteractiveReview(["review", "--app", "shop"]), true);
  assert.equal(isInteractiveReview(["review", "list"]), false);
  assert.equal(isInteractiveReview(["run", "review"]), false);
});

test("changes are described where a person should look", () => {
  assert.equal(changeLabel(inbox.entries[0]!.items[1]!), "Changed 1.8% near the top right");
  assert.equal(changeLabel(inbox.entries[0]!.items[0]!), "New — no reference yet");
});

test("inline images follow the terminal's protocol", () => {
  assert.equal(inlineImageProtocol({ TERM_PROGRAM: "iTerm.app" }), "iterm");
  assert.equal(inlineImageProtocol({ TERM_PROGRAM: "ghostty" }), "kitty");
  assert.equal(inlineImageProtocol({ TERM_PROGRAM: "Apple_Terminal" }), undefined);
  assert.equal(
    inlineImageProtocol({ TERM_PROGRAM: "iTerm.app", RELAY_INLINE_IMAGES: "0" }),
    undefined,
  );
  assert.ok(inlineImage(Buffer.from("png"), "iterm").startsWith("\u001b]1337;File=inline=1;"));
  assert.ok(inlineImage(Buffer.from("png"), "kitty").startsWith("\u001b_Gf=100,a=T,c=80,m=0;"));
});

test("without a terminal it lists what needs review, changed first, and exits 10", async () => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let listed = "";
  stdout.on("data", (chunk) => (listed += String(chunk)));
  const code = await runInteractiveReview({
    client: { invoke: async () => inbox, download: async () => new Response("") },
    streams: { stdout, stderr },
    stdin: Object.assign(new PassThrough(), { isTTY: false }),
    env: {},
  });
  assert.equal(code, 10);
  assert.deepEqual(listed.trim().split("\n"), [
    "Checkout › Pay · Chrome · Changed 1.8% near the top right",
    "Checkout › Cart · Chrome · New — no reference yet",
  ]);
});
