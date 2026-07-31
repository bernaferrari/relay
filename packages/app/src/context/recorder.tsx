import { createSignal, createEffect } from "solid-js";
import type { JourneyVideoClip } from "@relay/protocol";
import { createSimpleContext } from "@relay/ui/context/helper";
import {
  useServer,
  type Frame,
  type RecordedNodeEvidence,
  type RecordedSelectorCandidate,
  type RecordedStepEvidence,
  type SnapshotNode,
  type SnapshotState,
  type RecipeStep,
  type StepTarget,
} from "./server";
import {
  ancestryOf,
  nodeAtPoint,
  strategiesFor,
  targetFromStrategy,
  type PickStrategy,
} from "../lib/snapshot";
import { sentenceForStep } from "../lib/step-sentence";
import { targetIsReady } from "../lib/target-presentation";
import { useRecipeDraft } from "./recipe-draft";
import { toast } from "./toast";

/**
 * Interactive recorder: click the device preview to tap the real device, and
 * record each tap at every available abstraction level — the full fallback
 * chain (ref · accessibility label · point) — so the selector can be changed
 * after recording without losing the original tap. Recorded
 * sequences are saved as server recipes (POST /recipes) and replayed as jobs
 * (POST /jobs {recipe}); localStorage is only read once, to migrate legacy
 * recipes onto the server.
 */
export type RecLevel = "smart" | "element" | "point";

/** A take is deliberately separate from executable recipe steps. Recording is
 * exploratory; people should be able to pause, inspect, keep, or throw away a
 * whole pass without making the journey noisy or unsafe. */
export type RecordingTake = {
  id: string;
  recipeId?: string;
  sourceScreenId?: string;
  startedAt: number;
  finishedAt?: number;
  group: string;
  steps: RecipeStep[];
  state: "recording" | "review";
  /** A Relay-owned XCTest video take for iPhone/iPad review. */
  videoTakeId?: string;
  videoClip?: JourneyVideoClip;
};

/** A recording is only real after Relay can both prepare the target and read
 * its first screen. Keep a short, user-facing failure state separate from the
 * take so the UI never claims to be recording when setup has failed. */
export type RecordingIssue = {
  kind: "setup" | "screen";
  message: string;
};

/** Legacy localStorage step shape (pre-plan-003). */
export type LegacyRecStep =
  | { kind: "ref"; ref: string; label?: string }
  | { kind: "label"; label: string }
  | { kind: "point"; x: number; y: number };

/** Legacy only — recipes now live on the server. Kept for one-time migration. */
const STORAGE_KEY = "specimen:custom-recipes";

/**
 * Pure: map a legacy localStorage step to a plan-002 RecipeStep. Every legacy
 * kind was a tap, so all become `{ kind: "tap", target: {...} }` carrying the
 * fields that were known. (Extracted to a pure function so it is testable
 * headlessly — the app package has no test harness today.)
 */
export function migrateLegacyStep(step: LegacyRecStep): RecipeStep {
  if (step.kind === "ref") {
    const target: StepTarget = { ref: step.ref };
    if (step.label) target.label = step.label;
    return { kind: "tap", target };
  }
  if (step.kind === "label") return { kind: "tap", target: { label: step.label } };
  return { kind: "tap", target: { point: { x: step.x, y: step.y } } };
}

/** Human-readable one-liner for a RecipeStep (stage / execution row / log
 *  captions) — re-exported here so existing `from "../context/recorder"`
 *  imports keep working. Canonical implementation lives in lib/step-sentence
 *  so it's shared by the row list without pulling in this context. */
export const describeStep = sentenceForStep;

/** A recording without real device geometry is not safe to replay. In
 * particular, never turn a fractional pointer into a 0/1 coordinate just
 * because a snapshot request happened to fail. */
export function hasUsableDeviceBounds(
  snapshot: SnapshotState,
): snapshot is NonNullable<SnapshotState> & { bounds: { width: number; height: number } } {
  const bounds = snapshot?.bounds;
  return Boolean(
    bounds &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    bounds.width > 1 &&
    bounds.height > 1,
  );
}

/**
 * Build the full tap target for a click — every field that is known, so the
 * recorded step can fall back through ref → label → point at replay time
 * (plan 002's runner). Pure: shared by the recorder and the stage picker.
 */
export function buildTapTarget(
  bounds: { width: number; height: number } | undefined,
  node: SnapshotNode | null,
  fx: number,
  fy: number,
): StepTarget {
  const w = bounds?.width ?? 1;
  const h = bounds?.height ?? 1;
  const point = {
    x: Math.round(fx * w),
    y: Math.round(fy * h),
    anchor: { horizontal: "left", vertical: "top" } as const,
    ...(bounds ? { referenceBounds: { ...bounds } } : {}),
  };
  if (!node) return { point };
  const label = (node.label ?? node.value ?? "").trim();
  const target: StepTarget = { point };
  if (node.ref) target.ref = node.ref.startsWith("@") ? node.ref : `@${node.ref}`;
  if (label) target.label = label;
  return target;
}

