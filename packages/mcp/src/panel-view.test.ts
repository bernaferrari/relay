import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { build } from "esbuild";

type ToolResult = {
  isError?: boolean;
  content?: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};
type ToolRequest = { name: string; arguments: Record<string, unknown> };

class PanelHost {
  ontoolinput!: (input: { arguments?: Record<string, unknown> }) => void;
  ontoolresult!: (result: ToolResult) => void;
  onhostcontextchanged!: () => void;
  callServerTool: (request: ToolRequest) => Promise<ToolResult> = async () => ({});
  async connect() {}
  getHostCapabilities() {
    return { serverTools: {} };
  }
  getHostContext() {
    return {};
  }
}

// Reuse the workspace's browser-test runtime without adding an MCP runtime dependency.
const requireFromApp = createRequire(new URL("../../app/package.json", import.meta.url));
const { Window } = (await import(pathToFileURL(requireFromApp.resolve("happy-dom")).href)) as {
  Window: new () => { document: Document; close(): void };
};
const [bundle, template] = await Promise.all([
  build({
    entryPoints: [fileURLToPath(new URL("../panel/view.ts", import.meta.url))],
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    write: false,
    plugins: [
      {
        name: "panel-host-test-double",
        setup(context) {
          context.onResolve({ filter: /^@modelcontextprotocol\/ext-apps$/ }, () => ({
            path: "host",
            namespace: "panel-host-test-double",
          }));
          context.onLoad({ filter: /.*/, namespace: "panel-host-test-double" }, () => ({
            contents: `export const App = globalThis.PanelHost;
              export const applyDocumentTheme = () => {};
              export const applyHostStyleVariables = () => {};`,
          }));
        },
      },
    ],
  }),
  readFile(new URL("../panel/template.html", import.meta.url), "utf8"),
]);

async function panel() {
  const window = new Window();
  window.document.write(template);
  const host = new PanelHost();
  await runInNewContext(`(async () => { ${bundle.outputFiles[0]!.text} })()`, {
    document: window.document,
    Option: function Option(label: string, value: string) {
      const option = window.document.createElement("option");
      option.text = label;
      option.value = value;
      return option;
    },
    PanelHost: function Host() {
      return host;
    },
  });
  const get = <T extends HTMLElement = HTMLElement>(id: string) =>
    window.document.getElementById(id) as T;
  const row = (runId: string) =>
    window.document.querySelector<HTMLButtonElement>(`[data-run-id="${runId}"]`)!;
  return { window, host, get, row };
}

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/sNQAAAAASUVORK5CYII=";
function runResult(runId: "run-A" | "run-B", requestId: string, frameIndex = 1): ToolResult {
  return {
    structuredContent: {
      schemaVersion: 1,
      readOnly: true,
      view: "catalog",
      projectId: "project-1",
      appMapId: "app-1",
      runId,
      requestId,
      frameIndex,
      frameCount: 3,
      apps: [{ id: "app-1", name: "Checkout" }],
      tests: [{ name: "Open checkout", stepCount: 1 }],
      runs: [
        { id: "run-A", name: "Run A", presentation: { label: "Completed" } },
        { id: "run-B", name: "Run B", presentation: { label: "Failed" } },
      ],
      selectedRun: {
        id: runId,
        name: runId === "run-A" ? "Run A" : "Run B",
        presentation: {
          label: runId === "run-A" ? "Completed" : "Failed",
          outcome: runId === "run-A" ? "Checks passed" : "Checks failed",
        },
        checks: { totalCount: 1, passed: runId === "run-A" ? 1 : 0, failed: 0, needsReview: 0 },
        sourceRevision: { sha: runId === "run-A" ? "aaaaaaa" : "bbbbbbb" },
      },
      manifest: {
        items: [{ index: frameIndex, caption: `${runId} screenshot`, status: "pending" }],
      },
    },
    _meta: { "relay/frame": { runId, index: frameIndex, count: 3, content: png } },
  };
}

function hostSelection(host: PanelHost, runId: string, requestId: string, frameIndex = 1) {
  host.ontoolinput({ arguments: { appMapId: "app-1", runId, requestId, frameIndex } });
}

