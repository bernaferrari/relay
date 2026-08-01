import { createMemo, createSignal } from "solid-js";
import type {
  AuthoringInteraction,
  AuthoringObservation,
  AuthoringSession,
  JourneyScreenObservation,
  JourneyVideoClip,
} from "@relay/protocol";
import { createSimpleContext } from "@relay/ui/context/helper";
import {
  useServer,
  type RecipeStep,
  type SnapshotNode,
  type SnapshotState,
  type StepTarget,
} from "./server";
import { ancestryOf, nodeAtPoint, targetFromStrategy, type PickStrategy } from "../lib/snapshot";
import { sentenceForStep } from "../lib/step-sentence";
import { targetIsReady } from "../lib/target-presentation";
import { useRecipeDraft } from "./recipe-draft";
import { toast } from "./toast";

export type RecLevel = "smart" | "element" | "point";

/** UI shape projected from the server-owned immutable Take revision. */
export type RecordingTake = {
  id: string;
  sessionId: string;
  revision: number;
  recipeId: string;
  sourceScreenId?: string;
  sourceObservation?: JourneyScreenObservation;
  destinationObservation?: JourneyScreenObservation;
  startedAt: number;
  finishedAt?: number;
  group: string;
  steps: RecipeStep[];
  actionIds: string[];
  stepEvidenceUrls: string[];
  state: "recording" | "review";
  videoEvidenceUrl?: string;
  videoClip?: JourneyVideoClip;
};

export type RecordingIssue = { kind: "setup" | "screen"; message: string };

export type CapturedStartScreen = {
  observation: JourneyScreenObservation;
  screenshotUrl?: string;
};

export const describeStep = sentenceForStep;

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

export function buildTapTarget(
  bounds: { width: number; height: number } | undefined,
  node: SnapshotNode | null,
  fx: number,
  fy: number,
): StepTarget {
  const width = bounds?.width ?? 1;
  const height = bounds?.height ?? 1;
  const point = {
    x: Math.round(fx * width),
    y: Math.round(fy * height),
    anchor: { horizontal: "left", vertical: "top" } as const,
    ...(bounds ? { referenceBounds: { ...bounds } } : {}),
  };
  if (!node) return { point };
  const label = (node.label ?? node.value ?? "").trim();
  return {
    ...(node.ref ? { ref: node.ref.startsWith("@") ? node.ref : `@${node.ref}` } : {}),
    ...(label ? { label } : {}),
    point,
  };
}

export function semanticTapNode(
  snapshot: SnapshotState,
  node: SnapshotNode | null,
): SnapshotNode | null {
  if (!snapshot || !node) return node;
  return (
    ancestryOf(snapshot, node).find((candidate) =>
      Boolean((candidate.label ?? candidate.value ?? "").trim()),
    ) ?? node
  );
}

function sessionRevision(session: AuthoringSession) {
  const take = session.take;
  return take?.revisions.find((revision) => revision.revision === take.currentRevision);
}

function projectedObservation(value: AuthoringObservation): JourneyScreenObservation | undefined {
  if (!value || typeof value !== "object" || !("screen" in value)) return undefined;
  return structuredClone(value.screen as JourneyScreenObservation);
}

function projectTake(
  session: AuthoringSession,
  evidenceUrl: (uri: string, mime?: string) => string,
): RecordingTake | null {
  const take = session.take;
  const revision = sessionRevision(session);
  if (!take || !revision) return null;
  const evidenceById = new Map(revision.evidence.map((item) => [item.id, item]));
  const steps: RecipeStep[] = [];
  const actionIds: string[] = [];
  const stepEvidenceUrls: string[] = [];
  for (const action of revision.actions) {
    const screenshot = action.evidenceIds
      .map((id) => evidenceById.get(id))
      .find((item) => item?.kind === "screenshot");
    for (const step of action.steps) {
      steps.push(structuredClone(step));
      actionIds.push(action.id);
      stepEvidenceUrls.push(screenshot ? evidenceUrl(screenshot.uri, screenshot.mime) : "");
    }
  }
  const video = revision.evidence.find((item) => item.kind === "video");
  return {
    id: take.id,
    sessionId: session.id,
    revision: revision.revision,
    recipeId: session.journeyId,
    ...(session.sourceScreenId ? { sourceScreenId: session.sourceScreenId } : {}),
    ...(revision.before ? { sourceObservation: projectedObservation(revision.before) } : {}),
    ...(revision.after ? { destinationObservation: projectedObservation(revision.after) } : {}),
    startedAt: take.createdAt,
    ...(session.state !== "recording" ? { finishedAt: take.updatedAt } : {}),
    group: session.group ?? "",
    steps,
    actionIds,
    stepEvidenceUrls,
    state: session.state === "recording" ? "recording" : "review",
    ...(video ? { videoEvidenceUrl: evidenceUrl(video.uri, video.mime) } : {}),
    ...(revision.videoClip ? { videoClip: { ...revision.videoClip } } : {}),
  };
}

