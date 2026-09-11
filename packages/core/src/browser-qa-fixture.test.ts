import { waitForBrowserContent } from "./browser-readiness.js";
import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileBrowserEnvironment } from "@relay/protocol";
import { closeBrowserHostPool } from "./browser-host-pool.js";
import { resetBrowserDeviceSessionsForTests } from "./browser-device-session.js";
import {
  closeBrowserTarget,
  getBrowserDevice,
  openBrowserAuthoringRuntime,
} from "./browser-target.js";
import { interact } from "./workspace-interact.js";
import { snapshotBrowserPage } from "./browser-target-evidence.js";
import { runRecipeStep } from "./recipe-runner.js";
import { runWithTargetContext } from "./target-context.js";
import { runWithTargetSupervisorStore, TargetSupervisorStore } from "./target-supervisor-store.js";
import { deleteTarget, saveBrowserTarget } from "./targets.js";
import type { TestJob } from "./session.js";

const CHROME =
  process.env.RELAY_TEST_CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const locales = ["en-US", "ja-JP", "es-ES", "fr-FR", "de-DE", "pt-BR"] as const;
const labels: Record<(typeof locales)[number], string> = {
  "en-US": "Send",
  "ja-JP": "送信",
  "es-ES": "Enviar",
  "fr-FR": "Envoyer",
  "de-DE": "Senden",
  "pt-BR": "Enviar",
};

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") reject(new Error("fixture did not bind"));
      else resolve(address.port);
    });
  });
}

function job(): TestJob {
  return { resolvedInputs: {}, artifacts: [], status: "running" } as unknown as TestJob;
}

test("browser QA fixture covers localized responsive chat actions and generated responses", async (t) => {
  try {
    await access(CHROME);
  } catch {
    t.skip("Google Chrome is not installed");
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "relay-browser-qa-fixture-"));
  const previousWorkspaceRoot = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = root;
  const server = http.createServer((request, response) => {
    const locale =
      new URL(request.url ?? "/", "http://fixture").searchParams.get("locale") ?? "en-US";
    const theme =
      new URL(request.url ?? "/", "http://fixture").searchParams.get("theme") ?? "light";
    const font = new URL(request.url ?? "/", "http://fixture").searchParams.get("font") ?? "100";
    const viewport =
      new URL(request.url ?? "/", "http://fixture").searchParams.get("viewport") ?? "phone";
    const send = labels[locale as (typeof locales)[number]] ?? labels["en-US"];
    response.setHeader("content-type", "text/html");
    response.end(`<!doctype html><html lang="${locale}" data-theme="${theme}" data-viewport="${viewport}">
      <style>html{font-size:${font}%}body{background:${theme === "dark" ? "#111" : "#fff"}}button,textarea{font:inherit}</style>
      <main><div>Plain feature copy <span>Translated detail</span></div><h1 id="title">Chat</h1><textarea id="composer" aria-label="Message"></textarea>
      <button id="send" aria-label="${send}"><span>${send}</span></button><p id="assistant-output" role="status" aria-label="Assistant response" style="min-height:1em"></p>
      <span id="generating" hidden>Generating</span><div style="height:80px;overflow:auto"><button id="below" style="margin-top:2000px" onclick="this.textContent='Reached'">Below fold</button></div></main>
      <script>send.onclick=()=>{generating.hidden=false;send.disabled=true;setTimeout(()=>{assistantOutput.textContent='${locale} response: Paris is in France.';generating.hidden=true;send.disabled=false},20)};const assistantOutput=document.getElementById('assistant-output')</script>
    </html>`);
  });
  const port = await listen(server);
  const supervisor = new TargetSupervisorStore(":memory:");
  try {
    const cases = [
      ["en-US", "light", "100", "phone"],
      ["ja-JP", "dark", "125", "tablet"],
      ["es-ES", "light", "125", "phone"],
      ["fr-FR", "dark", "100", "tablet"],
      ["de-DE", "light", "125", "tablet"],
      ["pt-BR", "dark", "125", "phone"],
    ] as const;
    await runWithTargetSupervisorStore(supervisor, async () => {
      for (const [locale, theme, font, viewport] of cases) {
        const target = await saveBrowserTarget({
          name: `QA ${locale}`,
          startUrl: `http://127.0.0.1:${port}/?locale=${locale}&theme=${theme}&font=${font}&viewport=${viewport}`,
          executablePath: CHROME,
          headless: true,
          environment: compileBrowserEnvironment({
            viewport:
              viewport === "phone" ? { width: 390, height: 844 } : { width: 1024, height: 768 },
            locale,
            colorScheme: theme,
            mobile: viewport === "phone",
            touch: viewport === "phone",
          }),
        });
        try {
          if (locale === "en-US") {
            const runtime = await openBrowserAuthoringRuntime(target.id, { headless: true });
            const page = await runtime.activePage();
            await page.evaluate(() => {
              document.body.setAttribute("aria-busy", "true");
              setTimeout(() => {
                document.body.removeAttribute("aria-busy");
                const button = document.createElement("button");
                button.id = "hydrated-control";
                button.textContent = "Hydrated";
                button.onclick = () => {
                  button.textContent = "Clicked once";
                };
                document.body.append(button);
              }, 150);
            });
            await waitForBrowserContent(page, { timeoutMs: 1_500, stableForMs: 30 });
            await interact(
              { kind: "identifier", identifier: "hydrated-control" },
              { serial: target.id },
            );
            assert.equal(await page.locator("#hydrated-control").innerText(), "Clicked once");
            await page.evaluate(() => {
              setTimeout(() => {
                const button = document.createElement("button");
                button.id = "late-control";
                button.textContent = "Late control";
                button.onclick = () => {
                  button.textContent = "Reached late control";
                };
                document.body.append(button);
              }, 150);
            });
            await interact(
              { kind: "identifier", identifier: "late-control" },
              { serial: target.id },
            );
            assert.equal(await page.locator("#late-control").innerText(), "Reached late control");
            const nodes = await snapshotBrowserPage(page);
            assert.ok(nodes.some((node) => node.content?.includes("Plain feature copy")));
            assert.ok(nodes.some((node) => node.content === "Translated detail"));
            await interact({ kind: "identifier", identifier: "below" }, { serial: target.id });
            const after = await snapshotBrowserPage(await runtime.activePage());
            assert.ok(
              after.some((node) => node.identifier === "below" && node.content === "Reached"),
            );
          }
          await runWithTargetContext(
            { kind: "browser", platform: "browser", targetId: target.id },
            async () => {
              const device = await getBrowserDevice(target.id, { mode: "proof" });
              const owner = job();
              await runRecipeStep(
                device,
                { kind: "type", target: { identifier: "composer" }, text: "Where is Paris?" },
                { log: () => {}, job: owner },
              );
              await runRecipeStep(
                device,
                {
                  kind: "tap",
                  target: locale === "en-US" ? { label: labels[locale] } : { identifier: "send" },
                },
                { log: () => {}, job: owner },
              );
              await runRecipeStep(
                device,
                {
                  kind: "wait-response",
                  target: { identifier: "assistant-output" },
                  busyTarget: { identifier: "generating" },
                  idleTarget: { identifier: "send" },
                  timeoutMs: 2_000,
                  stableForMs: 20,
                },
                { log: () => {}, job: owner },
              );
              await runRecipeStep(
                device,
                {
                  kind: "extract",
                  as: "response",
                  target: { identifier: "assistant-output" },
                  role: "assistant",
                },
                { log: () => {}, job: owner },
              );
              await runRecipeStep(
                device,
                {
                  kind: "assert-content",
                  input: "response",
                  expected: "Paris is in France",
                  match: "contains",
                },
                { log: () => {}, job: owner },
              );
              assert.ok(String(owner.resolvedInputs.response).includes("Paris is in France"));
              if (locale === "en-US") {
                await interact({ kind: "identifier", identifier: "below" }, { device });
                await runRecipeStep(
                  device,
                  { kind: "extract", as: "below", target: { identifier: "below" } },
                  { log: () => {}, job: owner },
                );
                assert.equal(owner.resolvedInputs.below, "Reached");
              }
            },
          );
        } finally {
          await closeBrowserTarget(target.id, { mode: "proof" }).catch(() => undefined);
          await deleteTarget(target.id);
        }
      }
    });
  } finally {
    supervisor.close();
    await closeBrowserTarget().catch(() => undefined);
    resetBrowserDeviceSessionsForTests();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
    if (previousWorkspaceRoot === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspaceRoot;
  }
});