test("host Run input clears the previous Run's facts, selection and navigation before a result", async (t) => {
  const p = await panel();
  t.after(() => p.window.close());
  hostSelection(p.host, "run-A", "host-A");
  p.host.ontoolresult(runResult("run-A", "host-A"));
  assert.equal(p.get("run-title").textContent, "Run A · Completed");
  assert.match(p.get("run-facts").textContent ?? "", /Checks passed.*Revision aaaaaaa/);
  assert.equal(p.row("run-A").getAttribute("aria-pressed"), "true");
  assert.equal(p.get<HTMLButtonElement>("previous").disabled, false);
  assert.equal(p.get<HTMLButtonElement>("next").disabled, false);
  assert.ok(p.get("frame").querySelector("img"));

  hostSelection(p.host, "run-B", "host-B", 0);

  assert.equal(p.get("run-title").textContent, "Loading Run run-B");
  assert.equal(p.get("run-facts").textContent, "");
  assert.equal(p.row("run-A").getAttribute("aria-pressed"), "false");
  assert.equal(p.row("run-B").getAttribute("aria-pressed"), "true");
  assert.equal(p.get("frame").querySelector("img"), null);
  assert.equal(p.get("frame-caption").textContent, "");
  assert.equal(p.get("frame-count").textContent, "");
  assert.equal(p.get("controls").hidden, true);
  assert.equal(p.get<HTMLButtonElement>("previous").disabled, true);
  assert.equal(p.get<HTMLButtonElement>("next").disabled, true);
});

test("host error after switching Runs shows bounded unavailable state and cannot revive old facts", async (t) => {
  const p = await panel();
  t.after(() => p.window.close());
  hostSelection(p.host, "run-A", "host-A");
  const oldResult = runResult("run-A", "host-A");
  p.host.ontoolresult(oldResult);
  hostSelection(p.host, "run-B", "host-B", 0);
  p.host.ontoolresult({
    isError: true,
    content: [{ type: "text", text: "Bearer private-token /Users/private transport failure" }],
  });

  assert.equal(p.get("run-title").textContent, "Run run-B unavailable");
  assert.equal(p.get("run-facts").textContent, "");
  assert.equal(
    p.get("issues").textContent,
    "Could not read this result. Refresh when Relay is available.",
  );
  assert.doesNotMatch(p.get("content").textContent ?? "", /private-token|\/Users\/private|aaaaaaa/);
  assert.equal(p.get("frame").querySelector("img"), null);
  assert.equal(p.get("controls").hidden, true);
  assert.equal(p.get<HTMLButtonElement>("previous").disabled, true);
  assert.equal(p.get<HTMLButtonElement>("next").disabled, true);

  p.host.ontoolresult(oldResult);
  assert.equal(p.get("run-title").textContent, "Run run-B unavailable");
  assert.equal(p.get("run-facts").textContent, "");
  assert.equal(p.get("frame").querySelector("img"), null);
});

test("late structured host responses cannot paint another Run or discard its accepted result", async (t) => {
  const p = await panel();
  t.after(() => p.window.close());
  hostSelection(p.host, "run-A", "host-A");
  const oldResult = runResult("run-A", "host-A");
  p.host.ontoolresult(oldResult);
  hostSelection(p.host, "run-B", "host-B", 0);
  p.host.ontoolresult(oldResult);
  assert.equal(p.get("run-title").textContent, "Loading Run run-B");
  assert.equal(p.get("run-facts").textContent, "");
  assert.equal(p.get("frame").querySelector("img"), null);

  p.host.ontoolresult(runResult("run-B", "host-B", 0));
  assert.equal(p.get("run-title").textContent, "Run B · Failed");
  assert.match(p.get("run-facts").textContent ?? "", /Checks failed.*Revision bbbbbbb/);
  const screenshot = p.get("frame").querySelector("img");
  p.host.ontoolresult(oldResult);
  p.host.ontoolresult({ isError: true });
  assert.equal(p.get("run-title").textContent, "Run B · Failed");
  assert.doesNotMatch(p.get("run-facts").textContent ?? "", /Checks passed|aaaaaaa/);
  assert.equal(p.get("frame").querySelector("img"), screenshot);
  assert.equal(p.get("issues").textContent, "");
});

test("internal Run loading resets visible evidence and reports a rejected request generically", async (t) => {
  const p = await panel();
  t.after(() => p.window.close());
  hostSelection(p.host, "run-A", "host-A");
  p.host.ontoolresult(runResult("run-A", "host-A"));
  let reject!: (error: Error) => void;
  p.host.callServerTool = () =>
    new Promise((_resolve, rejectRequest) => {
      reject = rejectRequest;
    });
  const loading = p.row("run-B").onclick!(new p.window.document.defaultView!.PointerEvent("click"));
  assert.equal(p.get("run-title").textContent, "Loading Run run-B");
  assert.equal(p.get("run-facts").textContent, "");
  assert.equal(p.row("run-A").getAttribute("aria-pressed"), "false");
  assert.equal(p.get("frame-count").textContent, "");
  assert.equal(p.get<HTMLButtonElement>("next").disabled, true);
  reject(new Error("Bearer private-token transport failure"));
  await loading;
  assert.equal(p.get("run-title").textContent, "Run run-B unavailable");
  assert.equal(
    p.get("issues").textContent,
    "Could not read this result. Refresh when Relay is available.",
  );
  assert.doesNotMatch(p.get("content").textContent ?? "", /private-token|aaaaaaa/);
  assert.equal(p.get<HTMLButtonElement>("refresh").disabled, false);
});
