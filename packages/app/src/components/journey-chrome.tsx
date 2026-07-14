import { For, Show, createMemo } from "solid-js";
import { useRecipeDraft } from "../context/recipe-draft";
import { useServer } from "../context/server";
import { toast } from "../context/toast";
import { useWorkbench } from "../context/workbench";
import { cn } from "../lib/cn";
import { sentenceForStep } from "../lib/step-sentence";
import { frameToSrc } from "../lib/frame-canvas-presentation";
import { fmtAgo, fmtDur } from "../lib/job";
import { Icon } from "./icon";
import { accentForStep, actionForStep, iconForStep } from "./journey-workspace";

export function JourneyOutline(props: { onBack: () => void }) {
  const server = useServer();
  const draft = useRecipeDraft();
  const workbench = useWorkbench();
  const active = () => workbench.focusedIndex() ?? 0;

  return (
    <aside class="journey-outline" aria-label="Journey steps">
      <header>
        <button
          type="button"
          class="journey-outline__back"
          aria-label="Back to tests"
          onClick={props.onBack}
        >
          <Icon name="chevron-left" size={13} /> All tests
        </button>
        <span class="relay-eyebrow">Test flow</span>
        <h2>{draft.title()}</h2>
        <p>{draft.description() || "Every action Relay will perform in this test."}</p>
        <div
          class="journey-outline__progress"
          aria-label={`Step ${active() + 1} of ${draft.steps().length}`}
        >
          <For each={draft.steps()}>
            {(_, index) => <i class={cn(index() <= active() && "is-complete")} />}
          </For>
        </div>
        <small>
          Step {Math.min(active() + 1, draft.steps().length)} of {draft.steps().length}
        </small>
      </header>
      <nav>
        <For each={draft.steps()}>
          {(step, index) => {
            const annotation = () => workbench.rowAnno(index());
            return (
              <button
                type="button"
                class={cn("journey-outline__item", active() === index() && "is-active")}
                onClick={() => workbench.focusStep(index())}
              >
                <span
                  class="journey-outline__number"
                  style={{ "--journey-node-accent": accentForStep(step) }}
                >
                  <Icon name={iconForStep(step)} size={13} />
                </span>
                <span>
                  <small>{String(index() + 1).padStart(2, "0")}</small>
                  <strong>{sentenceForStep(step, server.recipes())}</strong>
                </span>
                <Show when={annotation().status !== "idle"}>
                  <i class={`is-${annotation().status}`} />
                </Show>
              </button>
            );
          }}
        </For>
      </nav>
    </aside>
  );
}