test("browser QA fixture fails closed when response output is missing or stable control changes", async (t) => {
  try {
    await access(CHROME);
  } catch {
    t.skip("Google Chrome is not installed");
    return;
  }
  const server = http.createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end(
      '<button id="send-renamed">Send</button><p id="assistant-output" role="status" aria-live="polite" aria-label="Assistant response" tabindex="0" style="min-height:1em"></p><p id="generating" hidden>Generating</p>',
    );
  });
  const port = await listen(server);
  const root = await mkdtemp(join(tmpdir(), "relay-browser-qa-negative-"));
  const previousWorkspaceRoot = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = root;
  const supervisor = new TargetSupervisorStore(":memory:");
  try {
    await runWithTargetSupervisorStore(supervisor, async () => {
      const target = await saveBrowserTarget({
        name: "QA negative",
        startUrl: `http://127.0.0.1:${port}/`,
        executablePath: CHROME,
        headless: true,
        environment: compileBrowserEnvironment({ viewport: { width: 390, height: 844 } }),
      });
      try {
        await runWithTargetContext(
          { kind: "browser", platform: "browser", targetId: target.id },
          async () => {
            const device = await getBrowserDevice(target.id, { mode: "proof" });
            const owner = job();
            const initial = await device.capture.snapshot();
            const outputNode = (initial.nodes ?? []).find(
              (node) => node.identifier === "assistant-output",
            );
            assert.ok(outputNode);
            assert.match(JSON.stringify(outputNode), /Assistant response/u);
            assert.equal(outputNode.value ?? "", "");
            await assert.rejects(
              runRecipeStep(
                device,
                { kind: "tap", target: { identifier: "send" } },
                { log: () => {}, job: owner },
              ),
              /target has no usable strategy|No match|not found|selector is not present/iu,
            );
            await assert.rejects(
              runRecipeStep(
                device,
                {
                  kind: "wait-response",
                  target: { identifier: "assistant-output" },
                  timeoutMs: 80,
                  stableForMs: 20,
                },
                { log: () => {}, job: owner },
              ),
              /response completion: timed out|No match/iu,
            );
          },
        );
      } finally {
        await closeBrowserTarget(target.id, { mode: "proof" }).catch(() => undefined);
        await deleteTarget(target.id);
      }
    });
  } finally {
    supervisor.close();
    resetBrowserDeviceSessionsForTests();
    await closeBrowserTarget().catch(() => undefined);
    await closeBrowserHostPool();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
    if (previousWorkspaceRoot === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspaceRoot;
  }
});
