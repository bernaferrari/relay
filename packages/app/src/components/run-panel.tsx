import { For, Show, createMemo } from "solid-js";
import { useServer, type ActionInfo, type JobInfo } from "../context/server";
import { Glyphs } from "./glyphs";

function statusTone(status: JobInfo["status"] | "idle") {
  if (status === "ok") return "pass";
  if (status === "healed") return "heal";
  if (status === "error") return "fail";
  if (status === "running" || status === "queued") return "run";
  return "dim";
}

function fmtDur(job: JobInfo) {
  const end =
    job.finishedAt ?? (job.status === "running" ? Date.now() : (job.startedAt ?? job.queuedAt));
  const start = job.startedAt ?? job.queuedAt;
  const ms = Math.max(0, end - start);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export function RunPanel() {
  const server = useServer();

  const selectedMeta = createMemo(() =>
    server.actions().find((a) => a.id === server.selectedAction()),
  );

  const selectedJob = createMemo(
    () => server.jobs().find((j) => j.id === server.selectedJobId()) ?? null,
  );

  const jobLogs = createMemo(() => {
    const j = selectedJob();
    if (j?.steps?.length) {
      const step = j.steps[j.steps.length - 1];
      if (step?.log) return step.log;
    }
    if (j?.logs?.length) return j.logs.join("\n");
    const id = server.selectedJobId();
    return server
      .logs()
      .filter((l) => !id || l.jobId === id || !l.jobId)
      .slice(-40)
      .map((l) => l.text)
      .join("\n");
  });

  const stats = createMemo(() => {
    const jobs = server.jobs();
    const ok = jobs.filter((j) => j.status === "ok").length;
    const fail = jobs.filter((j) => j.status === "error").length;
    const healed = jobs.filter((j) => j.status === "healed" || j.healed).length;
    const run = jobs.filter((j) => j.status === "running" || j.status === "queued").length;
    return { total: jobs.length, ok, fail, healed, run, frames: server.frames().length };
  });

  const groups = createMemo(() => {
    const byCat = new Map<string, ActionInfo[]>();
    for (const a of server.actions()) {
      const list = byCat.get(a.category) ?? [];
      list.push(a);
      byCat.set(a.category, list);
    }
    return [...byCat.entries()];
  });

  return (
    <aside class="panel" aria-label="Run panel">
      <div class="panel__head">
        <div class="panel__title-row">
          <h1 class="mono panel__flow">{server.selectedAction() ?? "ready"}</h1>
          <span class="panel__stats">
            {stats().ok} passed · {stats().fail} failed
            {stats().healed ? (
              <span style={{ color: "var(--text-warning-base)" }}> · {stats().healed} healed</span>
            ) : null}
            {stats().run ? ` · ${stats().run} active` : ""}
            {stats().frames ? ` · ${stats().frames} frames` : ""}
          </span>
        </div>
        <nav class="tabs-nav" aria-label="Panel tabs">
          {(
            [
              ["summary", "Summary"],
              ["steps", "Steps"],
              ["inspector", "Inspector"],
              ["artifacts", "Artifacts"],
            ] as const
          ).map(([id, label]) => (
            <button
              type="button"
              class="tab"
              classList={{ on: server.panelTab() === id }}
              onClick={() => server.setPanelTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      <Show when={server.panelTab() === "steps"}>
        <div class="panel__scroll">
          <div class="section-label">Recipes</div>
          <For each={groups()}>
            {([category, actions]) => (
              <div class="action-block">
                <div class="section-label section-label--sub">{category}</div>
                <For each={actions}>
                  {(a, i) => {
                    const job = () => server.jobs().find((j) => j.action === a.id);
                    const on = () => server.selectedAction() === a.id;
                    return (
                      <button
                        type="button"
                        class="srow"
                        classList={{ on: on() }}
                        onClick={() => server.setSelectedAction(a.id)}
                        onDblClick={() => {
                          server.setSelectedAction(a.id);
                          void server.runSelected();
                        }}
                      >
                        <span class="snum">{String(i() + 1).padStart(2, "0")}</span>
                        <span class="srow__body">
                          <span class="smeta">
                            <span class={`tone tone--${a.category === "grok" ? "acc" : "dim"}`}>
                              {a.category === "grok" ? "App" : "Store"}
                            </span>
                            <span>·</span>
                            <span class="mono">{a.id}</span>
                            <span
                              style={{
                                width: "1px",
                                height: "10px",
                                background: "var(--border-weak-base)",
                              }}
                            />
                            <Glyphs glyphs={a.glyphs} />
                            <Show when={job()}>
                              <span>·</span>
                              <span class={`tone tone--${statusTone(job()!.status)}`}>
                                {job()!.status}
                              </span>
                              <span class="mono">{fmtDur(job()!)}</span>
                            </Show>
                          </span>
                          <span class="stitle">{a.title}</span>
                          <Show when={on() && a.description}>
                            <span class="sdesc">{a.description}</span>
                          </Show>
                        </span>
                      </button>
                    );
                  }}
                </For>
              </div>
            )}
          </For>

          <Show when={server.jobs().length > 0}>
            <div class="section-label" style={{ "margin-top": "1rem" }}>
              Run history
            </div>
            <For each={server.jobs()}>
              {(j, i) => (
                <button
                  type="button"
                  class="srow"
                  classList={{ on: server.selectedJobId() === j.id }}
                  onClick={() => server.jumpToJob(j.id)}
                >
                  <span class={`snum snum--${statusTone(j.status)}`}>
                    {String(i() + 1).padStart(2, "0")}
                  </span>
                  <span class="srow__body">
                    <span class="smeta">
                      <span class={`tone tone--${statusTone(j.status)}`}>
                        {j.kind ?? (j.healed ? "Healed" : "Replay")}
                      </span>
                      <span>·</span>
                      <span class="mono">{fmtDur(j)}</span>
                      <span
                        style={{
                          width: "1px",
                          height: "10px",
                          background: "var(--border-weak-base)",
                        }}
                      />
                      <Glyphs glyphs={j.glyphs ?? j.steps?.[0]?.glyphs} />
                      <Show when={(j.attempts ?? 1) > 1}>
                        <span class="mono">×{j.attempts}</span>
                      </Show>
                    </span>
                    <span class="stitle">{j.title ?? j.action}</span>

                    <Show
                      when={
                        (j.healed || j.status === "healed" || j.healMessage) &&
                        server.selectedJobId() === j.id
                      }
                    >
                      <span class="heal-box">
                        <span class="heal-box__icon">⚠</span>
                        <span>
                          {j.healMessage ?? "Step self-healed on retry."}{" "}
                          <span class="mono" style={{ color: "var(--text-warning-base)" }}>
                            attempt {j.attempts}
                          </span>
                        </span>
                      </span>
                    </Show>

                    <Show when={j.status === "error" && server.selectedJobId() === j.id}>
                      <span class="heal-box heal-box--fail">
                        <span class="heal-box__icon">!</span>
                        <span>
                          {j.error}
                          <div style={{ "margin-top": "8px", display: "flex", gap: "12px" }}>
                            <button
                              type="button"
                              class="mono link-heal"
                              onClick={(e) => {
                                e.stopPropagation();
                                void server.retrySelectedJob(j.id);
                              }}
                            >
                              Retry / heal →
                            </button>
                          </div>
                        </span>
                      </span>
                    </Show>
                  </span>
                  <span class="srow__frames mono">
                    {j.frames?.length ||
                      server.frames().filter((f) => f.jobId === j.id).length ||
                      "·"}
                    <span style={{ "margin-left": "4px", opacity: 0.7 }}>🎞</span>
                  </span>
                </button>
              )}
            </For>
          </Show>
        </div>

        <div class="console">
          <div class="console__label mono">
            {selectedJob()
              ? `STEP ${String(selectedJob()!.steps?.length ?? 1).padStart(2, "0")} · LOG`
              : selectedMeta()
                ? `ACTION · ${selectedMeta()!.id}`
                : "ACTIVITY"}
          </div>
          <pre>{jobLogs() || "— live logs stream here via SSE —"}</pre>
        </div>
      </Show>

      <Show when={server.panelTab() === "summary"}>
        <div class="panel__scroll panel__pad">
          <div class="tiles">
            <div class="tile">
              <span class="tile__label">Jobs</span>
              <b class="mono">{stats().total}</b>
            </div>
            <div class="tile">
              <span class="tile__label">Passed</span>
              <b class="mono" style={{ color: "var(--text-success-base)" }}>
                {stats().ok}
              </b>
            </div>
            <div class="tile">
              <span class="tile__label">Failed</span>
              <b class="mono" style={{ color: "var(--text-critical-base)" }}>
                {stats().fail}
              </b>
            </div>
            <div class="tile">
              <span class="tile__label">Healed</span>
              <b class="mono" style={{ color: "var(--text-warning-base)" }}>
                {stats().healed}
              </b>
            </div>
            <div class="tile">
              <span class="tile__label">Frames</span>
              <b class="mono">{stats().frames}</b>
            </div>
            <div class="tile">
              <span class="tile__label">Disk runs</span>
              <b class="mono">{server.persistedRuns().length}</b>
            </div>
          </div>

          <Show when={stats().healed > 0}>
            <div class="tile tile--wide" style={{ "border-color": "rgba(229,164,59,.3)" }}>
              <div style={{ display: "flex", gap: "9px" }}>
                <span style={{ color: "var(--text-warning-base)" }}>✦</span>
                <div
                  style={{ "font-size": "12px", "line-height": "1.55", color: "var(--text-base)" }}
                >
                  <span style={{ color: "var(--text-strong)", "font-weight": 600 }}>
                    {stats().healed} step{stats().healed === 1 ? "" : "s"} self-healed on this
                    session.
                  </span>{" "}
                  Failures were re-run via Retry / heal; successful retries re-record evidence under{" "}
                  <span class="mono">runs/</span>.
                </div>
              </div>
            </div>
          </Show>

          <div class="tile tile--wide">
            <span class="tile__label">Selected recipe</span>
            <div class="mono" style={{ "margin-top": "0.35rem", color: "var(--text-strong)" }}>
              {selectedMeta()?.id ?? "—"}
            </div>
            <div style={{ "margin-top": "0.45rem" }}>
              <Glyphs glyphs={selectedMeta()?.glyphs} size="md" />
            </div>
            <div
              style={{
                "margin-top": "0.35rem",
                color: "var(--text-base)",
                "font-size": "12px",
                "line-height": "1.55",
              }}
            >
              {selectedMeta()?.description ?? "Pick a step on the Steps tab, then Run."}
            </div>
          </div>

          <div class="tile tile--wide">
            <span class="tile__label">Device under test</span>
            <div class="mono" style={{ "margin-top": "0.35rem", color: "var(--text-strong)" }}>
              {server.selectedDevice() ?? "no device"}
            </div>
          </div>

          <div class="tile tile--wide">
            <span class="tile__label">Runs directory</span>
            <div
              class="mono"
              style={{
                "margin-top": "0.35rem",
                "font-size": "11.5px",
                color: "var(--text-strong)",
              }}
            >
              {server.runsRoot() || "runs/"}
            </div>
          </div>

          <label class="check-row">
            <input
              type="checkbox"
              checked={server.skipAccountSwitch()}
              onChange={(e) => server.setSkipAccountSwitch(e.currentTarget.checked)}
            />
            Skip Play account ensure
          </label>
          <label class="check-row">
            <input
              type="checkbox"
              checked={server.skipRestoreHome()}
              onChange={(e) => server.setSkipRestoreHome(e.currentTarget.checked)}
            />
            Skip restore home after alpha
          </label>
        </div>
      </Show>

      <Show when={server.panelTab() === "inspector"}>
        <InspectorBody />
      </Show>

      <Show when={server.panelTab() === "artifacts"}>
        <div class="panel__scroll panel__pad">
          <div class="section-label" style={{ padding: 0 }}>
            Session
          </div>
          <For
            each={[
              { name: "frames (live)", meta: `${server.frames().length} captures` },
              { name: "jobs (live)", meta: `${server.jobs().length} runs` },
              {
                name: "ui snapshot",
                meta: server.snapshot()
                  ? `${server.snapshot()!.nodes.length} nodes · ${server.snapshot()!.bounds?.width ?? "?"}×${server.snapshot()!.bounds?.height ?? "?"}`
                  : "none",
              },
              {
                name: "overlays",
                meta: server.showOverlays() && server.snapshot()?.bounds ? "enabled" : "off",
              },
            ]}
          >
            {(row) => (
              <div class="tile tile--row">
                <span class="mono" style={{ "font-size": "12px" }}>
                  {row.name}
                </span>
                <span class="mono" style={{ "font-size": "10.5px", color: "var(--text-weak)" }}>
                  {row.meta}
                </span>
              </div>
            )}
          </For>

          <div class="section-label" style={{ padding: "12px 0 0" }}>
            Disk · runs/
          </div>
          <button
            type="button"
            class="btn btn-ghost"
            style={{ "align-self": "flex-start" }}
            onClick={() => void server.refreshRuns()}
          >
            Refresh disk runs
          </button>

          <Show
            when={server.persistedRuns().length > 0}
            fallback={
              <p class="artifacts-note">
                No persisted runs yet. Finish a job to write run.json + frames.
              </p>
            }
          >
            <For each={server.persistedRuns()}>
              {(run) => (
                <button
                  type="button"
                  class="tile tile--row"
                  style={{ width: "100%" }}
                  onClick={() => {
                    // load first frame into stage if available via URL is hard without base64;
                    // jump to matching live job if present
                    const live = server.jobs().find((j) => j.id === run.id);
                    if (live) server.jumpToJob(live.id);
                    server.appendLog(`disk run ${run.dir}`, "info");
                  }}
                >
                  <span style={{ flex: 1, "min-width": 0, "text-align": "left" }}>
                    <span class="mono" style={{ "font-size": "12px", display: "block" }}>
                      {run.action}
                    </span>
                    <span class="mono" style={{ "font-size": "10.5px", color: "var(--text-weak)" }}>
                      {run.status}
                      {run.healed ? " · healed" : ""}
                      {" · "}
                      {run.frames?.length ?? 0} frames
                      {" · "}
                      {run.id.slice(0, 8)}
                    </span>
                  </span>
                  <span class={`tone tone--${statusTone(run.status as JobInfo["status"])}`}>
                    {run.healed ? "healed" : run.status}
                  </span>
                </button>
              )}
            </For>
          </Show>

          <p class="artifacts-note">
            Everything above is plain files under{" "}
            <span class="mono">{server.runsRoot() || "runs/<ts>_<action>_<device>_<id>/"}</span>—{" "}
            <span class="mono">run.json</span>, <span class="mono">log.txt</span>,{" "}
            <span class="mono">frames/*.png</span>. Same layout the QA viewer mock used for triage.
          </p>
        </div>
      </Show>
    </aside>
  );
}

function InspectorBody() {
  const server = useServer();
  const nodes = createMemo(() => server.snapshot()?.nodes.slice(0, 200) ?? []);

  return (
    <div class="panel__scroll">
      <div class="panel__pad" style={{ "padding-bottom": "0.4rem", gap: "8px" }}>
        <button
          type="button"
          class="btn btn-acc"
          style={{ width: "100%", "justify-content": "center" }}
          disabled={server.busyCapture() || server.health() !== "online"}
          onClick={() => void server.captureUiSnapshot()}
        >
          {server.busyCapture() ? "Capturing…" : "Capture UI snapshot"}
        </button>
        <label class="check-row">
          <input
            type="checkbox"
            checked={server.showOverlays()}
            onChange={(e) => server.setShowOverlays(e.currentTarget.checked)}
          />
          Show rect overlays on phone glass
        </label>
      </div>
      <Show
        when={server.snapshot()}
        fallback={
          <div class="empty-pad">
            Capture a snapshot to inspect the accessibility tree and draw hit-rects on the stage.
            Click a node to press it on-device.
          </div>
        }
      >
        <For each={nodes()}>
          {(n) => {
            const label = () => (n.label ?? n.value ?? n.identifier ?? "(unnamed)").trim();
            return (
              <button type="button" class="inspector-row" onClick={() => void server.pressNode(n)}>
                <span class="inspector-row__hit">{n.hittable ? "●" : "○"}</span>
                <span class="inspector-row__label">{label()}</span>
                <span class="inspector-row__meta mono">
                  {n.ref ? (n.ref.startsWith("@") ? n.ref : `@${n.ref}`) : ""}
                </span>
              </button>
            );
          }}
        </For>
      </Show>
    </div>
  );
}
