import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { compileBrowserEnvironment } from "@relay/protocol";
import { runWithTargetContext } from "../target/target-context.js";
import { deleteTarget, saveBrowserTarget } from "../target/targets.js";
import type { TestJob } from "../session/session.js";
import { acquirePreparedSessionDevice } from "../session/session-provider-execution.js";
import { closeBrowserHostPool } from "./browser-host-pool.js";
import { activePage, browserProofSessionForTarget, closeBrowserTarget } from "./browser-target.js";
import {
  dragBrowserTarget,
  switchBrowserTab,
  uploadBrowserWorkspaceFile,
} from "./browser-actuation.js";

const CHROME =
  process.env.RELAY_TEST_CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let root = "";
let server: http.Server;
let startUrl = "";

/** One fixture page exercising every verb: a pointer-events sortable, an
 * HTML5 drop zone, a keyboard-only ARIA slider, and a file input. */
const FIXTURE_HTML = `<!doctype html><html><body>
<ul id="list">
  <li><div role="button" aria-label="Card one" id="card1" tabindex="0">one</div></li>
  <li><div role="button" aria-label="Card two" id="card2" tabindex="0">two</div></li>
</ul>
<div role="button" aria-label="Drop zone" id="dropzone" tabindex="0">drop</div>
<div role="slider" aria-label="Volume" id="slider" tabindex="0"
  aria-valuenow="20" aria-valuemin="0" aria-valuemax="100">slider</div>
<input type="file" id="avatar" aria-label="Avatar">
<script>
window.pointerLog = [];
window.__lastPointer = { x: 0, y: 0 };
const card1 = document.getElementById("card1");
card1.addEventListener("pointerdown", (event) => {
  window.pointerLog.push("down");
  try { card1.setPointerCapture(event.pointerId); } catch { /* capture is best-effort */ }
});
document.addEventListener("pointermove", (event) => {
  window.__lastPointer = { x: event.clientX, y: event.clientY, buttons: event.buttons };
  if (event.buttons) window.pointerLog.push("move");
});
document.addEventListener("pointerup", (event) => {
  window.pointerLog.push("up");
  if (event.target !== card1) return;
  const drop = document.getElementById("dropzone");
  const box = drop.getBoundingClientRect();
  if (event.clientX >= box.left && event.clientX <= box.right &&
      event.clientY >= box.top && event.clientY <= box.bottom) {
    card1.closest("li").remove();
    drop.appendChild(card1);
    window.pointerLog.push("dropped");
  }
});
window.html5Drop = "none";
const html5card = document.createElement("div");
html5card.setAttribute("role", "button");
html5card.setAttribute("aria-label", "Draggable file");
html5card.id = "html5card";
html5card.textContent = "file";
html5card.draggable = true;
html5card.addEventListener("dragstart", (event) => {
  event.dataTransfer.setData("text/plain", "html5card");
  window.html5Drop = "started";
});
document.body.appendChild(html5card);
const zone = document.getElementById("dropzone");
zone.addEventListener("dragover", (event) => event.preventDefault());
zone.addEventListener("drop", (event) => {
  event.preventDefault();
  window.html5Drop = "dropped";
});
const slider = document.getElementById("slider");
// Deliberately no pointer handling: this slider is keyboard-operated only,
// so the trusted mouse drag never moves it and the fallback must.
slider.addEventListener("keydown", (event) => {
  const value = Number(slider.getAttribute("aria-valuenow"));
  if (event.key === "ArrowRight" || event.key === "ArrowUp") {
    slider.setAttribute("aria-valuenow", String(Math.min(100, value + 5)));
  } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
    slider.setAttribute("aria-valuenow", String(Math.max(0, value - 5)));
  }
});
</script>
</body></html>`;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "relay-actuation-verbs-"));
  process.env.RELAY_WORKSPACE_ROOT = root;
  await mkdir(join(root, "fixtures"), { recursive: true });
  await writeFile(join(root, "fixtures", "avatar.png"), "png-bytes");
  server = http.createServer((request, response) => {
    response.setHeader("content-type", "text/html");
    if (request.url?.startsWith("/second")) {
      response.end("<title>second tab</title>second");
      return;
    }
    response.end(FIXTURE_HTML);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  startUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await closeBrowserHostPool();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  delete process.env.RELAY_WORKSPACE_ROOT;
  await rm(root, { recursive: true, force: true });
});

async function chromeAvailable(): Promise<boolean> {
  try {
    await access(CHROME);
    return true;
  } catch {
    return false;
  }
}

let sequence = 0;

/** Open a proof session for a fresh target over the fixture server and run
 * the actuation inside its browser target context. */
