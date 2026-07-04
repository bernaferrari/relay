import { For, Show, createMemo } from "solid-js";
import { useServer, type ActionInfo, type JobInfo } from "../context/server";

function statusTone(status: JobInfo["status"] | "idle") {
  if (status === "ok") return "pass";
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
  return `${(ms / 1000).toFixed(1)}s`;
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
    if (j?.logs?.length) return j.logs.join("\n");
    const id = server.selectedJobId();
    const lines = server.logs().filter((l) => !id || l.jobId === id || !l.jobId);
    return lines
      .slice(-40)
      .map((l) => l.text)
      .join("\n");
  });

  const stats = createMemo(() => {
    const jobs = server.jobs();
    const ok = jobs.filter((j) => j.status === "ok").length;
    const fail = jobs.filter((j) => j.status === "error").length;
    const run = jobs.filter((j) => j.status === "running" || j.status === "queued").length;
    return { total: jobs.length, ok, fail, run, frames: server.frames().length };
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
                      <span class={`tone tone--${statusTone(j.status)}`}>{j.status}</span>
                      <span>·</span>
                      <span class="mono">{fmtDur(j)}</span>
                      <Show when={j.serial}>
                        <span>·</span>
                        <span class="mono">{j.serial}</span>
                      </Show>
                    </span>
                    <span class="stitle">{j.action}</span>
                    <Show when={j.error && server.selectedJobId() === j.id}>
                      <span class="heal-box">
                        <span class="heal-box__icon">!</span>
                        <span>{j.error}</span>
                      </span>
                    </Show>
                  </span>
                  <span class="srow__frames mono">
                    {server.frames().filter((f) => f.jobId === j.id).length || "·"}
                  </span>
                </button>
              )}
            </For>
          </Show>
        </div>

        <div class="console">
          <div class="console__label mono">
            {selectedJob()
              ? `JOB ${selectedJob()!.id.slice(0, 8)} · LOG`
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
              <b class="mono" style={{ color: "var(--pass)" }}>
                {stats().ok}
              </b>
            </div>
            <div class="tile">
              <span class="tile__label">Failed</span>
              <b class="mono" style={{ color: "var(--fail)" }}>
                {stats().fail}
              </b>
            </div>
            <div class="tile">
              <span class="tile__label">Frames</span>
              <b class="mono">{stats().frames}</b>
            </div>
            <div class="tile">
              <span class="tile__label">Server</span>
              <b
                class="mono"
                style={{ color: server.health() === "online" ? "var(--pass)" : "var(--fail)" }}
              >
                {server.health()}
              </b>
            </div>
            <div class="tile">
              <span class="tile__label">SSE</span>
              <b class="mono">{server.sseConnected() ? "live" : "off"}</b>
            </div>
          </div>

          <div class="tile tile--wide">
            <span class="tile__label">Selected recipe</span>
            <div class="mono" style={{ "margin-top": "0.35rem", color: "var(--text)" }}>
              {selectedMeta()?.id ?? "—"}
            </div>
            <div
              style={{
                "margin-top": "0.35rem",
                color: "var(--dim)",
                "font-size": "12px",
                "line-height": "1.55",
              }}
            >
              {selectedMeta()?.description ?? "Pick a step on the Steps tab, then Run."}
            </div>
          </div>

          <div class="tile tile--wide">
            <span class="tile__label">Device under test</span>
            <div class="mono" style={{ "margin-top": "0.35rem", color: "var(--text)" }}>
              {server.selectedDevice() ?? "no device"}
            </div>
            <div style={{ "margin-top": "0.35rem", color: "var(--dim)", "font-size": "12px" }}>
              {server.devices().find((d) => d.serial === server.selectedDevice())?.name ?? "—"}
              {" · "}
              Android via agent-device
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
          <For
            each={[
              {
                name: "frames (session)",
                meta: `${server.frames().length} captures`,
              },
              {
                name: "jobs (session)",
                meta: `${server.jobs().length} runs`,
              },
              {
                name: "latest screenshot",
                meta: server.currentFrame()
                  ? `${Math.round(server.currentFrame()!.bytes / 1024)} KB`
                  : "none",
              },
              {
                name: "ui snapshot",
                meta: server.snapshot() ? `${server.snapshot()!.nodes.length} nodes` : "none",
              },
            ]}
          >
            {(row) => (
              <div class="tile tile--row">
                <span class="mono" style={{ "font-size": "12px" }}>
                  {row.name}
                </span>
                <span class="mono" style={{ "font-size": "10.5px", color: "var(--faint)" }}>
                  {row.meta}
                </span>
              </div>
            )}
          </For>
          <p class="artifacts-note">
            Evidence lives in this session (frames + job logs). Server also writes PNG files under
            the OS temp <span class="mono">grok-device/</span> folder when capturing.
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
      <div class="panel__pad" style={{ "padding-bottom": "0.4rem" }}>
        <button
          type="button"
          class="btn btn-acc"
          style={{ width: "100%", "justify-content": "center" }}
          disabled={server.busyCapture() || server.health() !== "online"}
          onClick={() => void server.captureUiSnapshot()}
        >
          {server.busyCapture() ? "Capturing…" : "Capture UI snapshot"}
        </button>
      </div>
      <Show
        when={server.snapshot()}
        fallback={
          <div class="empty-pad">
            Capture a snapshot to inspect the accessibility tree. Click a node to press it
            on-device.
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