export function JourneyInspector(props: { onEdit: () => void; onOpenTargets: () => void }) {
  const server = useServer();
  const draft = useRecipeDraft();
  const workbench = useWorkbench();
  const index = createMemo(() =>
    Math.max(0, Math.min(workbench.focusedIndex() ?? 0, draft.steps().length - 1)),
  );
  const step = createMemo(() => draft.steps()[index()]);
  const sentence = createMemo(() => {
    const current = step();
    return current ? sentenceForStep(current, server.recipes()) : "No state selected";
  });
  const capturedFrame = createMemo(() => {
    const frame = server.frames()[index()];
    return frame ? frameToSrc(frame) : "";
  });
  const annotation = createMemo(() => workbench.rowAnno(index()));
  const recentRuns = createMemo(() => {
    const recipe = server.selectedRecipe();
    if (!recipe) return [];
    const live = server
      .jobs()
      .filter((job) => job.action === recipe.id)
      .map((job) => ({
        id: job.id,
        status: job.status,
        at: job.finishedAt ?? job.startedAt ?? job.queuedAt,
        duration: job.startedAt ? fmtDur(job) : "—",
      }));
    const liveIds = new Set(live.map((run) => run.id));
    const disk = server
      .persistedRuns()
      .filter((run) => run.action === recipe.id && !liveIds.has(run.id))
      .map((run) => ({
        id: run.id,
        status: run.status,
        at: run.finishedAt ?? run.startedAt ?? run.writtenAt,
        duration: run.durationMs
          ? run.durationMs < 1_000
            ? `${Math.round(run.durationMs)}ms`
            : `${(run.durationMs / 1_000).toFixed(1)}s`
          : "—",
      }));
    return [...live, ...disk].sort((a, b) => b.at - a.at).slice(0, 3);
  });
  const runBlockedReason = () => {
    if (server.health() !== "online") return "Start the Relay server before running this test.";
    if (server.isEmptyDevices() || !server.selectedDevice())
      return "Choose a target before running this test.";
    const target = server.devices().find((device) => device.serial === server.selectedDevice());
    if (!target || target.booted === false) return "Start this target or choose another one.";
    if (draft.invalidCount() > 0) return "Complete the unfinished steps before running.";
    return "";
  };
  const run = () => {
    const blocker = runBlockedReason();
    if (blocker) {
      toast(blocker, "warning");
      if (!server.selectedDevice() || server.isEmptyDevices()) props.onOpenTargets();
      return;
    }
    const recipe = server.selectedRecipe();
    if (recipe) void server.runRecipeRemote(recipe.id);
  };
  const move = (delta: number) =>
    workbench.focusStep(Math.max(0, Math.min(index() + delta, draft.steps().length - 1)));

  return (
    <aside class="journey-inspector" aria-label="Selected journey step">
      <header>
        <div>
          <span class="relay-eyebrow">Selected step</span>
          <strong>
            {String(index() + 1).padStart(2, "0")} / {String(draft.steps().length).padStart(2, "0")}
          </strong>
        </div>
        <button
          type="button"
          class="relay-run"
          onClick={run}
          data-tip={runBlockedReason() || "Run this test"}
        >
          <Icon name="play" size={13} /> Run
        </button>
      </header>
      <div class="journey-inspector__scroll">
        <Show
          when={capturedFrame()}
          fallback={
            <section class="journey-inspector__planned">
              <Show when={step()}>
                {(current) => (
                  <span style={{ "--journey-node-accent": accentForStep(current()) }}>
                    <Icon name={iconForStep(current())} size={22} />
                  </span>
                )}
              </Show>
              <div>
                <small>{step() ? actionForStep(step()!) : "Planned action"}</small>
                <strong>{sentence()}</strong>
                <p>Run the test to replace this plan with a real screenshot and execution data.</p>
              </div>
              <button type="button" onClick={run}>
                <Icon name="play" size={12} /> Capture evidence
              </button>
            </section>
          }
        >
          {(src) => (
            <div class="journey-inspector__preview">
              <img src={src()} alt={`Captured step ${index() + 1}`} />
            </div>
          )}
        </Show>
        <Show when={capturedFrame()}>
          <section class="journey-inspector__detail">
            <span class="journey-inspector__kind">
              <Show when={step()}>
                {(current) => <Icon name={iconForStep(current())} size={14} />}
              </Show>
              Captured action
            </span>
            <h3>{sentence()}</h3>
            <dl>
              <div>
                <dt>Evidence</dt>
                <dd>Captured</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd class={`is-${annotation().status}`}>
                  {annotation().status === "idle" ? "Ready" : annotation().status}
                </dd>
              </div>
            </dl>
          </section>
        </Show>
        <section class="journey-inspector__activity">
          <header>
            <span>Activity</span>
            <small>{recentRuns().length ? "Latest runs" : "No runs yet"}</small>
          </header>
          <Show when={annotation().error || annotation().log}>
            <div class={cn("journey-inspector__log", annotation().error && "is-error")}>
              <span>{annotation().error ? "Error" : "Step log"}</span>
              <code>{annotation().error ?? annotation().log}</code>
            </div>
          </Show>
          <For
            each={recentRuns()}
            fallback={
              <div class="journey-inspector__activity-empty">
                Run this test to collect timing, logs, and screenshots for every step.
              </div>
            }
          >
            {(job) => (
              <div class="journey-inspector__run">
                <i class={`is-${job.status}`} />
                <span>
                  <strong>{job.status === "ok" ? "Passed" : job.status}</strong>
                  <small>{fmtAgo(job.at)}</small>
                </span>
                <b>{job.duration}</b>
              </div>
            )}
          </For>
        </section>
      </div>
      <footer>
        <div>
          <button
            type="button"
            aria-label="Previous state"
            disabled={index() === 0}
            onClick={() => move(-1)}
          >
            <Icon name="chevron-left" size={14} />
          </button>
          <button
            type="button"
            aria-label="Next state"
            disabled={index() === draft.steps().length - 1}
            onClick={() => move(1)}
          >
            <Icon name="chevron-right" size={14} />
          </button>
        </div>
        <button
          type="button"
          class="relay-secondary"
          onClick={() => {
            const selected = index();
            props.onEdit();
            queueMicrotask(() => draft.setExpandedStep(selected));
          }}
        >
          <Icon name="edit" size={13} /> Edit step
        </button>
      </footer>
    </aside>
  );
}
