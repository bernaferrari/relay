import { For, Show, createSignal } from "solid-js";
import type { AppMap } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { useRecorder } from "../context/recorder";
import { toast } from "../context/toast";
import { humanError } from "../lib/human-error";
import { DeviceCompanionStage } from "./device-companion-stage";
import { Icon } from "./icon";

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
}) {
  const recorder = useRecorder();
  const [replaying, setReplaying] = createSignal(false);
  const [approving, setApproving] = createSignal(false);

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
      </header>

      <Show
        when={recorder.recording() || recorder.authoringNeedsAttention()}
        fallback={
          <div class="min-h-0 flex-1 overflow-y-auto p-3">
            <ol class="m-0 grid list-decimal gap-2 pl-5 text-caption text-text-base">
              <For each={recorder.take()?.actions ?? []}>
                {(action) => (
                  <li class="pl-1">
                    {action.label?.trim() ||
                      (action.steps.length === 1
                        ? "Recorded action"
                        : `${action.steps.length} recorded steps`)}
                  </li>
                )}
              </For>
            </ol>
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
          <Button variant="primary" size="sm" onClick={() => void recorder.inspectRecording()}>
            Inspect recording
          </Button>
        </Show>
      </footer>
    </aside>
  );
}
