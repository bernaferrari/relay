import {
  RecordingInputNotSentError,
  rejectedGestureBeforeDispatch,
} from "./recording-input-outcome";
import type {
  ProductRecordingBeginInput,
  ProductRecordingSaveInput,
  ProductRecordingState,
} from "@relay/product/recording-journey";
import { reviewAndroidTalkBack } from "@relay/protocol";
import type { Platform } from "../platform/types";
import { productClientForPlatform } from "./product-client";
import type { TalkBackCaptureResult } from "./talkback-overlay";
import type { LiveTargetSession } from "./live-target-session";
import type {
  AuthoringInteraction,
  AuthoringRawOptimizationProposalResponse,
  AuthoringRecordingEdit,
  AuthoringTarget,
} from "@relay/protocol";
import { reconcileOutcomeFromServerResponse } from "./recording-input-outcome";
import { presentReadyTargets, type ProductTargetOption } from "./target-presentation";
import {
  controlsForAuthoringEvidence,
  projectRecordingEvidenceControls,
  type RecordingEvidenceControl,
} from "./recording-evidence-target";

export type ProductAppOption = {
  id: string;
  name: string;
  /** Web, iOS, or Android; maps of one product share a family. */
  platform?: import("./app-families").AppPlatform;
  familyId?: string;
  familyName?: string;
};

export type RecordingEvidencePreview = {
  bytes: Uint8Array;
  mime: string;
  controls?: readonly RecordingEvidenceControl[];
  fullPage?: NonNullable<
    NonNullable<
      import("@relay/workflows").AuthorTestSnapshot["review"]
    >["actions"][number]["fullPage"]
  >;
};

/** Named review edits exposed to the React product surface.
 *
 * The adapter keeps React callers from constructing the protocol union while
 * retaining the protocol's immutable, server-owned edit semantics. Arrays are
 * readonly at the product boundary so callers can safely pass selected IDs
 * from component state; the adapter clones them before crossing the boundary.
 */
export type RecordingEditAdapter = {
  clip(fromMs?: number, toMs?: number): Promise<ProductRecordingState>;
  restore(sourceRevision: number): Promise<ProductRecordingState>;
  remove(actionIds: readonly string[]): Promise<ProductRecordingState>;
  reorder(actionIds: readonly string[]): Promise<ProductRecordingState>;
  replace(actionId: string, interaction: AuthoringInteraction): Promise<ProductRecordingState>;
  merge(actionIds: readonly string[], intent?: string): Promise<ProductRecordingState>;
  split(actionId: string, atStep: number): Promise<ProductRecordingState>;
  rename(actionId: string, intent: string): Promise<ProductRecordingState>;
};

/** Product-facing alias for consumers that model service slices explicitly. */
export type RecordingEditProductService = RecordingEditAdapter;

/** The only recording capability React components can see. It expresses
 * product intents rather than transports or workflow mutations. */
/** A wait or check added while recording. */
export type RecordingCondition = {
  /** wait: until text appears · gone: until text disappears · check: text is
   * on screen now · pause: a fixed wait, no text. */
  kind: "wait" | "gone" | "check" | "pause";
  /** Text to look for; ignored for a pause. */
  text: string;
  timeoutMs: number;
};

