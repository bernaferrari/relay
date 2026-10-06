import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import { PanelRequestGate, type PanelSelection } from "./load-state.js";

const app = new App(
  { name: "Relay results", version: "0.2.1" },
  { availableDisplayModes: ["fullscreen"] },
);
const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === "string" ? value : "");
const items = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.map(object) : [];
let selection: PanelSelection = {};
let frameCount = 0;
let ready = false;
let requestId = 0;
const gate = new PanelRequestGate();
let hostResultSequence: number | undefined;

function clearFrame(message: string) {
  const empty = document.createElement("p");
  empty.className = "empty";
  empty.textContent = message;
  get("frame").replaceChildren(empty);
  get("frame-caption").textContent = "";
}
function select(next: PanelSelection, resetRun = false) {
  const changed = selection.runId !== next.runId || selection.appMapId !== next.appMapId;
  selection = { ...next };
  for (const row of document.querySelectorAll<HTMLButtonElement>("#runs .row"))
    row.setAttribute("aria-pressed", String(row.dataset.runId === selection.runId));
  if (changed || resetRun || !next.runId) {
    get("run-title").textContent = next.runId ? `Loading Run ${next.runId}` : "Select a run";
    get("run-facts").replaceChildren();
    frameCount = 0;
    get("frame-count").textContent = "";
    get("controls").hidden = true;
    get<HTMLButtonElement>("previous").disabled = true;
    get<HTMLButtonElement>("next").disabled = true;
  }
  get("issues").textContent = "";
  clearFrame(
    next.runId
      ? "Loading selected screenshot…"
      : "Choose a result to inspect its retained screenshot.",
  );
}
function unavailable() {
  select(selection, true);
  get("loading").hidden = true;
  get("content").hidden = false;
  get("run-title").textContent = selection.runId
    ? `Run ${selection.runId} unavailable`
    : "Results unavailable";
  clearFrame("No screenshot available. Refresh when Relay is available.");
  get("issues").textContent = "Could not read this result. Refresh when Relay is available.";
}
function render(result: { structuredContent?: unknown; _meta?: Record<string, unknown> }) {
  const state = object(result.structuredContent);
  const frame = result._meta?.["relay/frame"] as
    | { runId?: string; content?: string; index: number; count: number }
    | undefined;
  if (state.schemaVersion !== 1 || state.readOnly !== true || !gate.accepts(state, frame))
    return false;
  hostResultSequence = undefined;
  get("loading").hidden = true;
  get("content").hidden = false;
  get("scope").textContent = `Project ${text(state.projectId)}`;
  if (state.view === "catalog") renderCatalog(state);
  if (state.runId) renderRun(state, frame);
  get("issues").textContent = Array.isArray(state.issues) ? state.issues.join(" ") : "";
  return true;
}
function renderCatalog(state: Record<string, unknown>) {
  const apps = get<HTMLSelectElement>("apps");
  apps.replaceChildren();
  if (!state.appMapId) apps.add(new Option("Choose an app", ""));
  for (const item of items(state.apps)) apps.add(new Option(text(item.name), text(item.id)));
  apps.value = text(state.appMapId);
  selection.appMapId = text(state.appMapId) || undefined;
  const tests = get("tests");
  tests.replaceChildren();
  for (const item of items(state.tests)) {
    const row = document.createElement("div");
    row.className = "test";
    row.textContent = text(item.name);
    const detail = document.createElement("p");
    detail.textContent = `${item.stepCount} ${item.stepCount === 1 ? "step" : "steps"}`;
    row.append(detail);
    tests.append(row);
  }
  if (!tests.childElementCount)
    tests.textContent = state.appMapId ? "No saved Tests" : "Choose an app to see its Tests.";
  const runs = get("runs");
  runs.replaceChildren();
  for (const item of items(state.runs)) {
    const row = document.createElement("button");
    row.className = "row";
    row.type = "button";
    row.dataset.runId = text(item.id);
    row.setAttribute("aria-pressed", String(item.id === selection.runId));
    const title = document.createElement("span");
    title.textContent = text(item.name);
    const status = document.createElement("span");
    status.className = "status";
    status.textContent = text(object(item.presentation).label);
    row.append(title, status);
    row.onclick = () =>
      load({ appMapId: selection.appMapId, runId: text(item.id), frameIndex: 0 }, "run");
    runs.append(row);
  }
  if (!runs.childElementCount) runs.textContent = "No recent Runs";
}
function renderRun(
  state: Record<string, unknown>,
  frame?: { runId?: string; content?: string; index: number; count: number },
) {
  const selected = object(state.selectedRun);
  const presentation = object(selected.presentation);
  get("run-title").textContent = selected.id
    ? `${text(selected.name)} · ${text(presentation.label)}`
    : `Run ${selection.runId} unavailable`;
  for (const row of document.querySelectorAll<HTMLButtonElement>("#runs .row"))
    row.setAttribute("aria-pressed", String(row.dataset.runId === selection.runId));
  const facts = get("run-facts");
  facts.replaceChildren();
  const checks = object(selected.checks);
  const revision = object(selected.sourceRevision);
  const review = object(selected.review);
  const sourceTest = object(selected.sourceTest);
  const lines = [
    selected.id ? `Run ${text(selected.id)}` : "",
    text(presentation.outcome),
    sourceTest.testId
      ? `Test ${text(sourceTest.testId)} · App Map revision ${sourceTest.appMapRevision}${sourceTest.testRevision !== undefined ? ` · Test revision ${sourceTest.testRevision}` : ""}`
      : "",
    checks.totalCount
      ? `Explicit checks: ${checks.passed} passed · ${checks.failed} failed · ${checks.needsReview} need review${checks.truncated ? ` · showing ${items(checks.items).length} of ${checks.totalCount}` : ""}`
      : "No explicit check results retained",
    text(selected.coverageLine),
    review.status ? `Run review: ${text(review.status)} · ${text(review.reason)}` : "",
    revision.sha
      ? `Revision ${text(revision.sha)}${revision.buildId ? ` · Build ${text(revision.buildId)}` : ""}`
      : "Revision not recorded",
    selected.attempts ? `${selected.attempts} attempt${selected.attempts === 1 ? "" : "s"}` : "",
    selected.retryOf ? `Retry of Run ${text(selected.retryOf)}` : "",
    text(selected.repair),
    ...items(selected.history).map(
      (item) =>
        `${text(item.title)} · ${text(item.status)}${item.heal ? ` · ${text(item.heal)}` : ""}`,
    ),
    Number(selected.historyCount) > items(selected.history).length
      ? `Showing ${items(selected.history).length} of ${selected.historyCount} failure and repair entries`
      : "",
  ];
  for (const line of lines.filter(Boolean)) {
    const p = document.createElement("p");
    p.textContent = line;
    facts.append(p);
  }
  frameCount = typeof state.frameCount === "number" ? state.frameCount : 0;
  const index = typeof state.frameIndex === "number" ? state.frameIndex : 0;
  selection.frameIndex = index;
  clearFrame(
    selection.runId
      ? "No screenshot available for this capture obligation. See the evidence details below."
      : "Choose a result to inspect its retained screenshot.",
  );
  const entry = items(object(state.manifest).items).find((item) => item.index === index);
  if (entry) {
    const config = Object.entries(object(entry.configuration))
      .map(([key, value]) => `${key}: ${text(value)}`)
      .join(" · ");
    const observed = object(entry.observed);
    const captureContext = [
      entry.attempt !== undefined ? `Attempt ${entry.attempt}` : "",
      entry.phase ? text(entry.phase) : "",
      text(observed.laneId),
      text(observed.profileId),
    ]
      .filter(Boolean)
      .join(" · ");
    get("frame-caption").textContent =
      `${text(entry.caption)} · ${entry.blocked ? "blocked" : text(entry.status)}${config ? ` · ${config}` : ""}${captureContext ? ` · ${captureContext}` : ""}`;
  }
  if (frame?.content && /^[A-Za-z0-9+/]+=*$/.test(frame.content)) {
    const image = document.createElement("img");
    image.src = `data:image/png;base64,${frame.content}`;
    image.alt = `Retained screenshot ${index + 1} of ${frameCount}${entry ? ` · ${text(entry.caption)}` : ""}`;
    get("frame").replaceChildren(image);
  }
  get("frame-count").textContent = `${index + 1} / ${frameCount}`;
  get<HTMLButtonElement>("previous").disabled = !ready || index === 0;
  get<HTMLButtonElement>("next").disabled = !ready || index + 1 >= frameCount;
  get("controls").hidden = frameCount <= 1;
}
async function load(next = selection, view: "catalog" | "run" | "frame" = "catalog") {
  if (!ready) return;
  select(next);
  const token = `panel-${++requestId}`;
  const sequence = gate.begin(next, token);
  const refresh = get<HTMLButtonElement>("refresh");
  refresh.disabled = true;
  try {
    const result = await app.callServerTool({
      name: "relay_panel",
      arguments: { ...next, view, requestId: token },
    });
    if (!gate.current(sequence)) return;
    if (result.isError)
      throw new Error("Could not read this result. Refresh when Relay is available.");
    if (!render(result)) throw new Error("Could not read this result.");
  } catch {
    if (gate.current(sequence)) unavailable();
  } finally {
    if (gate.current(sequence)) refresh.disabled = false;
  }
}
app.ontoolinput = ({ arguments: args = {} }) => {
  select({
    appMapId: text(args.appMapId) || undefined,
    runId: text(args.runId) || undefined,
    frameIndex: typeof args.frameIndex === "number" ? args.frameIndex : undefined,
  });
  hostResultSequence = gate.begin(selection, text(args.requestId) || undefined);
  get<HTMLButtonElement>("refresh").disabled = true;
};
app.ontoolresult = (result) => {
  if (result.isError || !result.structuredContent) {
    if (hostResultSequence !== undefined && gate.current(hostResultSequence)) {
      hostResultSequence = undefined;
      unavailable();
      get<HTMLButtonElement>("refresh").disabled = !ready;
    }
    return;
  }
  if (render(result)) get<HTMLButtonElement>("refresh").disabled = !ready;
};
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
  load({ ...selection, frameIndex: Math.max(0, (selection.frameIndex ?? 0) - 1) }, "frame");
get("next").onclick = () =>
  load(
    { ...selection, frameIndex: Math.min(frameCount - 1, (selection.frameIndex ?? 0) + 1) },
    "frame",
  );
try {
  await app.connect();
  ready = Boolean(app.getHostCapabilities()?.serverTools);
  theme();
  get<HTMLButtonElement>("refresh").disabled = !ready;
  get<HTMLSelectElement>("apps").disabled = !ready;
  if (!ready) {
    get("issues").textContent =
      "This host cannot refresh the panel. Ask Relay to inspect another result.";
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
