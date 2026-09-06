import type {
  ProductRecordingBeginInput,
  ProductRecordingState,
} from "@relay/product/recording-journey";
import type { Platform } from "../platform/types";
import { productClientForPlatform } from "./product-client";
import type { LiveTargetSession } from "./live-target-session";
import type {
  AuthoringInteraction,
  AuthoringRawOptimizationProposalResponse,
  AuthoringRecordingEdit,
  AuthoringTarget,
} from "@relay/protocol";
import { presentReadyTargets, type ProductTargetOption } from "./target-presentation";
import {
  controlsForAuthoringEvidence,
  projectRecordingEvidenceControls,
  type RecordingEvidenceControl,
} from "./recording-evidence-target";

export type ProductAppOption = {
  id: string;
  name: string;
};

export type RecordingEvidencePreview = {
  bytes: Uint8Array;
  mime: string;
  controls?: readonly RecordingEvidenceControl[];
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
  stop(): Promise<ProductRecordingState>;
  edit(edit: AuthoringRecordingEdit): Promise<ProductRecordingState>;
  replay(): Promise<ProductRecordingState>;
  approve(testName: string): Promise<ProductRecordingState>;
  /** Open the selected target for exploration before durable recording begins. */
  previewTarget?(target: AuthoringTarget): Promise<LiveTargetSession>;
  liveTarget?(target: AuthoringTarget): Promise<LiveTargetSession>;
  /** Fresh accessibility controls from the live target. Historic screenshots are not this. */
  observeTarget?(target: AuthoringTarget): Promise<RecordingEvidenceControl[]>;
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
      return appMaps.map((app) => ({ id: app.id, name: app.name }));
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
      const resource = await client.binaryResource(
        `/authoring-evidence/${encodeURIComponent(match[1]!)}?mime=${encodeURIComponent(mime)}`,
      );
      const controls = controlsForAuthoringEvidence(revision, evidenceId);
      return {
        bytes: resource.bytes,
        mime: resource.headers.get("content-type")?.split(";")[0] ?? mime,
        ...(controls.length ? { controls } : {}),
      };
    },
    async recordCurrent() {
      return (await product()).journey.record({ kind: "observe" });
    },
    async checkpoint(label) {
      return (await product()).journey.checkpoint(label);
    },
    async stop() {
      return (await product()).journey.stop();
    },
    edit,
    ...createRecordingEditAdapter({ edit }),
    async replay() {
      return (await product()).journey.replay();
    },
    async approve(testName) {
      return (await product()).journey.approve(testName);
    },
    async liveTarget(target) {
      const [recording, { createLiveTargetSession }] = await Promise.all([
        product(),
        import("./live-target-session"),
      ]);
      return createLiveTargetSession({
        client: recording.client,
        target,
        // Input from the live canvas is already the user's recording intent.
        // ProductRecordingJourney performs the canonical target mutation and
        // appends the same interaction to the durable authoring workflow.
        onInteraction: async (interaction) => {
          const state = await recording.journey.record(interaction);
          if (state.recovery) {
            throw new Error(`${state.recovery.detail} ${state.recovery.recovery}`.trim());
          }
        },
      });
    },
    async previewTarget(target) {
      const [recording, { createLiveTargetSession }] = await Promise.all([
        product(),
        import("./live-target-session"),
      ]);
      return createLiveTargetSession({ client: recording.client, target });
    },
    async observeTarget(target) {
      const { client } = await product();
      const snapshot = await client.invoke("target.snapshot.capture", {
        serial: target.targetId,
        full: true,
      });
      return projectRecordingEvidenceControls(snapshot.nodes as Record<string, unknown>[]);
    },
  };
}

export type {
  ProductRecordingRecovery,
  ProductRecordingState,
} from "@relay/product/recording-journey";
