import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";

const app = new App(
  { name: "Relay results", version: "0.2.1" },
  { availableDisplayModes: ["fullscreen"] },
);
const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let selection: { appMapId?: string; runId?: string; frameIndex?: number } = {};
let frameCount = 0;
let requestSequence = 0;
let ready = false;
const text = (value: unknown) => (typeof value === "string" ? value : "");
const statusLabel = (value: string) =>
  ({
    queued: "Queued",
    running: "Running",
    paused: "Paused",
    ok: "Passed",
    error: "Failed",
    healed: "Passed after repair",
    cancelled: "Cancelled",
  })[value] ?? value;
function render(result: { structuredContent?: unknown; _meta?: Record<string, unknown> }) {
  const state =
    result.structuredContent && typeof result.structuredContent === "object"
      ? (result.structuredContent as Record<string, unknown>)
      : undefined;
  if (!state || state.schemaVersion !== 1 || state.readOnly !== true) return;
  get("loading").hidden = true;
  get("content").hidden = false;
  get("scope").textContent = `Project ${text(state.projectId)}`;
  const apps = get<HTMLSelectElement>("apps");
  apps.replaceChildren();
  if (!state.appMapId) {
    const option = new Option("Choose an app", "");
    apps.add(option);
  }
  for (const item of (state.apps as { id: string; name: string }[]) ?? [])
    apps.add(new Option(item.name, item.id));
  apps.value = text(state.appMapId);
  selection.appMapId = text(state.appMapId) || undefined;
  const selected = state.selectedRun as { id?: string; name?: string; status?: string } | undefined;
  selection.runId = text(selected?.id) || undefined;
  const tests = get("tests");
  tests.replaceChildren();
  for (const item of (state.tests as { id: string; name: string; stepCount: number }[]) ?? []) {
    const row = document.createElement("div");
    row.className = "test";
    row.textContent = item.name;
    const detail = document.createElement("p");
    detail.textContent = `${item.stepCount} ${item.stepCount === 1 ? "step" : "steps"}`;
    row.append(detail);
    tests.append(row);
  }
  if (!tests.childElementCount)
    tests.textContent = state.appMapId ? "No saved Tests" : "Choose an app to see its Tests.";
  const runs = get("runs");
  runs.replaceChildren();
  for (const item of (state.runs as { id: string; name: string; status: string }[]) ?? []) {
    const row = document.createElement("button");
    row.className = "row";
    row.type = "button";
    row.setAttribute("aria-pressed", String(item.id === selection.runId));
    const title = document.createElement("span");
    title.textContent = item.name;
    const status = document.createElement("span");
    status.className = `status ${["ok", "error", "healed"].includes(item.status) ? item.status : ""}`;
    status.textContent = statusLabel(item.status);
    row.append(title, status);
    row.onclick = () => load({ appMapId: selection.appMapId, runId: item.id, frameIndex: 0 });
    runs.append(row);
  }
  if (!runs.childElementCount) runs.textContent = "No recent Runs";
  get("run-title").textContent = selected
    ? `${selected.name} · ${statusLabel(selected.status ?? "unknown")}`
    : "Select a run";
  const frame = result._meta?.["relay/frame"] as
    | { content?: string; index: number; count: number }
    | undefined;
  const stage = get("frame");
  stage.replaceChildren();
  if (frame?.content && /^[A-Za-z0-9+/]+=*$/.test(frame.content)) {
    const image = document.createElement("img");
    image.src = `data:image/png;base64,${frame.content}`;
    image.alt = `Retained screenshot ${frame.index + 1} of ${frame.count}`;
    stage.append(image);
    selection.frameIndex = frame.index;
    frameCount = frame.count;
    get("frame-count").textContent = `${frame.index + 1} / ${frame.count}`;
    get<HTMLButtonElement>("previous").disabled = frame.index === 0;
    get<HTMLButtonElement>("next").disabled = frame.index + 1 >= frame.count;
  } else {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = selection.runId
      ? "No screenshot available for this result."
      : "Choose a result to inspect its retained screenshot.";
    stage.append(empty);
    frameCount = 0;
  }
  get("controls").hidden = frameCount <= 1;
  get("issues").textContent = ((state.issues as string[]) ?? []).join(" ");
}
async function load(next = selection) {
  if (!ready) return;
  selection = next;
  const sequence = ++requestSequence;
  const refresh = get<HTMLButtonElement>("refresh");
  refresh.disabled = true;
  try {
    const result = await app.callServerTool({ name: "relay_panel", arguments: { ...next } });
    if (sequence !== requestSequence) return;
    if (result.isError)
      throw new Error("Could not read this result. Refresh when Relay is available.");
    render(result);
  } catch (error) {
    if (sequence === requestSequence)
      get("issues").textContent =
        error instanceof Error ? error.message : "Could not read Relay results.";
  } finally {
    if (sequence === requestSequence) refresh.disabled = false;
  }
}
app.ontoolinput = ({ arguments: args = {} }) => {
  selection = {
    appMapId: text(args.appMapId) || undefined,
    runId: text(args.runId) || undefined,
    frameIndex: typeof args.frameIndex === "number" ? args.frameIndex : undefined,
  };
};
app.ontoolresult = render;
function theme() {
  const context = app.getHostContext();
  if (context?.theme) applyDocumentTheme(context.theme);
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
}
app.onhostcontextchanged = theme;
get<HTMLSelectElement>("apps").onchange = () =>
  load({ appMapId: get<HTMLSelectElement>("apps").value || undefined });
get("refresh").onclick = () => load();
get("previous").onclick = () =>
  load({ ...selection, frameIndex: Math.max(0, (selection.frameIndex ?? 0) - 1) });
get("next").onclick = () =>
  load({ ...selection, frameIndex: Math.min(frameCount - 1, (selection.frameIndex ?? 0) + 1) });
try {
  await app.connect();
  ready = Boolean(app.getHostCapabilities()?.serverTools);
  theme();
  get<HTMLButtonElement>("refresh").disabled = !ready;
  get<HTMLSelectElement>("apps").disabled = !ready;
  if (!ready)
    get("issues").textContent =
      "This host cannot refresh the panel. Ask Relay to inspect another result.";
  if (!ready) {
    for (const button of document.querySelectorAll<HTMLButtonElement>(".row, #previous, #next"))
      button.disabled = true;
  }
  const context = app.getHostContext();
  if (
    context?.displayMode !== "fullscreen" &&
    context?.availableDisplayModes?.includes("fullscreen")
  )
    await app.requestDisplayMode({ mode: "fullscreen" });
} catch {
  get("loading").hidden = true;
  get("content").hidden = false;
  get("issues").textContent =
    "The panel could not connect to this host. Ask Relay to inspect the result in chat.";
}
