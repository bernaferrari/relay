import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import {
  captureReviewSlotId,
  compileBrowserEnvironment,
  formatCaptureReviewCoverageSummary,
  resolveCaptureReviewQueue,
} from "@relay/protocol";
import { createAppMapTestExecutionIntent } from "./app-map-test-execution-intent.js";
import {
  applyCaptureReviewDecision,
  captureReviewQueueForRun,
  CaptureReviewError,
  reviewPersistedCapture,
} from "./capture-review.js";
import { captureReviewQueueForPlan } from "./capture-review-plan.js";
import { exportCombineEvidencePack } from "./combine-evidence-pack.js";
import type { Device } from "./device.js";
import { compileAppMapTest } from "./map-work.js";
import { preflightCompiledAppMapTestOffline } from "./offline-test-preflight.js";
import { persistRun, readCompletedPersistedRun, runsRoot } from "./runs.js";
import {
  SEEDED_MEMBER_BROWSER_ENVIRONMENT,
  SEEDED_MEMBER_CAPTURE_LANGUAGE_CAPTION,
  SEEDED_MEMBER_CAPTURE_LANGUAGE_PHASE,
  SEEDED_MEMBER_CAPTURE_LOOK_FOR,
  SEEDED_MEMBER_CAPTURE_SETTINGS_PHASE,
  SEEDED_MEMBER_CAPTURE_STEP_ID,
  SEEDED_MEMBER_CAPTURE_TEST_ID,
  SEEDED_MEMBER_TARGET_ID,
  buildSeededMemberAppMap,
  seededMemberCaptureConfigurations,
  seededMemberCaptureReviewTest,
} from "./seeded-member-acceptance.js";
import { runRecipeSteps, type TestJob } from "./session.js";
import { runWithTargetContext } from "./target-context.js";
import { getVisualBaseline } from "./visual-baselines.js";
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

    const missingRun = {
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
    };
    const missing = captureReviewQueueForRun(missingRun);
    assert.equal(missing.items[0]?.status, "missing");
    assert.throws(
      () =>
        applyCaptureReviewDecision(missingRun, {
          captureId: missing.items[0]!.captureId,
          action: "accept",
          actor: { id: "human:maria", kind: "human" },
        }),
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

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function seededSettingsDevice(png: Buffer): Device {
  const nodes = [
    {
      role: "link",
      identifier: "open-settings",
      label: "Settings",
      hittable: true,
      enabled: true,
      visibleToUser: true,
      rect: { x: 20, y: 80, width: 120, height: 32 },
    },
    {
      role: "heading",
      label: "Workspace settings",
      visibleToUser: true,
      rect: { x: 20, y: 40, width: 280, height: 32 },
    },
    {
      role: "text",
      identifier: "team-seats",
      label: "4",
      visibleToUser: true,
      rect: { x: 20, y: 140, width: 80, height: 24 },
    },
  ];
  return {
    interactions: {
      find: () => Promise.resolve({}),
      press: () => Promise.resolve({}),
      longPress: () => Promise.resolve({}),
      fill: () => Promise.resolve({}),
      type: () => Promise.resolve({}),
      swipe: () => Promise.resolve({}),
      scroll: () => Promise.reject(new Error("scroll unavailable")),
      pan: () => Promise.resolve({}),
    },
    command: { wait: () => Promise.resolve({}), back: () => Promise.resolve({}) },
    capture: {
      snapshot: () => Promise.resolve({ nodes }),
      screenshot: async (options?: { path?: string }) => {
        if (options?.path) await writeFile(options.path, png);
        return {
          capturedAt: Date.now(),
          mime: "image/png",
          base64: png.toString("base64"),
          bytes: png.length,
        };
      },
    },
  } as unknown as Device;
}

test(
  "seeded capture-review product path persists planned slots across restart and export",
  { timeout: 60_000 },
  async (t) => {
    const previousKey = process.env.OPENROUTER_API_KEY;
    const previousRuns = process.env.RELAY_RUNS_DIR;
    const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
    delete process.env.OPENROUTER_API_KEY;
    const root = await mkdtemp(join(tmpdir(), "relay-seeded-capture-product-"));
    process.env.RELAY_RUNS_DIR = join(root, "runs");
    process.env.RELAY_WORKSPACE_ROOT = root;
    const { server, url } = await listenSeededMemberApp({ defect: true });
    let png = TINY_PNG;
    try {
      try {
        await access(CHROME);
        const browser = await chromium.launch({ executablePath: CHROME, headless: true });
        try {
          const context = await browser.newContext({
            viewport: { width: 900, height: 600 },
            locale: "en-US",
          });
          await context.addCookies([
            {
              name: SEEDED_MEMBER_SESSION_COOKIE,
              value: mintSeededMemberSession("member"),
              url,
            },
          ]);
          const page = await context.newPage();
          await page.goto(new URL("/settings", url).href, { waitUntil: "networkidle" });
          await page.locator("#save-settings").waitFor();
          png = await page.screenshot({ type: "png" });
          await context.close();
        } finally {
          await browser.close();
        }
      } catch (error) {
        if (process.env.GOLDEN_ACCEPTANCE_MODE === "required" || process.env.RELAY_TEST_CHROME_PATH) {
          throw error;
        }
        t.diagnostic(
          `product path uses fixture PNG; Chrome unavailable: ${error instanceof Error ? error.message : error}`,
        );
      }

      const map = buildSeededMemberAppMap({
        memberFixtureReference: "authfx:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:1",
        adminFixtureReference: "authfx:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:1",
      });
      const scenario = seededMemberCaptureReviewTest({ sequencePhases: true });
      map.tests[SEEDED_MEMBER_CAPTURE_TEST_ID] = scenario;
      const compiled = compileAppMapTest(map, scenario);
      const planned = compiled.plan.plannedSlots ?? [];
      assert.equal(planned.length, 2);
      assert.deepEqual(
        planned.map((slot) => slot.phase),
        [SEEDED_MEMBER_CAPTURE_SETTINGS_PHASE, SEEDED_MEMBER_CAPTURE_LANGUAGE_PHASE],
      );
      assert.equal(planned[0]?.checkpointId, SEEDED_MEMBER_CAPTURE_STEP_ID);
      assert.equal(planned[1]?.caption, SEEDED_MEMBER_CAPTURE_LANGUAGE_CAPTION);
      const intent = createAppMapTestExecutionIntent({
        plan: compiled.plan,
        recipeGraph: compiled.graph,
        preflight: preflightCompiledAppMapTestOffline(compiled.plan),
      });
      assert.equal(intent.plan.plannedSlots?.length, 2);

      const at = Date.now();
      const batchId = "seeded-member-capture-review";
      const job = {
        id: "seeded-capture-product",
        action: compiled.root.id,
        title: scenario.name,
        platform: "browser",
        targetKind: "browser",
        browserTargetId: SEEDED_MEMBER_TARGET_ID,
        browserCaseProfile: compileBrowserEnvironment(SEEDED_MEMBER_BROWSER_ENVIRONMENT),
        targetContext: {
          kind: "browser",
          platform: "browser",
          targetId: SEEDED_MEMBER_TARGET_ID,
        },
        status: "running",
        queuedAt: at,
        startedAt: at,
        attempts: 1,
        logs: [],
        steps: [],
        frames: [],
        glyphs: [],
        kind: "Replay",
        tone: "acc",
        artifacts: [{ kind: "app-map-test-execution-intent", capturedAt: at, data: intent }],
        recipeId: compiled.root.id,
        recipeSnapshot: compiled.root,
        recipeGraph: compiled.graph,
        resolvedInputs: { account: "Member" },
        evidencePolicy: { schemaVersion: 1, sensitive: {} },
        batchId,
        caseIndex: 0,
      } as unknown as TestJob;

      await runWithTargetContext(
        { kind: "browser", platform: "browser", targetId: SEEDED_MEMBER_TARGET_ID },
        () =>
          runRecipeSteps(
            job,
            seededSettingsDevice(png),
            () => {},
            () => {},
          ),
      );
      job.status = "ok";
      job.finishedAt = Date.now();
      const persisted = await persistRun(job);
      const reviews = persisted.artifacts.filter((item) => item.kind === "capture-review");
      assert.equal(reviews.length, 1);
      const captured = reviews[0]?.data as { slotId?: string; phase?: string; imageSha256?: string };
      assert.equal(captured.phase, SEEDED_MEMBER_CAPTURE_SETTINGS_PHASE);
      assert.equal(captured.slotId, captureReviewSlotId(planned[0]!));
      assert.equal(typeof captured.imageSha256, "string");

      const queue = captureReviewQueueForRun(persisted);
      assert.equal(queue.summary.captured, 1);
      assert.equal(queue.summary.missing, 1);
      assert.equal(queue.summary.pending, 1);
      assert.equal(
        queue.items.find((item) => item.phase === SEEDED_MEMBER_CAPTURE_LANGUAGE_PHASE)?.status,
        "missing",
      );
      const planQueue = captureReviewQueueForPlan([persisted]);
      assert.equal(planQueue.summary.planned, 2);
      assert.equal(planQueue.summary.captured, 1);
      assert.equal(planQueue.summary.missing, 1);

      const capturedItem = queue.items.find((item) => item.status === "pending");
      const missingItem = queue.items.find((item) => item.status === "missing");
      assert.ok(capturedItem);
      assert.ok(missingItem);
      await assert.rejects(
        () =>
          reviewPersistedCapture(runsRoot(), persisted, {
            captureId: capturedItem.captureId,
            action: "accept",
            actor: { id: "agent:cursor", kind: "agent" },
            imageSha256: capturedItem.imageSha256,
          }),
        (error: unknown) =>
          error instanceof CaptureReviewError && error.code === "CAPTURE_REVIEW_ACTOR_REQUIRED",
      );
      await assert.rejects(
        () =>
          reviewPersistedCapture(runsRoot(), persisted, {
            captureId: missingItem.captureId,
            action: "accept",
            actor: { id: "human:maria", kind: "human" },
          }),
        (error: unknown) =>
          error instanceof CaptureReviewError && error.code === "CAPTURE_REVIEW_MISSING",
      );
      const accepted = await reviewPersistedCapture(runsRoot(), persisted, {
        captureId: capturedItem.captureId,
        action: "accept",
        actor: { id: "human:maria", kind: "human" },
        imageSha256: capturedItem.imageSha256,
      });
      assert.equal(accepted.run.outcome, persisted.outcome);
      assert.equal(accepted.queue.summary.accepted, 1);
      assert.equal(accepted.queue.summary.missing, 1);
      assert.equal(
        await getVisualBaseline(runsRoot(), compiled.root.id, SEEDED_MEMBER_TARGET_ID),
        null,
      );

      const reloaded = await readCompletedPersistedRun(accepted.run.dir);
      assert.ok(reloaded, "capture-review decisions must survive a run-store reload");
      const restarted = captureReviewQueueForRun(reloaded);
      assert.equal(restarted.summary.accepted, 1);
      assert.equal(restarted.summary.missing, 1);
      assert.equal(restarted.summary.pending, 0);
      assert.equal(
        restarted.items.find((item) => item.phase === SEEDED_MEMBER_CAPTURE_LANGUAGE_PHASE)?.status,
        "missing",
      );

      const pack = await exportCombineEvidencePack({
        batchId,
        jobs: [{ ...reloaded, runDir: reloaded.dir, title: scenario.name }],
        title: scenario.name,
      });
      const html = await readFile(join(pack.rootDir, "index.html"), "utf8");
      const readme = await readFile(join(pack.rootDir, "README.md"), "utf8");
      const coverage = formatCaptureReviewCoverageSummary(
        captureReviewQueueForPlan([reloaded]).summary,
      );
      assert.match(html, new RegExp(coverage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
      assert.doesNotMatch(html, /runs passed/u);
      assert.doesNotMatch(html, /\d+ tests passed/u);
      assert.match(html, /Looks correct does not approve a visual baseline/u);
      assert.match(html, /pending review/u);
      assert.match(readme, /planned \/ captured \/ blocked \+ pending review/u);
      assert.doesNotMatch(readme, /runs passed/u);
    } finally {
      if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousKey;
      if (previousRuns === undefined) delete process.env.RELAY_RUNS_DIR;
      else process.env.RELAY_RUNS_DIR = previousRuns;
      if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
      else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(root, { recursive: true, force: true });
    }
  },
);