export type RecordingProductService = {
  listApps(): Promise<readonly ProductAppOption[]>;
  connect(): Promise<ProductRecordingState>;
  presentTargets(targets: readonly AuthoringTarget[]): Promise<readonly ProductTargetOption[]>;
  begin(input: ProductRecordingBeginInput): Promise<ProductRecordingState>;
  inspect(workflowId: string): Promise<ProductRecordingState>;
  /** Read-only optimizer suggestions for one canonical authoring session. */
  getOptimization(sessionId: string): Promise<AuthoringRawOptimizationProposalResponse>;
  /** Resolve one screenshot owned by the current authoring session through the
   * authenticated binary transport. Raw session state never crosses this seam. */
  getEvidencePreview(
    sessionId: string,
    evidenceId: string,
  ): Promise<RecordingEvidencePreview | null>;
  recordCurrent(): Promise<ProductRecordingState>;
  checkpoint(label?: string): Promise<ProductRecordingState>;
  /** Record "wait until this text appears" or "check this text is on screen";
   * it runs on the live page now, so the person sees it hold. */
  recordCondition?(input: RecordingCondition): Promise<ProductRecordingState>;
  captureFullPage?(): Promise<ProductRecordingState>;
  recoverForReview?(sessionId: string): Promise<ProductRecordingState>;
  stop(): Promise<ProductRecordingState>;
  cancel?(): Promise<ProductRecordingState>;
  edit(edit: AuthoringRecordingEdit): Promise<ProductRecordingState>;
  replay(): Promise<ProductRecordingState>;
  save?(input: ProductRecordingSaveInput): Promise<ProductRecordingState>;
  saveDraft?(
    input: Pick<ProductRecordingSaveInput, "reviewRevision" | "rename">,
  ): Promise<ProductRecordingState>;
  approve(testName: string): Promise<ProductRecordingState>;
  /** Open the selected target for exploration before durable recording begins. */
  previewTarget?(
    target: AuthoringTarget,
    identity?: import("./live-target-session").LiveBrowserOpenIdentity,
  ): Promise<LiveTargetSession>;
  liveTarget?(
    target: AuthoringTarget,
    identity?: import("./live-target-session").LiveBrowserOpenIdentity,
  ): Promise<LiveTargetSession>;
  /** Fresh accessibility controls from the live target. Historic screenshots are not this. */
  observeTarget?(target: AuthoringTarget): Promise<RecordingEvidenceControl[]>;
  /** Captured accessibility names from a live snapshot. Does not enable TalkBack. */
  reviewTalkBack?(serial: string): Promise<TalkBackCaptureResult>;
  /** Join a human observation to the durable target mutation receipt. */
  reconcileInput?(input: {
    serial: string;
    mutationId: string;
    resolutionId?: string;
    outcome: "applied" | "not-applied" | "ambiguous";
    reconcilePending?: boolean;
  }): Promise<{
    mutationId: string;
    resolutionId?: string;
    outcome: "applied" | "not-applied" | "ambiguous";
    health?: {
      state: "ready" | "blocked" | "uncertain";
      pendingMutationId?: string;
      reason?: string;
    };
    observation?: unknown;
  }>;
  fetchReconcileReceipt?(input: {
    serial: string;
    mutationId?: string;
    resolutionId?: string;
  }): Promise<{
    mutationId: string;
    resolutionId?: string;
    outcome: "applied" | "not-applied" | "ambiguous";
    health?: {
      state: "ready" | "blocked" | "uncertain";
      pendingMutationId?: string;
      reason?: string;
    };
    observation?: unknown;
  }>;
  /** Server-owned input fence for remount. The local ledger is only a projection. */
  inspectTargetHealth?(serial: string): Promise<{
    input: {
      state: "ready" | "blocked" | "uncertain";
      pendingMutationId?: string;
      reason?: string;
    };
  }>;
};

/**
 * Adapt the canonical edit operation into named product intents.
 *
 * This function is deliberately transport-agnostic: the supplied `edit`
 * method remains responsible for the durable workflow transition and its
 * optimistic concurrency fence. Keeping this seam small also makes it easy to
 * use in React tests without constructing a Relay client.
 */
export function createRecordingEditAdapter(
  service: Pick<RecordingProductService, "edit">,
): RecordingEditAdapter {
  return {
    clip: (fromMs, toMs) =>
      service.edit({
        kind: "clip",
        ...(fromMs !== undefined ? { fromMs } : {}),
        ...(toMs !== undefined ? { toMs } : {}),
      }),
    restore: (sourceRevision) => service.edit({ kind: "restore", sourceRevision }),
    remove: (actionIds) => service.edit({ kind: "remove", actionIds: [...actionIds] }),
    reorder: (actionIds) => service.edit({ kind: "reorder", actionIds: [...actionIds] }),
    replace: (actionId, interaction) => service.edit({ kind: "replace", actionId, interaction }),
    merge: (actionIds, intent) =>
      service.edit({
        kind: "merge",
        actionIds: [...actionIds],
        ...(intent !== undefined ? { intent } : {}),
      }),
    split: (actionId, atStep) => service.edit({ kind: "split", actionId, atStep }),
    rename: (actionId, intent) => service.edit({ kind: "rename", actionId, intent }),
  };
}

