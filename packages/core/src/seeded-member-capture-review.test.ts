import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright-core";
import { captureReviewId, resolveCaptureReviewQueue } from "@relay/protocol";
import { applyCaptureReviewDecision, CaptureReviewError } from "./capture-review.js";
import {
  SEEDED_MEMBER_CAPTURE_LOOK_FOR,
  seededMemberCaptureConfigurations,
} from "./seeded-member-acceptance.js";
import {
  listenSeededMemberApp,
  mintSeededMemberSession,
  SEEDED_MEMBER_DEFECT_SEATS,
  SEEDED_MEMBER_SESSION_COOKIE,
} from "./seeded-member-app.js";

const CHROME =
  process.env.RELAY_TEST_CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

type CaptureArtifact = {
  kind: "capture-review";
  capturedAt: number;
  data: {
    caption: string;
    lookFor: string;
    framePath: string;
    imageSha256: string;
    configuration: { account: string; viewport: string; locale: string };
  };
};

function cookieHeader(token: string): string {
  return `${SEEDED_MEMBER_SESSION_COOKIE}=${token}`;
}

test("eight capture-only configurations stay pending without an AI key", async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  const { server, url, app } = await listenSeededMemberApp({ defect: true });
  try {
    const cells = seededMemberCaptureConfigurations();
    assert.equal(cells.length, 8);
    const artifacts: CaptureArtifact[] = [];
    for (const [index, cell] of cells.entries()) {
      const token = mintSeededMemberSession(cell.role);
      const settings = await fetch(new URL("/settings", url), {
        headers: {
          cookie: cookieHeader(token),
          "accept-language": cell.locale.tag,
        },
      });
      const html = await settings.text();
      assert.match(html, new RegExp(`id="session-role">${cell.role}`));
      assert.match(html, /id="save-settings"/);
      assert.match(html, /layout-defect/);
      if (cell.locale.id === "ar") {
        assert.match(html, /dir="rtl"/);
        assert.match(html, /حفظ/);
      } else {
        assert.match(html, />Save</);
      }
      if (cell.role === "member") {
        assert.match(html, new RegExp(`id="team-seats"[^>]*>${SEEDED_MEMBER_DEFECT_SEATS}`));
        assert.doesNotMatch(html, /id="manage-org"/);
      } else {
        assert.match(html, /id="manage-org"/);
      }
      const imageSha256 = createHash("sha256").update(html).digest("hex");
      artifacts.push({
        kind: "capture-review",
        capturedAt: 1,
        data: {
          caption: cell.caption,
          lookFor: cell.lookFor,
          framePath: `frames/${String(index + 1).padStart(3, "0")}.png`,
          imageSha256,
          configuration: {
            account: cell.role === "member" ? "Member" : "Admin",
            viewport: `${cell.viewport.width}×${cell.viewport.height}`,
            locale: cell.locale.tag,
          },
        },
      });
    }
    const queue = resolveCaptureReviewQueue({ artifacts });
    assert.equal(queue.items.length, 8);
    assert.equal(queue.summary.captured, 8);
    assert.equal(queue.summary.pending, 8);
    assert.equal(queue.summary.accepted, 0);
    assert.equal(
      queue.items.every((item) => item.lookFor === SEEDED_MEMBER_CAPTURE_LOOK_FOR),
      true,
    );

    const issue = applyCaptureReviewDecision(
      { artifacts, outcome: "passed", recipeSnapshot: { steps: [] } },
      {
        captureId: queue.items[0]!.captureId,
        action: "report-issue",
        actor: { id: "human:maria", kind: "human" },
        imageSha256: queue.items[0]!.imageSha256,
      },
    );
    assert.equal(issue.outcome, "passed");
    assert.equal(issue.queue.summary.issue, 1);
    assert.equal(issue.queue.summary.pending, 7);

    app.setDefect(false);
    const repairedHtml = await (
      await fetch(new URL("/settings", url), {
        headers: {
          cookie: cookieHeader(mintSeededMemberSession("member")),
          "accept-language": "en-US",
        },
      })
    ).text();
    assert.doesNotMatch(repairedHtml, /<body class="layout-defect">/);
    const recapturedSha = createHash("sha256").update(repairedHtml).digest("hex");
    const recaptured = resolveCaptureReviewQueue({
      artifacts: [
        {
          kind: "capture-review",
          data: {
            ...artifacts[0]!.data,
            imageSha256: recapturedSha,
          },
        },
      ],
      decisions: [
        {
          captureId: queue.items[0]!.captureId,
          action: "report-issue",
          imageSha256: queue.items[0]!.imageSha256,
          decidedAt: 1,
          decidedBy: { id: "human:maria", kind: "human" as const },
        },
      ],
    });
    assert.equal(recaptured.items[0]?.status, "pending");
    assert.notEqual(recaptured.items[0]?.imageSha256, queue.items[0]?.imageSha256);

    assert.throws(
      () =>
        applyCaptureReviewDecision(
          {
            artifacts: [],
            recipeSnapshot: {
              steps: [
                {
                  kind: "screenshot",
                  caption: "Missing compact Arabic",
                  review: { mode: "later" },
                },
              ],
            },
          },
          {
            captureId: captureReviewId({ caption: "Missing compact Arabic" }),
            action: "accept",
            actor: { id: "human:maria", kind: "human" },
          },
        ),
      (error: unknown) =>
        error instanceof CaptureReviewError && error.code === "CAPTURE_REVIEW_MISSING",
    );
    assert.throws(
      () =>
        applyCaptureReviewDecision(
          { artifacts, recipeSnapshot: { steps: [] } },
          {
            captureId: queue.items[1]!.captureId,
            action: "accept",
            actor: { id: "agent:cursor", kind: "agent" },
            imageSha256: queue.items[1]!.imageSha256,
          },
        ),
      (error: unknown) =>
        error instanceof CaptureReviewError && error.code === "CAPTURE_REVIEW_ACTOR_REQUIRED",
    );
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("live eight-cell screenshots keep viewport labels and the layout defect", async (t) => {
  const previous = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    await access(CHROME);
  } catch (error) {
    if (process.env.GOLDEN_ACCEPTANCE_MODE === "required" || process.env.RELAY_TEST_CHROME_PATH) {
      throw error;
    }
    t.skip(`Google Chrome is not installed: ${error instanceof Error ? error.message : error}`);
    return;
  }

  const { server, url, app } = await listenSeededMemberApp({ defect: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    const cells = seededMemberCaptureConfigurations();
    const artifacts: CaptureArtifact[] = [];
    for (const [index, cell] of cells.entries()) {
      const context = await browser.newContext({
        viewport: { width: cell.viewport.width, height: cell.viewport.height },
        locale: cell.locale.tag,
        extraHTTPHeaders: { "accept-language": cell.locale.tag },
      });
      try {
        const token = mintSeededMemberSession(cell.role);
        await context.addCookies([{ name: SEEDED_MEMBER_SESSION_COOKIE, value: token, url }]);
        const page = await context.newPage();
        await page.goto(new URL("/settings", url).href, { waitUntil: "networkidle" });
        await page.locator("#save-settings").waitFor();
        const overlap = await page.evaluate(() => {
          const save = document.getElementById("save-settings")?.getBoundingClientRect();
          const seats = document.getElementById("team-seats")?.getBoundingClientRect();
          if (!save || !seats) return false;
          return !(
            save.right <= seats.left ||
            save.left >= seats.right ||
            save.bottom <= seats.top ||
            save.top >= seats.bottom
          );
        });
        assert.equal(overlap, true, `${cell.caption} should show the overlapping Save control`);
        const png = await page.screenshot({ type: "png" });
        artifacts.push({
          kind: "capture-review",
          capturedAt: 1,
          data: {
            caption: cell.caption,
            lookFor: SEEDED_MEMBER_CAPTURE_LOOK_FOR,
            framePath: `frames/${String(index + 1).padStart(3, "0")}.png`,
            imageSha256: createHash("sha256").update(png).digest("hex"),
            configuration: {
              account: cell.role === "member" ? "Member" : "Admin",
              viewport: `${cell.viewport.width}×${cell.viewport.height}`,
              locale: cell.locale.tag,
            },
          },
        });
      } finally {
        await context.close();
      }
    }
    const queue = resolveCaptureReviewQueue({ artifacts });
    assert.equal(queue.summary.captured, 8);
    assert.equal(queue.summary.pending, 8);
    assert.equal(new Set(artifacts.map((item) => item.data.imageSha256)).size, 8);

    app.setDefect(false);
    const repaired = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "ar",
    });
    try {
      await repaired.addCookies([
        {
          name: SEEDED_MEMBER_SESSION_COOKIE,
          value: mintSeededMemberSession("member"),
          url,
        },
      ]);
      const page = await repaired.newPage();
      await page.goto(new URL("/settings", url).href, { waitUntil: "networkidle" });
      const overlap = await page.evaluate(() => {
        const save = document.getElementById("save-settings")?.getBoundingClientRect();
        const seats = document.getElementById("team-seats")?.getBoundingClientRect();
        if (!save || !seats) return false;
        return !(
          save.right <= seats.left ||
          save.left >= seats.right ||
          save.bottom <= seats.top ||
          save.top >= seats.bottom
        );
      });
      assert.equal(overlap, false);
    } finally {
      await repaired.close();
    }
  } finally {
    await browser.close();
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
