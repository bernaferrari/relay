import assert from "node:assert/strict";
import test from "node:test";
import {
  captureReviewAdvanceIndex,
  captureReviewCoverageLine,
  captureReviewId,
  formatCaptureReviewConfiguration,
  resolveCaptureReviewQueue,
  summarizeCaptureReview,
} from "./capture-review.js";

test("arrow keys move the contact sheet without wrapping past the ends", () => {
  assert.equal(captureReviewAdvanceIndex(0, 8, "ArrowRight"), 1);
  assert.equal(captureReviewAdvanceIndex(7, 8, "ArrowRight"), 7);
  assert.equal(captureReviewAdvanceIndex(3, 8, "ArrowLeft"), 2);
  assert.equal(captureReviewAdvanceIndex(0, 8, "Home"), 0);
  assert.equal(captureReviewAdvanceIndex(2, 8, "End"), 7);
  assert.equal(captureReviewAdvanceIndex(2, 8, "Enter"), undefined);
});

test("eight intended captures stay pending until a person reviews the exact image", () => {
  const roles = ["Member", "Admin"] as const;
  const viewports = ["Desktop", "Compact"] as const;
  const languages = ["English", "Arabic"] as const;
  const artifacts = roles.flatMap((role) =>
    viewports.flatMap((viewport) =>
      languages.map((language) => {
        const caption = `${role} · ${viewport} · ${language}`;
        const framePath = `frames/${caption.replaceAll(" · ", "-").toLowerCase()}.png`;
        const imageSha256 = captureReviewId({ caption, framePath, imageSha256: "hash" }).slice(-4);
        return {
          kind: "capture-review",
          data: {
            status: "pending",
            caption,
            lookFor: "Arabic text is readable and Save is visible.",
            framePath,
            imageSha256: `${imageSha256}${caption.length}`,
            configuration: { account: role, viewport, locale: language },
          },
        };
      }),
    ),
  );
  const queue = resolveCaptureReviewQueue({ artifacts });
  assert.equal(queue.items.length, 8);
  assert.equal(new Set(queue.items.map((item) => item.caption)).size, 8);
  assert.equal(
    queue.items.every((item) => formatCaptureReviewConfiguration(item.configuration).length === 3),
    true,
  );
  assert.equal(captureReviewCoverageLine(queue.summary), "8/8 captured");
  assert.deepEqual(queue.summary, {
    captured: 8,
    missing: 0,
    pending: 8,
    accepted: 0,
    issue: 0,
    needMoreEvidence: 0,
  });
});

test("a missing screenshot stays missing and a later image does not inherit an older accept", () => {
  const first = {
    kind: "capture-review",
    data: {
      caption: "Arabic account settings",
      framePath: "frames/001.png",
      imageSha256: "aaa",
    },
  };
  const accepted = resolveCaptureReviewQueue({
    artifacts: [first],
    decisions: [
      {
        captureId: captureReviewId({
          caption: "Arabic account settings",
          framePath: "frames/001.png",
          imageSha256: "aaa",
        }),
        action: "accept",
        imageSha256: "aaa",
        decidedAt: 1,
        decidedBy: { id: "human:maria", kind: "human" },
      },
    ],
  });
  assert.equal(accepted.items[0]?.status, "accepted");

  const recaptured = resolveCaptureReviewQueue({
    artifacts: [
      {
        kind: "capture-review",
        data: {
          caption: "Arabic account settings",
          framePath: "frames/001.png",
          imageSha256: "bbb",
        },
      },
    ],
    decisions: accepted.items[0]
      ? [
          {
            captureId: accepted.items[0].captureId,
            action: "accept",
            imageSha256: "aaa",
            decidedAt: 1,
            decidedBy: { id: "human:maria", kind: "human" },
          },
        ]
      : [],
  });
  assert.equal(recaptured.items[0]?.status, "pending");
  assert.equal(recaptured.items[0]?.imageSha256, "bbb");

  const missing = resolveCaptureReviewQueue({
    recipeSteps: [
      {
        kind: "screenshot",
        caption: "Arabic account settings",
        review: { mode: "later", lookFor: "Save is visible" },
      },
    ],
  });
  assert.equal(missing.items[0]?.status, "missing");
  assert.equal(missing.summary.missing, 1);
  assert.equal(missing.summary.captured, 0);
});

test("summary never treats captured files as verified", () => {
  assert.deepEqual(
    summarizeCaptureReview([
      { captureId: "a", caption: "A", status: "pending" },
      { captureId: "b", caption: "B", status: "accepted" },
      { captureId: "c", caption: "C", status: "issue" },
      { captureId: "d", caption: "D", status: "missing" },
    ]),
    {
      captured: 3,
      missing: 1,
      pending: 1,
      accepted: 1,
      issue: 1,
      needMoreEvidence: 0,
    },
  );
  assert.equal(
    captureReviewCoverageLine({
      captured: 47,
      missing: 3,
      pending: 40,
      accepted: 5,
      issue: 2,
      needMoreEvidence: 0,
    }),
    "47/50 captured",
  );
});

test("accepting selected captures does not approve an unselected image", () => {
  const artifacts = Array.from({ length: 12 }, (_, index) => ({
    kind: "capture-review",
    data: {
      caption: `Cell ${index + 1}`,
      framePath: `frames/${String(index + 1).padStart(3, "0")}.png`,
      imageSha256: `hash-${index + 1}`,
    },
  }));
  const selected = artifacts.slice(0, 10).map((artifact) => {
    const data = artifact.data;
    return {
      captureId: captureReviewId({
        caption: data.caption,
        framePath: data.framePath,
        imageSha256: data.imageSha256,
      }),
      action: "accept" as const,
      imageSha256: data.imageSha256,
      decidedAt: 1,
      decidedBy: { id: "human:maria", kind: "human" as const },
    };
  });
  const queue = resolveCaptureReviewQueue({ artifacts, decisions: selected });
  assert.equal(queue.summary.accepted, 10);
  assert.equal(queue.summary.pending, 2);
  assert.equal(queue.items.at(-1)?.status, "pending");
  assert.equal(queue.items[0]?.status, "accepted");
});

test("a chat identity-ignore overlay stays off a later settings capture", () => {
  const queue = resolveCaptureReviewQueue({
    artifacts: [
      {
        kind: "capture-review",
        data: {
          caption: "Chat",
          framePath: "frames/001.png",
          imageSha256: "chat",
          stepId: "chat",
        },
      },
      {
        kind: "capture-review",
        data: {
          caption: "Settings",
          framePath: "frames/002.png",
          imageSha256: "settings",
          stepId: "settings",
        },
      },
      {
        kind: "identity-ignore",
        data: {
          name: "reply body",
          x: 0,
          y: 0.1,
          width: 1,
          height: 0.8,
          stepId: "chat",
          frameIndex: 0,
        },
      },
    ],
  });
  assert.equal(queue.items[0]?.masks?.length, 1);
  assert.equal(queue.items[0]?.masks?.[0]?.name, "reply body");
  assert.equal(queue.items[1]?.masks, undefined);
});
