import { For, Show, createSignal } from "solid-js";
import type { AppMap, AuthoringRecordingEdit } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { useRecorder } from "../context/recorder";
import { cn } from "../lib/cn";
import { toast } from "../context/toast";
import { humanError } from "../lib/human-error";
import { DeviceCompanionStage } from "./device-companion-stage";
import { Icon } from "./icon";
import { isRecordingCheckpoint } from "./recording-review-evidence";
import { projectRecordingCompile } from "../lib/recording-compile-projection";

function destinationFor(map: AppMap, fingerprint: string | undefined) {
  if (!fingerprint) return { kind: "new-screen" as const };
  const screen = Object.values(map.screens).find(
    (candidate) =>
      candidate.identity?.fingerprint === fingerprint ||
      candidate.identity?.aliases?.includes(fingerprint),
  );
  return screen
    ? ({ kind: "screen", screenId: screen.id } as const)
    : ({ kind: "new-screen" } as const);
}

/** Test-owned recording surface. The Map remains available as a projection,
 * but recording and approval no longer navigate away from the Test workspace. */
export function AppMapTestRecordingPanel(props: {
  appMap: AppMap;
  onTestCreated: (testId: string) => void;
  onOpenTargets: () => void;
  selectedActionId?: string;
  onSelectAction?: (actionId: string) => void;
}) {
  const recorder = useRecorder();
  const [replaying, setReplaying] = createSignal(false);
  const [approving, setApproving] = createSignal(false);
  const [editingActionId, setEditingActionId] = createSignal<string>();
  const [editBusy, setEditBusy] = createSignal(false);
  const [retiring, setRetiring] = createSignal(false);
  const [semanticName, setSemanticName] = createSignal("");
  const [tapLabel, setTapLabel] = createSignal("");
  const compileProjection = () => projectRecordingCompile(recorder.take()?.actions ?? []);

  const captureCopy = () => {
    const mode = recorder.take()?.captureProvenance.mode ?? "control-and-record";
    if (mode === "watch-and-infer") {
      return "Watch and infer · proposed actions stay unproved until this revision passes replay.";
    }
    if (mode === "instrumented") {
      return "Instrumented capture · captured events stay unproved until this revision passes replay.";
    }
    return "Control and record · interactions are sent through Relay and retained with evidence.";
  };

  async function editRecording(edit: AuthoringRecordingEdit): Promise<void> {
    if (editBusy()) return;
    setEditBusy(true);
    try {
      await recorder.editTake(edit);
      setEditingActionId(undefined);
      setSemanticName("");
      setTapLabel("");
    } catch (error) {
      toast(humanError(error, "Could not edit this recording"), "warning");
    } finally {
      setEditBusy(false);
    }
  }

  function beginEditing(action: NonNullable<ReturnType<typeof recorder.take>>["actions"][number]) {
    setEditingActionId(action.id);
    setSemanticName(action.label?.trim() || "");
    setTapLabel("");
  }

  async function replay(): Promise<void> {
    if (replaying()) return;
    setReplaying(true);
    try {
      if (!(await recorder.replayTake())) toast("Replay did not prove this Test yet", "warning");
    } catch (error) {
      toast(humanError(error, "Could not replay this Test"), "warning");
    } finally {
      setReplaying(false);
    }
  }

  async function approve(): Promise<void> {
    const take = recorder.take();
    if (!take || take.state !== "review" || approving()) return;
    setApproving(true);
    try {
      const committed = await recorder.keepTake({
        destination: destinationFor(props.appMap, take.destinationObservation?.fingerprint),
      });
      const connectionId = committed?.committedConnectionId;
      if (!connectionId) throw new Error("The approved recording did not create a reviewed path");
      const testId = committed.committedTestId;
      if (!testId) throw new Error("The approved recording did not create its canonical Test");
      props.onTestCreated(testId);
      toast("Recording approved · your Test is ready to run", "success");
    } catch (error) {
      toast(humanError(error, "Could not approve this Test"), "warning");
    } finally {
      setApproving(false);
    }
  }

  async function retireAttempt(): Promise<void> {
    if (retiring() || !recorder.canRetireRecordingAttempt()) return;
    if (
      !globalThis.confirm(
        "Retire this unproven recording attempt? No proven recording or Test will be deleted.",
      )
    ) {
      return;
    }
    setRetiring(true);
    try {
      if (await recorder.retireRecordingAttempt()) {
        toast("Unproven recording attempt retired", "success");
      }
    } catch (error) {
      toast(humanError(error, "Could not retire this recording attempt"), "warning");
    } finally {
      setRetiring(false);
    }
  }

  return (
    <aside class="flex min-h-0 flex-1 flex-col bg-background-base" aria-label="Record Test">
      <header class="shrink-0 border-b border-border-weak-base px-3 py-2.5">
        <strong class="block text-caption font-medium text-text-strong">
          {recorder.authoringNeedsAttention()
            ? "Recording needs inspection"
            : recorder.recording()
              ? "Recording Test"
              : "Review recording"}
        </strong>
        <span class="block text-micro text-text-weak" role="status" aria-live="polite">
          {recorder.authoringNeedsAttention()
            ? (recorder.recordingIssue()?.message ??
              "Relay cannot prove whether the last action completed.")
            : recorder.recording()
              ? "Use the device normally and add checkpoints where evidence matters."
              : "Replay the captured actions, then approve the proven Test."}
        </span>
        <span class="mt-1 block text-micro text-text-weak">{captureCopy()}</span>
      </header>

      <Show
        when={recorder.recording() || recorder.authoringNeedsAttention()}
        fallback={
          <div class="min-h-0 flex-1 overflow-y-auto p-3">
            <section
              class="mb-3 grid gap-2 rounded-lg border border-border-weak-base bg-surface-raised-base p-3"
              data-recording-compile
              aria-label="Compiled Test preview"
            >
              <div class="flex items-baseline justify-between gap-2">
                <strong class="text-caption font-medium text-text-strong">Compiled Test</strong>
                <span class="text-micro text-text-weak">
                  {compileProjection().actionCount} actions →{" "}
                  {compileProjection().proposedStepCount} steps · {compileProjection().status}
                </span>
              </div>
              <details>
                <summary class="cursor-pointer text-micro text-text-weak">
                  Review grouped steps and confidence
                </summary>
                <ol class="mt-2 grid gap-1.5 pl-4 text-micro text-text-base">
                  <For each={compileProjection().groups}>
                    {(group) => (
                      <li data-recording-compile-group={group.id}>
                        <span class="font-medium">{group.title}</span>{" "}
                        <span class="text-text-weak">({group.confidence} confidence)</span>
                        <span class="block text-text-weak">
                          {group.steps.map((step) => step.sentence).join(" · ")}
                        </span>
                      </li>
                    )}
                  </For>
                </ol>
              </details>
              <Show when={compileProjection().feedback.length > 0}>
                <ul class="m-0 grid gap-1 border-t border-border-weak-base pt-2 text-micro text-text-warning-base">
                  <For each={compileProjection().feedback.slice(0, 3)}>
                    {(item) => <li>{item.message}</li>}
                  </For>
                </ul>
              </Show>
            </section>
            <ol class="m-0 grid list-decimal gap-2 pl-5 text-caption text-text-base">
              <For each={recorder.take()?.actions ?? []}>
                {(action, index) => {
                  const title = () =>
                    action.label?.trim() ||
                    (action.steps.length === 1
                      ? "Recorded action"
                      : `${action.steps.length} recorded steps`);
                  const actionIds = () => recorder.take()?.actions.map((item) => item.id) ?? [];
                  const selected = () => props.selectedActionId === action.id;
                  const checkpoint = () => isRecordingCheckpoint(action);
                  return (
                    <li
                      class={cn(
                        "overflow-hidden rounded-lg border bg-surface-base",
                        selected()
                          ? "border-border-interactive-base bg-surface-interactive-weak"
                          : "border-border-weak-base",
                        checkpoint() ? "p-3" : "p-1.5",
                      )}
                      data-recording-action={action.id}
                      data-recording-checkpoint={checkpoint() ? "true" : undefined}
                    >
                      <Show when={checkpoint() && (action.exitEvidenceUrl ?? action.evidenceUrl)}>
                        {(src) => (
                          <button
                            type="button"
                            class="mb-2 block w-full overflow-hidden rounded-md border border-border-weak-base bg-[var(--phone-screen)] text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong-focus"
                            aria-label={`Review checkpoint ${title()}`}
                            onClick={() => props.onSelectAction?.(action.id)}
                          >
                            <img
                              class="h-28 w-full object-contain"
                              src={src()}
                              alt={`Checkpoint evidence for ${title()}`}
                            />
                            <span class="block px-2 py-1.5 text-micro font-semibold tracking-[0.09em] text-text-weak uppercase">
                              Checkpoint
                            </span>
                          </button>
                        )}
                      </Show>
                      <div class="flex min-w-0 items-center gap-2">
                        <button
                          type="button"
                          class="min-h-11 min-w-0 flex-1 truncate rounded-md px-1 text-left font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong-focus"
                          aria-current={selected() ? "step" : undefined}
                          onClick={() => props.onSelectAction?.(action.id)}
                        >
                          {title()}
                        </button>
                        <Button
                          variant="ghost"
                          size="sm"
                          class="min-h-11"
                          disabled={index() === 0 || editBusy()}
                          aria-label={`Move ${title()} earlier`}
                          onClick={() => {
                            const ids = actionIds();
                            const current = index();
                            [ids[current - 1], ids[current]] = [ids[current]!, ids[current - 1]!];
                            void editRecording({ kind: "reorder", actionIds: ids });
                          }}
                        >
                          ↑
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          class="min-h-11"
                          disabled={index() >= actionIds().length - 1 || editBusy()}
                          aria-label={`Move ${title()} later`}
                          onClick={() => {
                            const ids = actionIds();
                            const current = index();
                            [ids[current], ids[current + 1]] = [ids[current + 1]!, ids[current]!];
                            void editRecording({ kind: "reorder", actionIds: ids });
                          }}
                        >
                          ↓
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          class="min-h-11"
                          disabled={editBusy()}
                          onClick={() => beginEditing(action)}
                        >
                          Edit
                        </Button>
                      </div>
                      <Show when={selected()}>
                        <div class="mt-1 flex flex-wrap gap-1 border-t border-border-weak-base pt-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            class="min-h-11"
                            disabled={index() >= actionIds().length - 1 || editBusy()}
                            onClick={() =>
                              void editRecording({
                                kind: "merge",
                                actionIds: [action.id, actionIds()[index() + 1]!],
                              })
                            }
                          >
                            Merge with next
                          </Button>
                          <Show when={action.steps.length > 1}>
                            <Button
                              variant="ghost"
                              size="sm"
                              class="min-h-11"
                              disabled={editBusy()}
                              onClick={() =>
                                void editRecording({
                                  kind: "split",
                                  actionId: action.id,
                                  atStep: 1,
                                })
                              }
                            >
                              Split after first step
                            </Button>
                          </Show>
                          <Button
                            variant="ghost"
                            size="sm"
                            class="min-h-11 text-danger-base"
                            disabled={actionIds().length <= 1 || editBusy()}
                            onClick={() => {
                              if (globalThis.confirm(`Remove “${title()}” from this Test?`)) {
                                void editRecording({ kind: "remove", actionIds: [action.id] });
                              }
                            }}
                          >
                            Remove
                          </Button>
                        </div>
                      </Show>
                      <Show when={editingActionId() === action.id}>
                        <div class="mt-2 grid gap-2 border-t border-border-weak-base pt-2">
                          <form
                            class="grid gap-1"
                            onSubmit={(event) => {
                              event.preventDefault();
                              if (semanticName().trim()) {
                                void editRecording({
                                  kind: "rename",
                                  actionId: action.id,
                                  intent: semanticName().trim(),
                                });
                              }
                            }}
                          >
                            <label
                              for={`recording-name-${action.id}`}
                              class="text-micro text-text-weak"
                            >
                              Semantic action name
                            </label>
                            <div class="flex gap-2">
                              <input
                                id={`recording-name-${action.id}`}
                                class="min-h-11 min-w-0 flex-1 rounded-md border border-border-base bg-background-base px-2 text-base text-text-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-border-strong-focus"
                                value={semanticName()}
                                autocomplete="off"
                                spellcheck={false}
                                onInput={(event) => setSemanticName(event.currentTarget.value)}
                              />
                              <Button
                                type="submit"
                                size="sm"
                                class="min-h-11"
                                disabled={editBusy()}
                              >
                                Rename
                              </Button>
                            </div>
                          </form>
                          <form
                            class="grid gap-1"
                            onSubmit={(event) => {
                              event.preventDefault();
                              if (tapLabel().trim()) {
                                void editRecording({
                                  kind: "replace",
                                  actionId: action.id,
                                  interaction: {
                                    kind: "tap",
                                    target: { label: tapLabel().trim() },
                                  },
                                });
                              }
                            }}
                          >
                            <label
                              for={`recording-target-${action.id}`}
                              class="text-micro text-text-weak"
                            >
                              Replacement tap target
                            </label>
                            <div class="flex gap-2">
                              <input
                                id={`recording-target-${action.id}`}
                                class="min-h-11 min-w-0 flex-1 rounded-md border border-border-base bg-background-base px-2 text-base text-text-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-border-strong-focus"
                                value={tapLabel()}
                                autocomplete="off"
                                spellcheck={false}
                                placeholder="Visible label"
                                onInput={(event) => setTapLabel(event.currentTarget.value)}
                              />
                              <Button
                                type="submit"
                                size="sm"
                                class="min-h-11"
                                disabled={editBusy()}
                              >
                                Replace
                              </Button>
                            </div>
                          </form>
                        </div>
                      </Show>
                    </li>
                  );
                }}
              </For>
            </ol>
            <p class="mt-3 text-micro text-text-weak">
              Any edit creates a new reviewed revision. Replay that exact revision before approval.
            </p>
          </div>
        }
      >
        <DeviceCompanionStage preparing={recorder.arming()} onOpenTargets={props.onOpenTargets} />
      </Show>

      <footer class="flex shrink-0 items-center justify-end gap-2 border-t border-border-weak-base p-2.5">
        <Show
          when={recorder.authoringNeedsAttention()}
          fallback={
            <Show
              when={recorder.recording()}
              fallback={
                <>
                  <Button variant="ghost" size="sm" onClick={() => void recorder.discardTake()}>
                    Discard
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={replaying() || approving()}
                    aria-busy={replaying()}
                    onClick={() => void replay()}
                  >
                    <Icon name="refresh" size={13} /> {replaying() ? "Replaying…" : "Replay"}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={
                      recorder.take()?.latestReplay?.outcome !== "passed" ||
                      replaying() ||
                      approving()
                    }
                    aria-busy={approving()}
                    onClick={() => void approve()}
                  >
                    {approving() ? "Approving…" : "Approve Test"}
                  </Button>
                </>
              }
            >
              <Button
                variant="secondary"
                size="sm"
                disabled={recorder.checkpointBusy()}
                aria-busy={recorder.checkpointBusy()}
                onClick={() => void recorder.addCheckpoint()}
              >
                <Icon name="camera" size={13} />
                {recorder.checkpointBusy() ? "Saving…" : "Checkpoint"}
              </Button>
              <Button variant="danger" size="sm" onClick={() => void recorder.stopRecording()}>
                <Icon name="square" size={10} /> Stop
              </Button>
            </Show>
          }
        >
          <Show when={recorder.canRetireRecordingAttempt()}>
            <Button
              variant="danger"
              size="sm"
              disabled={retiring()}
              aria-busy={retiring()}
              onClick={() => void retireAttempt()}
            >
              {retiring() ? "Retiring…" : "Retire attempt"}
            </Button>
          </Show>
          <Button variant="primary" size="sm" onClick={() => void recorder.inspectRecording()}>
            Inspect recording
          </Button>
        </Show>
      </footer>
    </aside>
  );
}