/** Use the exact tapped node when it has human semantics; otherwise walk to
 * the closest labelled parent (common for icons inside an "Account" row).
 * Resource identifiers remain evidence, never accessibility labels. */
export function semanticTapNode(
  snap: SnapshotState,
  node: SnapshotNode | null,
): SnapshotNode | null {
  if (!snap || !node) return node;
  return (
    ancestryOf(snap, node).find((candidate) =>
      Boolean((candidate.label ?? candidate.value ?? "").trim()),
    ) ?? node
  );
}

function evidenceId(): string {
  const suffix =
    globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10);
  return `ev-${Date.now().toString(36)}-${suffix}`;
}

function recordedNode(node: SnapshotNode): RecordedNodeEvidence {
  return {
    ...(node.label ? { label: node.label } : {}),
    ...(node.value ? { value: node.value } : {}),
    ...(node.identifier ? { identifier: node.identifier } : {}),
    ...(node.role ? { role: node.role } : {}),
    ...(node.type ? { type: node.type } : {}),
    ...(node.ref ? { ref: node.ref.startsWith("@") ? node.ref : `@${node.ref}` } : {}),
    ...(node.index !== undefined ? { index: node.index } : {}),
    ...(node.parentIndex !== undefined ? { parentIndex: node.parentIndex } : {}),
    ...(node.rect ? { rect: { ...node.rect } } : {}),
  };
}