export function createRecordingProductService(
  platform: Platform,
): RecordingProductService & RecordingEditAdapter {
  let productPromise:
    | Promise<{
        client: Awaited<ReturnType<typeof productClientForPlatform>>["client"];
        journey: ReturnType<
          (typeof import("@relay/product/recording-journey"))["createProductRecordingJourneyFromClient"]
        >;
      }>
    | undefined;

  function product() {
    productPromise ??= Promise.resolve().then(async () => {
      const [{ client, actorId }, { createProductRecordingJourneyFromClient }] = await Promise.all([
        productClientForPlatform(platform),
        import("@relay/product/recording-journey"),
      ]);
      return {
        client,
        journey: createProductRecordingJourneyFromClient({ client, actorId }),
      };
    });
    return productPromise;
  }

  async function edit(edit: AuthoringRecordingEdit): Promise<ProductRecordingState> {
    return (await product()).journey.edit(edit);
  }

  return {
    async listApps() {
      const { appMaps } = await (await product()).client.invoke("app-map.list", {});
      const { appFamilies } = await import("./app-families");
      const families = appFamilies(appMaps);
      return appMaps.map((app) => ({ id: app.id, name: app.name, ...families.get(app.id) }));
    },
    async connect() {
      return (await product()).journey.connect();
    },
    async presentTargets(targets) {
      return presentReadyTargets((await product()).client, targets);
    },
    async begin(input) {
      return (await product()).journey.begin(input);
    },
    async inspect(workflowId) {
      return (await product()).journey.inspect(workflowId);
    },
    async getOptimization(sessionId) {
      return (await product()).client.invoke("authoring.take.optimization.get", { sessionId });
    },
    async getEvidencePreview(sessionId, evidenceId) {
      const { client } = await product();
      const { session } = await client.invoke("authoring.session.get", { sessionId });
      const take = session.take;
      const revision = take?.revisions.find(
        (candidate) => candidate.revision === take.currentRevision,
      );
      const evidence = revision?.evidence.find(
        (candidate) => candidate.id === evidenceId && candidate.kind === "screenshot",
      );
      if (!evidence) return null;
      const match = /^relay-evidence:\/\/([a-f\d]{64})$/iu.exec(evidence.uri);
      if (!match) return null;
      const mime = evidence.mime?.startsWith("image/") ? evidence.mime : "image/png";
      const action = revision?.actions?.find((candidate) =>
        candidate.evidenceIds.includes(evidenceId),
      );
      let fullPage = action?.fullPage;
      // Backward-compatible decoding for captures written before the action
      // descriptor existed. The snapshot is content-addressed evidence and
      // remains the source of truth for frame offsets and merged semantics.
      if (!fullPage && action) {
        const snapshotEvidence = revision?.evidence.find(
          (candidate) => action.evidenceIds.includes(candidate.id) && candidate.kind === "snapshot",
        );
        const snapshotHash = snapshotEvidence?.uri.match(
          /^relay-evidence:\/\/([a-f\d]{64})$/iu,
        )?.[1];
        if (snapshotHash) {
          try {
            const raw = await client.binaryResource(
              `/authoring-evidence/${encodeURIComponent(snapshotHash)}?mime=application%2Fjson&v=cors-v2`,
            );
            const parsed = JSON.parse(new TextDecoder().decode(raw.bytes)) as Record<
              string,
              unknown
            >;
            const frames = Array.isArray(parsed.frames) ? parsed.frames : [];
            const screenshots =
              revision?.evidence.filter(
                (candidate) =>
                  action.evidenceIds.includes(candidate.id) && candidate.kind === "screenshot",
              ) ?? [];
            if (parsed.kind !== "full-page-capture") throw new Error("not full-page evidence");
            fullPage = {
              status: parsed.status === "completed" ? "completed" : "stopped",
              reason: typeof parsed.reason === "string" ? parsed.reason : "unknown",
              message:
                typeof parsed.message === "string" ? parsed.message : "Review the retained frames.",
              frames: frames
                .map((frame, index) => ({
                  index: Number((frame as Record<string, unknown>).index ?? index),
                  offsetY: Number((frame as Record<string, unknown>).offsetY ?? 0),
                  evidenceId: screenshots[index]?.id ?? "",
                }))
                .filter((frame) => frame.evidenceId),
              diagnosticFrames: screenshots.slice(frames.length).map((candidate, index) => ({
                index: frames.length + index,
                offsetY: 0,
                evidenceId: candidate.id,
              })),
              mergedNodes: Array.isArray(parsed.mergedNodes)
                ? (parsed.mergedNodes as Array<Record<string, unknown>>)
                : [],
            };
          } catch {
            fullPage = undefined;
          }
        }
      }
      const resource = await client.binaryResource(
        `/authoring-evidence/${encodeURIComponent(match[1]!)}?mime=${encodeURIComponent(mime)}&v=cors-v2`,
      );
      let controls = controlsForAuthoringEvidence(revision, evidenceId);
      if (fullPage) {
        const frame = fullPage.frames.find((candidate) => candidate.evidenceId === evidenceId);
        // Diagnostic rasters are review-only and never inherit logical
        // surface controls. Accepted frames alone have a document offset.
        if (frame) {
          const nodes = fullPage.mergedNodes as Record<string, unknown>[];
          controls = projectRecordingEvidenceControls(nodes).map((control) => ({
            ...control,
            rect: { ...control.rect, y: control.rect.y - frame.offsetY },
          }));
        } else {
          controls = [];
        }
      }
      return {
        bytes: resource.bytes,
        mime: resource.headers.get("content-type")?.split(";")[0] ?? mime,
        ...(fullPage ? { controls } : controls.length ? { controls } : {}),
        ...(fullPage ? { fullPage } : {}),
      };
    },
    async recordCurrent() {
      return (await product()).journey.record({ kind: "observe" });
    },
    async recoverForReview(sessionId) {
      const recording = await product();
      await recording.client.invoke("authoring.session.observe", { sessionId });
      return recording.journey.inspect();
    },
    async captureFullPage() {
      return (await product()).journey.record({
        kind: "screenshot",
        fullPage: true,
        label: "Capture full page",
      });
    },
    async checkpoint(label) {
      return (await product()).journey.checkpoint(label);
    },
    async recordCondition(input) {
      const text = input.text.trim();
      const seconds = Math.round(input.timeoutMs / 1000);
      const duration = seconds % 60 === 0 && seconds >= 60 ? `${seconds / 60} min` : `${seconds}s`;
      if (input.kind === "pause") {
        return (await product()).journey.record({
          kind: "steps",
          label: `Wait ${duration}`,
          steps: [{ kind: "sleep", ms: input.timeoutMs }],
        });
      }
      if (!text) throw new TypeError("Enter the text to look for.");
      return (await product()).journey.record(
        input.kind === "wait"
          ? {
              kind: "steps",
              label: `Wait until “${text}” appears (up to ${duration})`,
              steps: [{ kind: "wait-for", target: { text }, timeoutMs: input.timeoutMs }],
            }
          : input.kind === "gone"
            ? {
                kind: "steps",
                label: `Wait until “${text}” is gone (up to ${duration})`,
                steps: [
                  {
                    kind: "expect",
                    target: { text },
                    condition: "gone",
                    timeoutMs: input.timeoutMs,
                  },
                ],
              }
            : {
                kind: "steps",
                label: `Check “${text}” is on screen`,
                steps: [
                  {
                    kind: "expect",
                    target: { text },
                    condition: "visible",
                    timeoutMs: input.timeoutMs,
                  },
                ],
              },
      );
    },
    async stop() {
      return (await product()).journey.stop();
    },
    async cancel() {
      return (await product()).journey.transition({ action: "cancel" });
    },
    edit,
    ...createRecordingEditAdapter({ edit }),
    async replay() {
      return (await product()).journey.replay();
    },
    async approve(testName) {
      return (await product()).journey.approve(testName);
    },
    async save(input) {
      return (await product()).journey.save(input);
    },
    async saveDraft(input) {
      return (await product()).journey.saveDraft(input);
    },
    async liveTarget(target, identity) {
      const [recording, { createLiveTargetSession }] = await Promise.all([
        product(),
        import("./live-target-session"),
      ]);
      return createLiveTargetSession({
        client: recording.client,
        target,
        ...(identity ? { identity } : {}),
        // Input from the live canvas is already the user's recording intent.
        // ProductRecordingJourney performs the canonical target mutation and
        // appends the same interaction to the durable authoring workflow.
        onInteraction: async (interaction) => {
          const state = await recording.journey.record(interaction);
          if (state.recovery) {
            if (state.recovery.code === "input-not-dispatched") {
              throw new RecordingInputNotSentError(state.recovery.detail);
            }
            if (rejectedGestureBeforeDispatch(state.recovery.detail)) {
              throw new RecordingInputNotSentError("The scroll exceeded the screen bounds.");
            }
            throw new Error(`${state.recovery.detail} ${state.recovery.recovery}`.trim());
          }
        },
      });
    },
    async previewTarget(target, identity) {
      const [recording, { createLiveTargetSession }] = await Promise.all([
        product(),
        import("./live-target-session"),
      ]);
      return createLiveTargetSession({
        client: recording.client,
        target,
        ...(identity ? { identity } : {}),
      });
    },
    async observeTarget(target) {
      const { client } = await product();
      const snapshot = await client.invoke("target.snapshot.capture", {
        serial: target.targetId,
        full: true,
      });
      return projectRecordingEvidenceControls(snapshot.nodes as Record<string, unknown>[]);
    },
    async reviewTalkBack(serial) {
      const { client } = await product();
      const snapshot = await client.invoke("target.snapshot.capture", {
        serial,
        full: true,
      });
      const inspectable = snapshot.inspectable !== false;
      return {
        inspectable,
        review: reviewAndroidTalkBack(snapshot.nodes ?? []),
        bounds: snapshot.bounds,
        ...(inspectable
          ? {}
          : {
              message:
                snapshot.inspectionState === "keyguard"
                  ? "Unlock the device to read accessibility names."
                  : "Accessibility names are unavailable. The live view still works.",
            }),
      };
    },
    async reconcileInput(input) {
      const { client } = await product();
      const result = await client.invoke("target.input.reconcile", {
        serial: input.serial,
        mutationId: input.mutationId,
        ...(input.resolutionId ? { resolutionId: input.resolutionId } : {}),
        outcome: input.outcome,
        ...(input.reconcilePending ? { reconcilePending: true } : {}),
      });
      const pending = result.health?.input?.pendingMutationId;
      const state = result.health?.input?.state;
      const returned = result.outcome as "applied" | "not-applied" | "ambiguous" | undefined;
      const outcome = reconcileOutcomeFromServerResponse({
        ...(returned ? { returned } : {}),
        ...(state ? { healthState: state } : {}),
      });
      return {
        mutationId: pending ?? input.mutationId,
        ...(typeof result.resolutionId === "string" ? { resolutionId: result.resolutionId } : {}),
        outcome,
        ...(result.health?.input
          ? {
              health: {
                state: result.health.input.state,
                ...(pending ? { pendingMutationId: pending } : {}),
                ...(result.health.input.reason ? { reason: result.health.input.reason } : {}),
              },
            }
          : {}),
        ...(result.observation ? { observation: result.observation } : {}),
      };
    },
    async fetchReconcileReceipt(input) {
      const { client } = await product();
      const result = await client.invoke("target.input.receipt.get", {
        serial: input.serial,
        ...(input.mutationId ? { mutationId: input.mutationId } : {}),
        ...(input.resolutionId ? { resolutionId: input.resolutionId } : {}),
      });
      const receipt = result.receipt;
      return {
        mutationId: receipt.mutationId,
        resolutionId: receipt.resolutionId,
        outcome: receipt.outcome,
        ...(receipt.health ? { health: receipt.health } : {}),
        ...(receipt.observation ? { observation: receipt.observation } : {}),
      };
    },
    async inspectTargetHealth(serial) {
      const { client } = await product();
      const { health } = await client.invoke("target.health.get", { serial });
      return {
        input: {
          state: health.input.state,
          ...(health.input.pendingMutationId
            ? { pendingMutationId: health.input.pendingMutationId }
            : {}),
          ...(health.input.reason ? { reason: health.input.reason } : {}),
        },
      };
    },
  };
}

export type {
  ProductRecordingRecovery,
  ProductRecordingState,
} from "@relay/product/recording-journey";