async function withProofBrowser<T>(run: (fixture: { targetId: string }) => Promise<T>): Promise<T> {
  sequence += 1;
  const target = await saveBrowserTarget({
    id: `actuation-verbs-${sequence}`,
    name: "Actuation verbs fixture",
    startUrl,
    headless: true,
    environment: { viewport: { width: 900, height: 600 } },
  });
  const profile = compileBrowserEnvironment(target.browser?.environment ?? {});
  const job = {
    id: `actuation-verbs-run-${sequence}`,
    targetKind: "browser",
    browserTargetId: target.id,
    targetContext: { kind: "browser", platform: "browser", targetId: target.id },
    browserCaseProfile: profile,
    projectId: "default",
    artifacts: [],
    evidencePolicy: { schemaVersion: 1, sensitive: {} },
  } as unknown as TestJob;
  try {
    await acquirePreparedSessionDevice(
      job,
      { browserTarget: target, deviceAvailable: true },
      () => undefined,
    );
    return await runWithTargetContext(
      { kind: "browser", platform: "browser", targetId: target.id },
      () => run({ targetId: target.id }),
    );
  } finally {
    await closeBrowserTarget(target.id, { mode: "proof" }).catch(() => undefined);
    await deleteTarget(target.id).catch(() => undefined);
  }
}

test("drag drives a pointer-events reorder end to end", async (t) => {
  if (!(await chromeAvailable())) return t.skip("Google Chrome is not installed");
  await withProofBrowser(async ({ targetId }) => {
    await dragBrowserTarget({ label: "Card one" }, { label: "Drop zone" });
    const page = await activePage(await browserProofSessionForTarget(targetId));
    const log = await page.evaluate(() => (window as never as { pointerLog: string[] }).pointerLog);
    assert.ok(log.includes("down"), "the drag pressed the source");
    assert.ok(log.includes("move"), "the drag moved in steps");
    assert.ok(log.includes("dropped"), "the pointer reorder ran its drop logic");
  });
});

test("drag raises trusted HTML5 drag events", async (t) => {
  if (!(await chromeAvailable())) return t.skip("Google Chrome is not installed");
  await withProofBrowser(async ({ targetId }) => {
    await dragBrowserTarget({ label: "Draggable file" }, { label: "Drop zone" });
    const page = await activePage(await browserProofSessionForTarget(targetId));
    const state = await page.evaluate(() => (window as never as { html5Drop: string }).html5Drop);
    assert.equal(state, "dropped");
  });
});

test("a keyboard-only slider advances through the bounded fallback", async (t) => {
  if (!(await chromeAvailable())) return t.skip("Google Chrome is not installed");
  await withProofBrowser(async ({ targetId }) => {
    const page = await activePage(await browserProofSessionForTarget(targetId));
    const sliderBox = await page.locator("#slider").boundingBox();
    assert.ok(sliderBox, "the slider is visible");
    assert.equal(
      await page.locator("#slider").evaluate((element) => element.getAttribute("aria-valuenow")),
      "20",
    );
    // Drag rightward, well past the slider: the intended value is far above
    // the start, and the pointer never moves a keyboard-only slider.
    await dragBrowserTarget(
      { label: "Volume" },
      { point: { x: sliderBox!.x + sliderBox!.width + 200, y: sliderBox!.y } },
    );
    const value = await page
      .locator("#slider")
      .evaluate((element) => element.getAttribute("aria-valuenow"));
    assert.ok(Number(value) > 20, `the arrow-key fallback advanced the slider (now ${value})`);
  });
});

test("upload-file attaches a workspace file and traversal never reaches the input", async (t) => {
  if (!(await chromeAvailable())) return t.skip("Google Chrome is not installed");
  await withProofBrowser(async ({ targetId }) => {
    await uploadBrowserWorkspaceFile("fixtures/avatar.png", { identifier: "avatar" });
    const page = await activePage(await browserProofSessionForTarget(targetId));
    const name = await page
      .locator("#avatar")
      .evaluate((input) => (input as HTMLInputElement).files?.[0]?.name);
    assert.equal(name, "avatar.png");
    await assert.rejects(
      uploadBrowserWorkspaceFile("../../outside-secret.txt", { identifier: "avatar" }),
      /escapes the workspace root|does not exist/u,
    );
  });
});

test("switch-tab follows the open pages and records honest evidence", async (t) => {
  if (!(await chromeAvailable())) return t.skip("Google Chrome is not installed");
  await withProofBrowser(async ({ targetId }) => {
    const session = await browserProofSessionForTarget(targetId);
    const first = await activePage(session);
    const second = await session.context.newPage();
    await second.goto(`${startUrl}/second`, { waitUntil: "domcontentloaded" });

    const byIndex = await switchBrowserTab({ index: 1 });
    assert.equal(byIndex.index, 1);
    assert.equal(byIndex.pages, 2);
    assert.match(byIndex.url, /\/second/u);
    assert.equal(byIndex.title, "second tab");
    assert.equal(await activePage(session), second, "the session now follows the second page");

    // Both open pages share the host substring: an ambiguous match fails closed.
    await assert.rejects(switchBrowserTab({ url: "127.0.0.1" }), /match must name exactly one/u);
    // A url naming exactly one page switches to it.
    const back = await switchBrowserTab({ url: "/second" });
    assert.equal(back.url.includes("/second"), true);
    const home = await switchBrowserTab({ index: 0 });
    assert.equal(home.index, 0);
    assert.equal(await activePage(session), first);
    // Absence fails closed in both selector shapes.
    await assert.rejects(switchBrowserTab({ index: 9 }), /no open page at index 9/u);
    await assert.rejects(switchBrowserTab({ url: "no-such-path" }), /no open page URL contains/u);
  });
});