function recordedCandidates(
  snap: SnapshotState,
  node: SnapshotNode | null,
  fx: number,
  fy: number,
): RecordedSelectorCandidate[] {
  const candidates: RecordedSelectorCandidate[] = [];
  const seen = new Set<string>();
  const chain = node && snap ? ancestryOf(snap, node).slice(0, 8) : [];
  chain.forEach((candidateNode, index) => {
    for (const strategy of strategiesFor(candidateNode, snap, fx, fy)) {
      if (strategy.kind === "point") continue;
      const target = targetFromStrategy(strategy, fx, fy, snap?.bounds);
      const key = `${strategy.kind}:${JSON.stringify(target)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        strategy: strategy.kind,
        label: strategy.describe,
        source: index === 0 ? "element" : "ancestor",
        confidence: index === 0 ? "high" : "medium",
        target,
      });
    }
  });
  if (!hasUsableDeviceBounds(snap)) return candidates;
  const point = targetFromStrategy(
    {
      id: "point",
      kind: "point",
      x: Math.round(fx * snap.bounds.width),
      y: Math.round(fy * snap.bounds.height),
      describe: "Coordinate",
    },
    fx,
    fy,
    snap?.bounds,
  );
  candidates.push({
    strategy: "point",
    label: `coordinate ${point.point?.x ?? 0}, ${point.point?.y ?? 0}`,
    source: "coordinate",
    confidence: "fallback",
    target: point,
  });
  return candidates;
}

function recordedEvidence(
  snap: SnapshotState,
  node: SnapshotNode | null,
  fx?: number,
  fy?: number,
  serial?: string | null,
): RecordedStepEvidence {
  const id = evidenceId();
  const bounds = snap?.bounds;
  const hasPointer = fx !== undefined && fy !== undefined;
  return {
    id,
    recordedAt: Date.now(),
    ...(serial ? { serial } : {}),
    ...(bounds ? { deviceBounds: { ...bounds } } : {}),
    ...(hasPointer && bounds
      ? { pointer: { x: Math.round(fx * bounds.width), y: Math.round(fy * bounds.height) } }
      : {}),
    ...(node ? { node: recordedNode(node) } : {}),
    ...(node && snap ? { ancestors: ancestryOf(snap, node).slice(1, 9).map(recordedNode) } : {}),
    ...(snap
      ? {
          nodes: snap.nodes
            .filter(
              (candidate) =>
                candidate.rect &&
                (candidate.hittable ||
                  candidate.ref ||
                  Boolean((candidate.label ?? candidate.value ?? "").trim())),
            )
            .slice(0, 256)
            .map(recordedNode),
        }
      : {}),
    ...(hasPointer ? { candidates: recordedCandidates(snap, node, fx, fy) } : {}),
    capture: {
      schemaVersion: 1,
      ...(snap ? { uiTreeCapturedAt: snap.capturedAt } : {}),
      status: snap ? "partial" : "partial",
      issues: snap ? ["missing-screenshot"] : ["missing-ui-tree", "missing-screenshot"],
    },
  };
}

export const { use: useRecorder, provider: RecorderProvider } = createSimpleContext({
  name: "Recorder",
  gate: false,
  init: () => {
    const server = useServer();
    const draft = useRecipeDraft();
    const [interacting, setInteracting] = createSignal(false);
    const [recording, setRecording] = createSignal(false);
    const [arming, setArming] = createSignal(false);
    const [recordingIssue, setRecordingIssue] = createSignal<RecordingIssue | null>(null);
    const [recordingGroup, setRecordingGroupState] = createSignal("");
    const [take, setTake] = createSignal<RecordingTake | null>(null);
    // Starting the Apple XCTest recorder can take a moment while the local
    // runner is prepared. Keep the promise so Stop always waits for Start,
    // rather than accidentally leaving an orphaned recording on the device.
    let iosVideoStart: ReturnType<typeof server.recordIosVideo> | null = null;
    let iosVideoTakeId: string | null = null;
    let pendingRecordingSourceScreenId: string | undefined;
    let recordingAttempt = 0;
    let recordingIssueSerial: string | null = null;

    const recordingTargetReady = () =>
      targetIsReady(
        server.devices().find((device) => device.serial === server.selectedDevice()),
        server.health() === "online",
      );

    const recordingTargetIsIos = () =>
      server.devices().find((device) => device.serial === server.selectedDevice())?.platform ===
      "ios";

    // The recorder is the final authority. UI entry points may change over
    // time, but none may ever leave this state armed without a real target.
    createEffect(() => {
      if ((!recording() && !arming()) || recordingTargetReady()) return;
      recordingAttempt += 1;
      setArming(false);
      setRecording(false);
      setInteracting(false);
      setRecordingGroupState("");
      recordingIssueSerial = server.selectedDevice();
      setRecordingIssue({
        kind: "screen",
        message: "The selected device disconnected before Relay could start recording.",
      });
      setTake((current) =>
        current?.steps.length ? { ...current, finishedAt: Date.now(), state: "review" } : null,
      );
    });

    // A setup problem belongs to the selected device, never to the entire
    // workspace. Choosing another target should immediately give it a clean
    // chance to prepare rather than carrying an old iPad's warning forward.
    createEffect(() => {
      const selected = server.selectedDevice();
      if (recordingIssue() && selected !== recordingIssueSerial) {
        recordingIssueSerial = null;
        setRecordingIssue(null);
      }
    });

    function takeId(): string {
      const suffix =
        globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10);
      return `take-${Date.now().toString(36)}-${suffix}`;
    }

    function nextRecordingGroup(): string {
      const used = new Set(
        draft
          .steps()
          .map((step) => step.group)
          .filter((group): group is string => Boolean(group))
          .map((group) => /^Task (\d+)$/.exec(group)?.[1])
          .filter((value): value is string => Boolean(value))
          .map((value) => Number(value)),
      );
      let number = 1;
      while (used.has(number)) number += 1;
      return `Task ${number}`;
    }

    function setRecordingGroup(value: string): void {
      setRecordingGroupState(value.slice(0, 96));
    }

    /** The graph chooses a source before the recorder starts. Persist it on
     * the temporary take so review can survive a reload without guessing. */
    function setRecordingSourceScreen(sourceScreenId: string | undefined): void {
      pendingRecordingSourceScreenId = sourceScreenId;
      setTake((current) => (current ? { ...current, sourceScreenId } : current));
    }

    function startNextRecordingGroup(): void {
      setRecordingGroupState(nextRecordingGroup());
    }

    function withRecordingGroup(step: RecipeStep): RecipeStep {
      const group = recordingGroup().trim();
      return group ? { ...step, group } : step;
    }

    /** "Recorded test N" — next free number, so back-to-back recordings
     *  without a rename don't collide. */
    function nextRecordedTitle(): string {
      const used = new Set(
        server
          .recipes()
          .map((r) => /^Recorded test (\d+)$/.exec(r.title)?.[1])
          .filter((x): x is string => Boolean(x))
          .map((x) => parseInt(x, 10)),
      );
      let n = 1;
      while (used.has(n)) n++;
      return `Recorded test ${n}`;
    }

    /** Where should a just-captured step land? The selected test — builtin
     *  or custom (builtins silently auto-fork on save). Nothing selected →
     *  auto-create + select "Recorded test N". Returns null only if the
     *  create-recipe call itself failed (offline etc). */
    async function ensureRecordingTarget(): Promise<string | null> {
      return draft.ensureRecordingDraft(nextRecordedTitle);
    }

    async function attachEvidenceScreenshot(
      evidence: RecordedStepEvidence,
      recipeId: string,
      frame: Frame | undefined,
    ): Promise<void> {
      if (!frame || frame.mime !== "image/png") return;
      const saved = await server.persistRecordingEvidence(recipeId, evidence.id, frame);
      if (!saved) return;
      evidence.screenshot = {
        recipeId,
        id: evidence.id,
        capturedAt: frame.capturedAt,
        mime: "image/png",
        bytes: saved.bytes,
        sha256: saved.sha256,
      };
      evidence.capture = {
        schemaVersion: 1,
        ...(evidence.capture?.uiTreeCapturedAt !== undefined
          ? { uiTreeCapturedAt: evidence.capture.uiTreeCapturedAt }
          : {}),
        screenshotCapturedAt: frame.capturedAt,
        status: evidence.capture?.issues?.includes("missing-ui-tree") ? "partial" : "complete",
        ...(evidence.capture?.issues?.includes("missing-ui-tree")
          ? { issues: ["missing-ui-tree"] }
          : {}),
      };
    }

    let lastMissingContextNotice = 0;
    function noteMissingScreenContext(recordingGesture: boolean): void {
      const now = Date.now();
      // One quiet, actionable notice is enough while Android changes windows
      // or the phone is locked. Repeating a toast for every pointer event
      // makes a temporary capture gap feel like a broken recorder.
      if (now - lastMissingContextNotice < 10_000) return;
      lastMissingContextNotice = now;
      if (recordingGesture) {
        // A connecting Android device often exposes video a fraction before it
        // exposes the inspectable window tree. That is a normal preparation
        // phase, not an error worthy of interrupting a person mid-flow.
        server.appendLog("recording awaiting usable device screen", "info");
        void server.captureUiSnapshot();
        return;
      }
      toast("Relay needs the device screen to map this gesture", "warning");
      server.appendLog("interaction skipped · no valid UI snapshot/device bounds", "error");
    }

    function noteMissingRecordingContext(): void {
      noteMissingScreenContext(true);
    }

    async function exactEvidenceFrame(caption: string): Promise<Frame | undefined> {
      try {
        return await server.captureUiScreenshot(caption, undefined, undefined, true);
      } catch {
        return undefined;
      }
    }

    async function appendRecordedStep(
      step: RecipeStep,
      evidence: RecordedStepEvidence,
      caption: string,
    ): Promise<void> {
      const frame = await exactEvidenceFrame(caption);
      const id = await ensureRecordingTarget();
      if (!id) return;
      if (frame) await attachEvidenceScreenshot(evidence, id, frame);
      else {
        evidence.capture = {
          schemaVersion: 1,
          ...(evidence.capture?.uiTreeCapturedAt !== undefined
            ? { uiTreeCapturedAt: evidence.capture.uiTreeCapturedAt }
            : {}),
          status: "partial",
          issues: ["missing-screenshot"],
        };
        server.appendLog("recording evidence saved without a screenshot", "error");
      }
      const recorded = withRecordingGroup({ ...step, evidence });
      // Never mutate the journey during an active recording. The take remains
      // editable evidence until the author explicitly keeps it.
      setTake((current) =>
        current
          ? { ...current, recipeId: id, steps: [...current.steps, recorded] }
          : {
              id: takeId(),
              recipeId: id,
              startedAt: Date.now(),
              group: recordingGroup().trim() || nextRecordingGroup(),
              steps: [recorded],
              state: "recording",
            },
      );
      // Prime context for the next direct-control event. This is intentionally
      // not awaited: touch/keyboard delivery stays on the fast H.264 path.
      void server.captureUiSnapshot();
    }

    // H.264 control reaches the phone before its parallel accessibility tree
    // response. Keep the last sound geometry as a short-lived safety net so a
    // harmless capture race never drops an action the user just performed.
    let lastUsableSnapshot: SnapshotState = null;

    function isSelectedDeviceSnapshot(snapshot: SnapshotState): boolean {
      if (!hasUsableDeviceBounds(snapshot)) return false;
      const selectedDevice = server.selectedDevice();
      return !selectedDevice || !snapshot.serial || snapshot.serial === selectedDevice;
    }

    async function snapshotForRecording(waitForCapture: boolean): Promise<SnapshotState> {
      const current = server.snapshot();
      if (isSelectedDeviceSnapshot(current)) {
        lastUsableSnapshot = current;
        return current;
      }
      if (!waitForCapture) return lastUsableSnapshot;

      // First capture can race stream setup. This happens after direct
      // control has already completed, so the retry never slows the phone.
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const captured = await server.captureUiSnapshot();
        if (isSelectedDeviceSnapshot(captured)) {
          lastUsableSnapshot = captured;
          return captured;
        }
        if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 120));
      }
      return lastUsableSnapshot;
    }

    function noteMissingInteractionContext(): void {
      noteMissingScreenContext(false);
    }

    function issueForRecordingStart(error: unknown): RecordingIssue {
      const raw = error instanceof Error ? error.message : String(error);
      if (
        /xcode is not signed in|could not create a development profile|turn on developer mode|manual signing override/i.test(
          raw,
        )
      ) {
        return { kind: "setup", message: raw };
      }
      if (/finish .*setup|sign(?:ing)?|provision|xcode|runner/i.test(raw)) {
        return {
          kind: "setup",
          message: "Relay needs to finish setting up its local iPad runner before it can record.",
        };
      }
      return {
        kind: "screen",
        message: "Relay could not read this device’s screen yet.",
      };
    }

    async function stopStartedIosVideo(): Promise<void> {
      if (!iosVideoTakeId) return;
      try {
        await server.recordIosVideo("stop");
      } catch {
        // The setup failure is already represented in the stage. A second,
        // competing error toast would not help the person recover.
      } finally {
        iosVideoTakeId = null;
      }
    }

    /** Prepare the target before calling it a recording. On iOS that includes
     * signing/launching the local runner and proving that a screenshot plus a
     * usable UI tree can be read. */
    async function enterRecordMode(): Promise<boolean> {
      if (recording() || arming()) return false;
      if (!recordingTargetReady()) {
        toast("Choose a ready device before recording", "info");
        window.dispatchEvent(new CustomEvent("relay:open-device-picker"));
        return false;
      }
      if (take()?.state === "review") {
        toast("Review or discard the current take before recording again", "info");
        return false;
      }
      const attempt = ++recordingAttempt;
      const group = recordingGroup().trim() || nextRecordingGroup();
      recordingIssueSerial = null;
      setRecordingIssue(null);
      // Never arm a new take from geometry captured for a different target.
      lastUsableSnapshot = null;
      setArming(true);
      server.setShowOverlays(true);

      try {
        if (recordingTargetIsIos()) {
          iosVideoStart = server.recordIosVideo("start");
          const video = await iosVideoStart;
          if (!video) throw new Error("Relay could not start the iPad recording.");
          iosVideoTakeId = video.id;
        }

        // A visible video alone is not enough to author a reliable journey.
        // Require fresh, selected-device evidence before exposing Record.
        const snapshot = await snapshotForRecording(true);
        if (!hasUsableDeviceBounds(snapshot)) {
          throw new Error("Relay could not read an inspectable device screen.");
        }
        await server.captureUiScreenshot("Recording ready", undefined, undefined, true);
        if (attempt !== recordingAttempt || !recordingTargetReady()) {
          throw new Error("The selected device changed while Relay was preparing it.");
        }

        if (!recordingGroup().trim()) setRecordingGroupState(group);
        setTake({
          id: takeId(),
          ...(pendingRecordingSourceScreenId
            ? { sourceScreenId: pendingRecordingSourceScreenId }
            : {}),
          ...(iosVideoTakeId ? { videoTakeId: iosVideoTakeId } : {}),
          startedAt: Date.now(),
          group,
          steps: [],
          state: "recording",
        });
        setInteracting(true);
        setRecording(true);
        return true;
      } catch (error) {
        await stopStartedIosVideo();
        setTake(null);
        setRecording(false);
        setInteracting(false);
        setRecordingGroupState("");
        recordingIssueSerial = server.selectedDevice();
        setRecordingIssue(issueForRecordingStart(error));
        return false;
      } finally {
        iosVideoStart = null;
        setArming(false);
      }
    }

    async function stopRecording(): Promise<void> {
      await flushType();
      recordingAttempt += 1;
      setRecording(false);
      setRecordingGroupState("");
      if (recordingTargetIsIos()) {
        const pendingStart = iosVideoStart;
        if (pendingStart) await pendingStart.catch(() => undefined);
        iosVideoStart = null;
        try {
          if (iosVideoTakeId) {
            const video = await server.recordIosVideo("stop");
            if (video?.warning) {
              setTake((current) => (current ? { ...current, videoTakeId: undefined } : current));
              toast(video.warning, "warning");
            }
          }
        } catch (error) {
          toast(error instanceof Error ? error.message : String(error), "warning");
        } finally {
          iosVideoTakeId = null;
        }
      }
      setTake((current) =>
        current ? { ...current, finishedAt: Date.now(), state: "review" } : current,
      );
      // Stopping capture returns to live control. Interacting with the mirrored
      // device and recording those interactions are separate concerns.
      setInteracting(true);
    }

    /** Execute a mirrored tap at the exact pointer position. The richer ref and
     * label stay on the recorded step for resilient replay, but direct control
     * must not depend on a higher-level app session. */
    async function executeTap(target: StepTarget, caption?: string): Promise<boolean> {
      if (target.point) {
        return server.interactStep(
          { kind: "point", x: target.point.x, y: target.point.y },
          caption,
        );
      }
      if (target.ref) {
        const ok = await server.interactStep({ kind: "ref", ref: target.ref }, caption);
        if (ok) return true;
      }
      if (target.label) {
        const ok = await server.interactStep({ kind: "label", label: target.label }, caption);
        if (ok) return true;
      }
      return false;
    }

    /**
     * Send a tap through the mirror: hit-test the current snapshot, build the
     * FULL target silently (ref · label · point — every known field), send the
     * interaction preferring ref → label → point exactly like the runner, and
     * if recording append a tap step. No strategy UI, no per-step toast — the
     * recorder bar is the single feedback surface (plan 010 step 3).
     */
    async function driveTap(fx: number, fy: number, alreadyApplied = false): Promise<boolean> {
      if (server.health() !== "online") {
        toast("Relay isn’t connected — can’t interact yet", "warning");
        return false;
      }
      // Flush any buffered typing first so order stays tap → type, not interleaved.
      await flushType();
      // H.264 may already have applied the tap. Recording still waits for its
      // evidence snapshot rather than treating that normal race as a pause.
      const snapshot = await snapshotForRecording(recording() || !alreadyApplied);
      if (!hasUsableDeviceBounds(snapshot)) {
        // The mirror has already delivered this first gesture. A just-connected
        // device commonly needs one more beat before Android exposes its tree;
        // that is a loading state, not an interaction failure.
        if (alreadyApplied && !recording()) {
          void server.captureUiSnapshot();
          return true;
        }
        if (recording()) noteMissingRecordingContext();
        else noteMissingInteractionContext();
        return alreadyApplied;
      }
      const hitNode = nodeAtPoint(snapshot, fx, fy);
      const targetNode = semanticTapNode(snapshot, hitNode);
      const target = buildTapTarget(snapshot?.bounds, targetNode, fx, fy);
      const evidence = recordedEvidence(snapshot, hitNode, fx, fy, server.selectedDevice());
      const step: Extract<RecipeStep, { kind: "tap" }> = { kind: "tap", target };
      const caption = describeStep(step);
      const ok = alreadyApplied ? true : await executeTap(target, caption);
      if (ok && recording()) {
        await appendRecordedStep(step, evidence, caption);
      }
      return ok;
    }

    /**
     * Send a swipe through the mirror. `from`/`to` are fractional image
     * coords (0..1); converted to device coords via snapshot bounds. Sends the
     * interaction and, if recording, appends a swipe step.
     */
    async function driveSwipe(
      from: { x: number; y: number },
      to: { x: number; y: number },
      durationMs: number,
      alreadyApplied = false,
    ): Promise<boolean> {
      if (server.health() !== "online") {
        toast("Relay isn’t connected — can’t interact yet", "warning");
        return false;
      }
      await flushType();
      const snapshot = await snapshotForRecording(recording() || !alreadyApplied);
      if (!hasUsableDeviceBounds(snapshot)) {
        if (alreadyApplied && !recording()) {
          void server.captureUiSnapshot();
          return true;
        }
        // The gesture has already reached the phone over H.264, but storing
        // fake 0/1 coordinates would make a future run actively misleading.
        if (recording()) noteMissingRecordingContext();
        else noteMissingInteractionContext();
        return alreadyApplied;
      }
      const b = snapshot?.bounds;
      const w = b?.width ?? 1;
      const h = b?.height ?? 1;
      const recordedPin = b
        ? {
            anchor: { horizontal: "left" as const, vertical: "top" as const },
            referenceBounds: { ...b },
          }
        : {};
      const devFrom = { x: Math.round(from.x * w), y: Math.round(from.y * h), ...recordedPin };
      const devTo = { x: Math.round(to.x * w), y: Math.round(to.y * h), ...recordedPin };
      const evidence = recordedEvidence(
        snapshot,
        nodeAtPoint(snapshot, from.x, from.y),
        from.x,
        from.y,
        server.selectedDevice(),
      );
      const step: Extract<RecipeStep, { kind: "swipe" }> = {
        kind: "swipe",
        from: devFrom,
        to: devTo,
        durationMs,
      };
      const caption = describeStep(step);
      const ok = alreadyApplied
        ? true
        : await server.interactStep(
            { kind: "swipe", from: devFrom, to: devTo, durationMs },
            caption,
          );
      if (ok && recording()) {
        await appendRecordedStep(step, evidence, caption);
      }
      return ok;
    }

    /**
     * Record a picker (right-click) choice as a tap step. The user explicitly
     * picked a strategy, so ONLY that strategy's field is recorded (plus point
     * as the emergency fallback); the runner's ref → label → text → point order
     * must not silently override the user's intent.
     */
    async function recordPick(
      strategy: PickStrategy,
      fx: number,
      fy: number,
      anchor: {
        horizontal: "left" | "center" | "right";
        vertical: "top" | "center" | "bottom";
      } = { horizontal: "left", vertical: "top" },
    ): Promise<void> {
      const snapshot = await snapshotForRecording(true);
      if (!hasUsableDeviceBounds(snapshot)) {
        noteMissingRecordingContext();
        return;
      }
      const target = targetFromStrategy(strategy, fx, fy, snapshot.bounds, anchor);
      const id = await ensureRecordingTarget();
      if (!id) return;
      const node = nodeAtPoint(snapshot, fx, fy);
      const evidence = recordedEvidence(snapshot, node, fx, fy, server.selectedDevice());
      const frame = await exactEvidenceFrame("Recorded target");
      if (frame) await attachEvidenceScreenshot(evidence, id, frame);
      const step = withRecordingGroup({ kind: "tap", target, evidence });
      setTake((current) =>
        current
          ? { ...current, recipeId: id, steps: [...current.steps, step] }
          : {
              id: takeId(),
              recipeId: id,
              startedAt: Date.now(),
              group: recordingGroup().trim() || nextRecordingGroup(),
              steps: [step],
              state: recording() ? "recording" : "review",
            },
      );
    }

    /** Commit a reviewed take to the executable recipe and return the exact
     * stable ids that were inserted. Canvas code must use this result instead
     * of guessing from recipe length, otherwise a concurrent edit can connect
     * a transition to the wrong action. */
    function keepTake(): RecipeStep[] | null {
      const current = take();
      if (!current || current.steps.length === 0) return null;
      const inserted = draft.appendSteps(current.steps);
      if (!inserted.length) return null;
      setTake(null);
      pendingRecordingSourceScreenId = undefined;
      toast(
        `Added ${inserted.length} action${inserted.length === 1 ? "" : "s"} to the journey`,
        "success",
      );
      return inserted;
    }

    function discardTake(): void {
      const current = take();
      setTake(null);
      pendingRecordingSourceScreenId = undefined;
      if (current?.steps.length) toast("Discarded this recording take", "info");
    }

    function removeTakeStep(index: number): void {
      setTake((current) =>
        current
          ? { ...current, steps: current.steps.filter((_, position) => position !== index) }
          : current,
      );
    }

    function setTakeVideoClip(videoClip: JourneyVideoClip): void {
      setTake((current) => (current ? { ...current, videoClip: { ...videoClip } } : current));
    }

    /** Rehydrate a stopped take from durable journey metadata. The caller only
     * does this for the active recipe; it never crosses journeys. */
    function restoreTake(next: RecordingTake): void {
      if (recording() || take()) return;
      setTake({ ...structuredClone(next), state: "review" });
    }

    // ── Typing capture (plan 010 step 3.3) ──────────────────────────────────
    // Keystrokes reach the phone immediately over scrcpy. A parallel logical
    // buffer groups them into ONE recorded type step after 800 ms idle or on
    // Enter; it is no longer on the device-delivery critical path.
    const [typeBuffer, setTypeBuffer] = createSignal("");
    let typeTimer: ReturnType<typeof setTimeout> | undefined;

    type TypeDeliveryGroup = {
      delivery: Promise<void>;
      appliedAny: boolean;
      batchFallback: boolean;
    };
    const createTypeDeliveryGroup = (): TypeDeliveryGroup => ({
      delivery: Promise.resolve(),
      appliedAny: false,
      batchFallback: false,
    });
    let typeDelivery = createTypeDeliveryGroup();

    function queueDeviceKey(
      input: { kind: "text"; text: string } | { kind: "key"; key: "enter" | "backspace" },
    ): void {
      const group = typeDelivery;
      group.delivery = group.delivery.then(async () => {
        // If the first key missed the live control session, keep this whole
        // group buffered so the legacy path can apply it once without partial
        // duplication while the video controller reconnects.
        if (group.batchFallback) return;
        const applied = await server.keyDevice(input);
        if (applied) {
          group.appliedAny = true;
          return;
        }
        if (!group.appliedAny) {
          group.batchFallback = true;
          return;
        }
        // A mid-group reconnect is rare. Retry once in order; printable text
        // then falls back as only the missing suffix, never the applied prefix.
        const retried = await server.keyDevice(input);
        if (!retried && input.kind === "text") {
          await server.interactStep({ kind: "type", text: input.text });
        }
      });
    }

    function scheduleTypeFlush(): void {
      clearTimeout(typeTimer);
      typeTimer = setTimeout(() => void flushType(), 800);
    }

    /** Finalize the current delivery group and optionally record one type step. */
    async function flushType(): Promise<void> {
      if (typeTimer) {
        clearTimeout(typeTimer);
        typeTimer = undefined;
      }
      const text = typeBuffer();
      const delivery = typeDelivery;
      typeDelivery = createTypeDeliveryGroup();
      setTypeBuffer("");
      await delivery.delivery;
      if (!text || server.health() !== "online") return;
      const snapshot = await snapshotForRecording(false);
      const evidence = recordedEvidence(
        snapshot,
        null,
        undefined,
        undefined,
        server.selectedDevice(),
      );
      const step: Extract<RecipeStep, { kind: "type" }> = { kind: "type", text };
      const caption = describeStep(step);
      const ok = delivery.batchFallback
        ? await server.interactStep({ kind: "type", text }, caption)
        : true;
      if (ok && recording()) {
        await appendRecordedStep(step, evidence, caption);
      }
    }

    /**
     * Apply a keyboard event to the phone and mirror its logical text locally.
     * Handles Escape (finish group), Enter, Backspace, and printable chars. Returns true
     * when the key was consumed (the caller may preventDefault). The caller is
     * responsible for the modal/focus/modifier gate so palette keys never reach
     * here.
     */
    function feedTypeKey(e: KeyboardEvent): boolean {
      if (e.key === "Escape") {
        void flushType();
        return true;
      }
      if (e.key === "Enter") {
        queueDeviceKey({ kind: "key", key: "enter" });
        void flushType();
        return true;
      }
      if (e.key === "Backspace") {
        queueDeviceKey({ kind: "key", key: "backspace" });
        setTypeBuffer((buffer) => Array.from(buffer).slice(0, -1).join(""));
        scheduleTypeFlush();
        return true;
      }
      if (Array.from(e.key).length === 1) {
        queueDeviceKey({ kind: "text", text: e.key });
        setTypeBuffer((b) => b + e.key);
        scheduleTypeFlush();
        return true;
      }
      return false;
    }

    /**
     * Fork any recipe (builtin or custom) into an editable custom copy. Builtins
     * are recipes whose steps are a single opaque `flow` step, so the copy is
     * honest now (previously it forked an empty recipe).
     */
    async function forkRecipe(recipe: {
      title: string;
      description?: string;
      steps: RecipeStep[];
    }): Promise<void> {
      const saved = await server.saveRecipeRemote({
        title: `${recipe.title} (copy)`,
        description: recipe.description,
        steps: recipe.steps,
      });
      if (saved) {
        server.setSelectedRecipeId(saved.id);
        toast(`Created a copy of “${recipe.title}”`, "success");
      }
    }

    // ---- One-time localStorage migration (plan 003, Step 2) ----
    // Reads legacy `specimen:custom-recipes`, converts each recipe to
    // RecipeSteps, and POSTs them to the server. The key is removed ONLY after
    // every recipe saves successfully; on failure we retry when health flips
    // back online. Losing a user's recorded recipes is the one unrecoverable
    // failure in this plan.
    let migrationInFlight = false;
    let migrationDone = false;
    async function migrateLegacyRecipes(): Promise<void> {
      if (migrationDone || migrationInFlight) return;
      if (server.health() !== "online") return;
      let raw: string | null = null;
      try {
        raw = localStorage.getItem(STORAGE_KEY);
      } catch {
        return;
      }
      if (!raw) {
        migrationDone = true;
        return;
      }
      let legacy: { id?: string; title?: string; steps?: LegacyRecStep[] }[] = [];
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) legacy = parsed as typeof legacy;
      } catch {
        // corrupt key — nothing we can migrate; leave it for safety
        migrationDone = true;
        return;
      }
      if (legacy.length === 0) {
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* ignore */
        }
        migrationDone = true;
        return;
      }
      migrationInFlight = true;
      let allOk = true;
      try {
        for (const r of legacy) {
          const steps = (r.steps ?? []).map(migrateLegacyStep);
          const saved = await server.saveRecipeRemote({
            title: (r.title ?? "Untitled journey").trim() || "Untitled journey",
            steps,
          });
          if (!saved) allOk = false;
        }
        if (allOk) {
          try {
            localStorage.removeItem(STORAGE_KEY);
          } catch {
            /* ignore */
          }
          migrationDone = true;
          toast(
            `Migrated ${legacy.length} recorded recipe${legacy.length === 1 ? "" : "s"} to the server`,
            "success",
          );
        }
      } finally {
        migrationInFlight = false;
      }
    }

    // attempt on init (no-op if offline) and retry when health flips online
    void migrateLegacyRecipes();
    createEffect(() => {
      if (server.health() === "online") void migrateLegacyRecipes();
    });

    return {
      interacting,
      setInteracting,
      recording,
      arming,
      recordingIssue,
      recordingGroup,
      take,
      keepTake,
      discardTake,
      removeTakeStep,
      setTakeVideoClip,
      restoreTake,
      setRecordingGroup,
      setRecordingSourceScreen,
      startNextRecordingGroup,
      setRecording,
      enterRecordMode,
      stopRecording,
      driveTap,
      driveSwipe,
      typeBuffer,
      feedTypeKey,
      flushType,
      recordPick,
      forkRecipe,
    };
  },
});