function issueFromSession(session: AuthoringSession | null): RecordingIssue | null {
  if (!session || session.state !== "failed" || !session.error) return null;
  return {
    kind: /sign|xcode|runner|developer mode|provision/i.test(session.error) ? "setup" : "screen",
    message: session.error,
  };
}

export function selectProjectedAuthoringSession(
  sessions: readonly AuthoringSession[],
  input: { journeyId: string | null; targetId: string | null; actorId: string },
): AuthoringSession | null {
  const relevant = sessions
    .filter(
      (session) =>
        session.journeyId === input.journeyId &&
        !["committed", "cancelled"].includes(session.state) &&
        (!input.targetId || session.target.targetId === input.targetId),
    )
    .sort((left, right) => right.updatedAt - left.updatedAt);
  return relevant.find((session) => session.actorId === input.actorId) ?? relevant[0] ?? null;
}

export const { use: useRecorder, provider: RecorderProvider } = createSimpleContext({
  name: "Recorder",
  gate: false,
  init: () => {
    const server = useServer();
    const draft = useRecipeDraft();
    const [interacting, setInteracting] = createSignal(false);
    const [pendingGroup, setPendingGroup] = createSignal("");
    const [pendingSourceScreenId, setPendingSourceScreenId] = createSignal<string>();
    const [pendingTransitionId, setPendingTransitionId] = createSignal<string>();

    const activeSession = createMemo(() =>
      selectProjectedAuthoringSession(server.authoringSessions(), {
        journeyId: server.selectedRecipeId(),
        targetId: server.selectedDevice(),
        actorId: server.actorId(),
      }),
    );
    const ownsActiveSession = () => activeSession()?.actorId === server.actorId();
    const take = createMemo(() => {
      const session = activeSession();
      return session ? projectTake(session, server.authoringEvidenceUrl) : null;
    });
    const recording = createMemo(() => activeSession()?.state === "recording");
    const arming = createMemo(() => activeSession()?.state === "preparing");
    const recordingIssue = createMemo(() => issueFromSession(activeSession()));
    const recordingGroup = createMemo(() => activeSession()?.group ?? pendingGroup());

    const targetReady = () =>
      targetIsReady(
        server.devices().find((device) => device.serial === server.selectedDevice()),
        server.health() === "online",
      );

    function setRecordingGroup(value: string): void {
      if (activeSession()) return;
      setPendingGroup(value.slice(0, 96));
    }

    function setRecordingSourceScreen(value: string | undefined): void {
      if (activeSession()) return;
      setPendingSourceScreenId(value);
    }

    function setRecordingTransition(value: string | undefined): void {
      if (activeSession()) return;
      setPendingTransitionId(value);
    }

    function startNextRecordingGroup(): void {
      if (!activeSession()) setPendingGroup("");
    }

    async function enterRecordMode(): Promise<boolean> {
      const existing = activeSession();
      if (existing) {
        if (!ownsActiveSession()) {
          toast("Another collaborator is using this device", "info");
          return false;
        }
        if (existing.state === "failed") {
          const ready = await server.observeAuthoringSession(existing.id);
          if (ready.state !== "ready") return false;
          const started = await server.startAuthoringSession(existing.id);
          setInteracting(started.state === "recording");
          return started.state === "recording";
        }
        return false;
      }
      if (!targetReady()) {
        toast("Choose a ready device before recording", "info");
        window.dispatchEvent(new CustomEvent("relay:open-device-picker"));
        return false;
      }
      const journeyId = await draft.ensureRecordingDraft(() => "Untitled");
      const device = server.devices().find((item) => item.serial === server.selectedDevice());
      const leaseId = server.selectedLeaseId();
      const recipe = server.recipes().find((item) => item.id === journeyId);
      if (!journeyId || !device || !leaseId || !recipe) {
        toast(
          "Relay needs an App Map, device, and active control lease before recording",
          "warning",
        );
        return false;
      }
      try {
        const document = await server.loadJourney(journeyId);
        let session = await server.createAuthoringSession({
          journeyId,
          target:
            device.platform === "browser"
              ? { kind: "browser", platform: "browser", targetId: device.serial }
              : {
                  kind: "device",
                  platform: device.platform === "ios" ? "ios" : "android",
                  targetId: device.serial,
                },
          leaseId,
          expectedJourneyRevision: document.revision,
          expectedRecipeRevision: recipe.updatedAt,
          ...(pendingSourceScreenId() ? { sourceScreenId: pendingSourceScreenId() } : {}),
          ...(pendingTransitionId() ? { pendingTransitionId: pendingTransitionId() } : {}),
          ...(pendingGroup().trim() ? { group: pendingGroup().trim() } : {}),
        });
        session = await server.observeAuthoringSession(session.id);
        if (session.state !== "ready") return false;
        session = await server.startAuthoringSession(session.id);
        setInteracting(session.state === "recording");
        return session.state === "recording";
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), "warning");
        return false;
      }
    }

    /** Capture the current target through the same authoritative observation
     * boundary used by recording, then discard the temporary zero-action Take.
     * The canvas receives identity + evidence without inventing an executable
     * action or leaving a hidden recording session behind. */
    async function captureStartScreen(): Promise<CapturedStartScreen | null> {
      if (activeSession()) {
        toast("Finish the current recording before choosing a start screen", "info");
        return null;
      }
      if (!targetReady()) {
        toast("Choose a ready device before capturing the start screen", "info");
        window.dispatchEvent(new CustomEvent("relay:open-device-picker"));
        return null;
      }
      const journeyId = await draft.ensureRecordingDraft(() => "Untitled");
      const device = server.devices().find((item) => item.serial === server.selectedDevice());
      const leaseId = server.selectedLeaseId();
      const recipe = server.recipes().find((item) => item.id === journeyId);
      if (!journeyId || !device || !leaseId || !recipe) {
        toast(
          "Relay needs an App Map, device, and active control lease to capture this screen",
          "warning",
        );
        return null;
      }

      let session: AuthoringSession | null = null;
      try {
        const document = await server.loadJourney(journeyId);
        session = await server.createAuthoringSession({
          journeyId,
          target:
            device.platform === "browser"
              ? { kind: "browser", platform: "browser", targetId: device.serial }
              : {
                  kind: "device",
                  platform: device.platform === "ios" ? "ios" : "android",
                  targetId: device.serial,
                },
          leaseId,
          expectedJourneyRevision: document.revision,
          expectedRecipeRevision: recipe.updatedAt,
        });
        session = await server.observeAuthoringSession(session.id);
        if (session.state !== "ready")
          throw new Error(session.error || "Device screen is not ready");
        session = await server.startAuthoringSession(session.id);
        if (session.state !== "recording") {
          throw new Error(session.error || "Could not capture the current screen");
        }
        session = await server.stopAuthoringSession(session.id);
        const revision = sessionRevision(session);
        const observation = revision?.before ? projectedObservation(revision.before) : undefined;
        const screenshot = revision?.evidence.find((item) => item.kind === "screenshot");
        if (!observation) throw new Error("The device did not return a screen observation");
        await server.discardAuthoringSession(session.id);
        session = null;
        return {
          observation,
          ...(screenshot
            ? { screenshotUrl: server.authoringEvidenceUrl(screenshot.uri, screenshot.mime) }
            : {}),
        };
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), "warning");
        return null;
      } finally {
        if (session) {
          if (session.state === "reviewing") {
            await server.discardAuthoringSession(session.id).catch(() => undefined);
          } else {
            await server.cancelAuthoringSession(session.id).catch(() => undefined);
          }
        }
      }
    }

    async function stopRecording(): Promise<void> {
      await flushType();
      const session = activeSession();
      if (!session || !ownsActiveSession() || session.state !== "recording") return;
      await server.stopAuthoringSession(session.id);
      setInteracting(true);
    }

    async function driveTap(fx: number, fy: number, alreadyApplied = false): Promise<boolean> {
      if (server.health() !== "online") return false;
      await flushType();
      const snapshot = server.snapshot() ?? (await server.captureUiSnapshot());
      if (!hasUsableDeviceBounds(snapshot)) {
        toast("Relay needs an inspectable device screen for this gesture", "warning");
        return alreadyApplied;
      }
      const node = nodeAtPoint(snapshot, fx, fy);
      const target = buildTapTarget(snapshot.bounds, semanticTapNode(snapshot, node), fx, fy);
      const session = activeSession();
      if (session?.state === "recording" && ownsActiveSession()) {
        await server.interactAuthoringSession(session.id, {
          kind: "tap",
          target,
          ...(alreadyApplied ? { applied: true } : {}),
        });
        return true;
      }
      if (alreadyApplied) return true;
      if (target.point) {
        return server.interactStep({ kind: "point", x: target.point.x, y: target.point.y });
      }
      if (target.ref) return server.interactStep({ kind: "ref", ref: target.ref });
      return target.label ? server.interactStep({ kind: "label", label: target.label }) : false;
    }

    async function driveSwipe(
      from: { x: number; y: number },
      to: { x: number; y: number },
      durationMs: number,
      alreadyApplied = false,
    ): Promise<boolean> {
      if (server.health() !== "online") return false;
      await flushType();
      const snapshot = server.snapshot() ?? (await server.captureUiSnapshot());
      if (!hasUsableDeviceBounds(snapshot)) return alreadyApplied;
      const pin = {
        anchor: { horizontal: "left" as const, vertical: "top" as const },
        referenceBounds: { ...snapshot.bounds },
      };
      const interaction: AuthoringInteraction = {
        kind: "swipe",
        from: {
          x: Math.round(from.x * snapshot.bounds.width),
          y: Math.round(from.y * snapshot.bounds.height),
          ...pin,
        },
        to: {
          x: Math.round(to.x * snapshot.bounds.width),
          y: Math.round(to.y * snapshot.bounds.height),
          ...pin,
        },
        durationMs,
        ...(alreadyApplied ? { applied: true } : {}),
      };
      const session = activeSession();
      if (session?.state === "recording" && ownsActiveSession()) {
        await server.interactAuthoringSession(session.id, interaction);
        return true;
      }
      if (alreadyApplied) return true;
      return server.interactStep({
        kind: "swipe",
        from: interaction.from,
        to: interaction.to,
        durationMs,
      });
    }

    async function recordPick(
      strategy: PickStrategy,
      fx: number,
      fy: number,
      anchor: {
        horizontal: "left" | "center" | "right";
        vertical: "top" | "center" | "bottom";
      } = { horizontal: "left", vertical: "top" },
    ): Promise<void> {
      const session = activeSession();
      if (!session || session.state !== "recording" || !ownsActiveSession()) return;
      const snapshot = server.snapshot() ?? (await server.captureUiSnapshot());
      if (!hasUsableDeviceBounds(snapshot)) return;
      const target = targetFromStrategy(strategy, fx, fy, snapshot.bounds, anchor);
      await server.interactAuthoringSession(session.id, { kind: "tap", target });
    }

    async function replayTake(): Promise<boolean> {
      const session = activeSession();
      if (!session || session.state !== "reviewing" || !ownsActiveSession()) return false;
      const replayed = await server.replayAuthoringTake(session.id);
      return replayed.take?.replayAttempts.at(-1)?.outcome === "passed";
    }

    async function keepTake(
      input: {
        destination?:
          | { kind: "new-screen"; title?: string }
          | { kind: "screen"; screenId: string }
          | { kind: "end" };
        mode?: "interaction" | "automatic" | "reusable";
      } = {},
    ): Promise<AuthoringSession | null> {
      const session = activeSession();
      if (!session || session.state !== "reviewing" || !ownsActiveSession()) return null;
      const committed = await server.commitAuthoringSession(session.id, input);
      setPendingSourceScreenId(undefined);
      setPendingTransitionId(undefined);
      setPendingGroup("");
      toast("Connection added to the map", "success");
      return committed;
    }

    async function discardTake(): Promise<void> {
      const session = activeSession();
      if (!session || !ownsActiveSession()) return;
      if (session.state === "reviewing") await server.discardAuthoringSession(session.id);
      else await server.cancelAuthoringSession(session.id);
      setPendingSourceScreenId(undefined);
      setPendingTransitionId(undefined);
      setPendingGroup("");
    }

    async function removeTakeStep(index: number): Promise<void> {
      const current = take();
      const session = activeSession();
      if (!current || !session || !ownsActiveSession()) return;
      const actionId = current.actionIds[index];
      if (!actionId) return;
      const indexes = current.actionIds
        .map((id, position) => ({ id, position }))
        .filter((item) => item.id === actionId)
        .map((item) => item.position);
      if (indexes.length > 1) {
        await server.replaceAuthoringAction(session.id, actionId, {
          kind: "steps",
          steps: indexes
            .filter((position) => position !== index)
            .map((position) => current.steps[position]!),
        });
      } else {
        const actionIds = [...new Set(current.actionIds.filter((id) => id !== actionId))];
        await server.trimAuthoringTake(session.id, { actionIds });
      }
    }

    async function setTakeVideoClip(videoClip: JourneyVideoClip): Promise<void> {
      const session = activeSession();
      if (!session || !ownsActiveSession()) return;
      await server.trimAuthoringTake(session.id, {
        fromMs: videoClip.startMs,
        toMs: videoClip.endMs,
      });
    }

    const [typeBuffer, setTypeBuffer] = createSignal("");
    let typeTimer: ReturnType<typeof setTimeout> | undefined;
    let typeDelivery = Promise.resolve(true);

    function queueDeviceKey(
      input: { kind: "text"; text: string } | { kind: "key"; key: "enter" | "backspace" },
    ): void {
      typeDelivery = typeDelivery.then(() => server.keyDevice(input));
    }

    function scheduleTypeFlush(): void {
      clearTimeout(typeTimer);
      typeTimer = setTimeout(() => void flushType(), 800);
    }

    async function flushType(): Promise<void> {
      if (typeTimer) clearTimeout(typeTimer);
      typeTimer = undefined;
      const text = typeBuffer();
      setTypeBuffer("");
      const applied = await typeDelivery;
      typeDelivery = Promise.resolve(true);
      if (!text) return;
      const session = activeSession();
      if (session?.state === "recording" && ownsActiveSession()) {
        await server.interactAuthoringSession(session.id, {
          kind: "type",
          text,
          ...(applied ? { applied: true } : {}),
        });
      } else if (!applied) {
        await server.interactStep({ kind: "type", text });
      }
    }

    function feedTypeKey(event: KeyboardEvent): boolean {
      if (event.key === "Escape") {
        void flushType();
        return true;
      }
      if (event.key === "Enter") {
        queueDeviceKey({ kind: "key", key: "enter" });
        void flushType();
        return true;
      }
      if (event.key === "Backspace") {
        queueDeviceKey({ kind: "key", key: "backspace" });
        setTypeBuffer((value) => Array.from(value).slice(0, -1).join(""));
        scheduleTypeFlush();
        return true;
      }
      if (Array.from(event.key).length === 1) {
        queueDeviceKey({ kind: "text", text: event.key });
        setTypeBuffer((value) => value + event.key);
        scheduleTypeFlush();
        return true;
      }
      return false;
    }

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

    return {
      interacting,
      setInteracting,
      recording,
      arming,
      recordingIssue,
      recordingGroup,
      take,
      activeSession,
      ownsActiveSession,
      keepTake,
      replayTake,
      discardTake,
      removeTakeStep,
      setTakeVideoClip,
      setRecordingGroup,
      setRecordingSourceScreen,
      setRecordingTransition,
      startNextRecordingGroup,
      enterRecordMode,
      captureStartScreen,
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
