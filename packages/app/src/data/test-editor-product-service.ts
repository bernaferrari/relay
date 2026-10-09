import type {
  ActivityEvent,
  AppMap,
  AppMapScenarioTest,
  AppMapTestBindingCandidate,
  AppMapScenarioTestEdit,
  Proposal,
} from "@relay/protocol";
import { testHasRememberableReply } from "@relay/protocol";
import {
  PLAN_PLATFORMS,
  recordedPlanPlatformsFromAppMap,
  recordedRoutePlatformBlocker,
  testStepPlatformBlockers,
  type PlanPlatform,
} from "@relay/product/test-route-platforms";
import { scenarioTestOriginMissingEvidence } from "@relay/product/test-origin-readiness";
import { testInstructionDisplayTitles } from "@relay/workflows/recorded-step-presentation";
import type { Platform } from "../platform/types";
import { productClientForPlatform } from "./product-client";
import {
  replaceActionText,
  testTextActions,
  type ProductTestTextAction,
} from "./test-text-actions";

export type ProductTestHistoryItem = Pick<
  ActivityEvent,
  | "id"
  | "eventType"
  | "actorKind"
  | "summary"
  | "at"
  | "beforeRevision"
  | "afterRevision"
  | "touched"
>;

export type ProductTestRepair = Pick<
  Proposal,
  "id" | "title" | "description" | "status" | "createdAt" | "updatedAt" | "repair"
> & {
  editCount: number;
};

export type ProductTestEditorDocument = {
  appMapId: string;
  appName: string;
  revision: number;
  test: AppMapScenarioTest;
  /** Readable projection of captured controls; editable intent stays canonical. */
  displayTitles?: Readonly<Record<string, string>>;
  savedPaths?: readonly AppMapTestBindingCandidate[];
  browserTargetIds?: readonly string[];
  recordedPlatforms?: readonly PlanPlatform[];
  routePlatformBlockers?: Partial<Record<PlanPlatform, string>>;
  stepPlatformBlockers?: Readonly<Record<string, string>>;
  originEvidenceMissing?: string;
  hasRememberableReply?: boolean;
  textActions?: Readonly<Record<string, readonly ProductTestTextAction[]>>;
  latestTextRevision?: number;
  history: readonly ProductTestHistoryItem[];
  repairs: readonly ProductTestRepair[];
};

export type ProductDraftedStep = { kind: "instruction" | "validation"; intent: string };

/** Shown on steps that run from their words instead of a recording. */
export const PLAIN_ENGLISH_STEP_REASON =
  "Runs from its description. Record it to make it faster and exact.";

export type TestEditorProductService = {
  createDraft?(input: {
    appMapId: string;
    testId: string;
    name: string;
    /** Plain-English Actions, one per entry. */
    instructions?: readonly string[];
    /** Plain-English Actions and Checks; takes precedence over instructions. */
    steps?: readonly ProductDraftedStep[];
    /** Web address a plain-English Test opens first. */
    startUrl?: string;
  }): Promise<ProductTestEditorDocument>;
  /** Turn "what should work?" into plain-English Action and Check steps. */
  draftSteps?(input: {
    appMapId: string;
    goal: string;
    startUrl?: string;
  }): Promise<{ name: string; steps: ProductDraftedStep[]; source: "model" | "lines" }>;
  get(testId: string, appMapId?: string): Promise<ProductTestEditorDocument | undefined>;
  listTextParameters?(): Promise<import("@relay/protocol").TestData[]>;
  saveText?(input: {
    document: ProductTestEditorDocument;
    stepId: string;
    action: ProductTestTextAction;
    text: string;
  }): Promise<ProductTestEditorDocument>;
  saveSettings?(input: {
    document: ProductTestEditorDocument;
    name: string;
    originApplication?: string;
    /** Omit to keep the current address; "" removes it. */
    startUrl?: string;
  }): Promise<ProductTestEditorDocument>;
  edit(input: {
    document: ProductTestEditorDocument;
    edits: readonly AppMapScenarioTestEdit[];
  }): Promise<ProductTestEditorDocument>;
  undo?(input: { document: ProductTestEditorDocument }): Promise<ProductTestEditorDocument>;
  redo?(input: { document: ProductTestEditorDocument }): Promise<ProductTestEditorDocument>;
  decideRepair(input: {
    document: ProductTestEditorDocument;
    proposalId: string;
    decision: "approve" | "reject" | "revert";
  }): Promise<ProductTestEditorDocument>;
  /** Delete a Test from its App Map. Used to fold a helper recording into
   * the Test it was recorded for. */
  remove?(input: { appMapId: string; testId: string }): Promise<void>;
};

export function createTestEditorProductService(platform: Platform): TestEditorProductService {
  async function client() {
    return (await productClientForPlatform(platform)).client;
  }

  return {
    async listTextParameters() {
      return (await (await client()).invoke("workspace.variables.get", {})).value;
    },
    async saveText({ document, stepId, action, text }) {
      if (!text.trim() || text.length > 20_000)
        throw new TypeError("Enter text up to 20,000 characters.");
      const relay = await client();
      const { appMap: current } = await relay.invoke("app-map.get", {
        appMapId: document.appMapId,
      });
      if (current.revision !== document.revision)
        throw new TypeError("The saved test changed. Reload before saving this text.");
      const addressed = testTextActions(current, document.test.id)[stepId]?.find(
        (item) => item.key === action.key,
      );
      if (!addressed || addressed.text !== action.text)
        throw new TypeError("This text action changed. Reload the test.");
      const { appMap } = await relay.invoke("app-map.connection.update", {
        appMapId: document.appMapId,
        connectionId: addressed.connectionId,
        expectedRevision: document.revision,
        patch: {
          actions: replaceActionText(
            current.connections[addressed.connectionId]!.actions,
            addressed,
            text,
          ),
        },
      });
      return requireDocument(appMap, document.test.id);
    },
    async draftSteps({ appMapId, goal, startUrl }) {
      return (await client()).invoke("app-map.test.draft", {
        appMapId,
        goal,
        ...(startUrl ? { startUrl } : {}),
      });
    },
    async createDraft({ appMapId, testId, name, instructions = [], steps, startUrl }) {
      const relay = await client();
      const { appMap: current } = await relay.invoke("app-map.get", { appMapId });
      const { appMap } = await relay.invoke("app-map.test.save", {
        appMapId,
        testId,
        expectedRevision: current.revision,
        eventId: `create-${testId}`,
        test: {
          name: name.trim(),
          kind: "scenario",
          intentSchemaVersion: 1,
          ...(startUrl ? { startUrl } : {}),
          steps: (
            steps ?? instructions.map((intent) => ({ kind: "instruction" as const, intent }))
          ).map((step, index) => ({
            id: `${testId}-step-${index + 1}`,
            kind: step.kind,
            intent: step.intent.trim(),
            binding: { status: "unresolved", reason: PLAIN_ENGLISH_STEP_REASON, fromText: true },
          })),
        } as unknown as AppMapScenarioTest,
      });
      return requireDocument(appMap, testId);
    },
    async get(testId, appMapId) {
      const { appMaps } = await (await client()).invoke("app-map.list", {});
      const owners = appMaps.filter(
        (candidate) => (!appMapId || candidate.id === appMapId) && Boolean(candidate.tests[testId]),
      );
      if (owners.length > 1) {
        throw new TypeError("This test appears in more than one app and cannot be edited safely.");
      }
      return owners[0] ? documentFromMap(owners[0], testId) : undefined;
    },
    async edit({ document, edits }) {
      const { appMap } = await (
        await client()
      ).invoke("app-map.test.edit", {
        appMapId: document.appMapId,
        testId: document.test.id,
        expectedRevision: document.revision,
        edits: [...edits],
      });
      return requireDocument(appMap, document.test.id);
    },
    async saveSettings({ document, name, originApplication, startUrl }) {
      const nextStartUrl = startUrl === undefined ? document.test.startUrl : startUrl.trim();
      const {
        kind,
        intentSchemaVersion,
        steps,
        family,
        nativeRouteCompanions,
        capture,
        validation,
      } = document.test;
      const { appMap } = await (
        await client()
      ).invoke("app-map.test.save", {
        appMapId: document.appMapId,
        testId: document.test.id,
        expectedRevision: document.revision,
        // The public save schema accepts authored graph fields only; server-owned
        // AppMapEntity metadata stays on the current document and is rehydrated
        // from the response.
        test: {
          kind,
          intentSchemaVersion,
          steps,
          ...(family ? { family } : {}),
          ...(nativeRouteCompanions ? { nativeRouteCompanions } : {}),
          ...(capture ? { capture } : {}),
          ...(validation ? { validation } : {}),
          name: name.trim(),
          ...(originApplication?.trim() ? { originApplication: originApplication.trim() } : {}),
          ...(nextStartUrl ? { startUrl: nextStartUrl } : {}),
        } as unknown as AppMapScenarioTest,
      });
      return requireDocument(appMap, document.test.id);
    },
    async undo({ document }) {
      const { appMap } = await (
        await client()
      ).invoke("app-map.test.undo", {
        appMapId: document.appMapId,
        testId: document.test.id,
        expectedRevision: document.revision,
      });
      return requireDocument(appMap, document.test.id);
    },
    async redo({ document }) {
      const { appMap } = await (
        await client()
      ).invoke("app-map.test.redo", {
        appMapId: document.appMapId,
        testId: document.test.id,
        expectedRevision: document.revision,
      });
      return requireDocument(appMap, document.test.id);
    },
    async remove({ appMapId, testId }) {
      const relay = await client();
      const { appMap } = await relay.invoke("app-map.get", { appMapId });
      await relay.invoke("app-map.test.remove", {
        appMapId,
        testId,
        expectedRevision: appMap.revision,
      });
    },
    async decideRepair({ document, proposalId, decision }) {
      const operation = `app-map.proposal.${decision}` as const;
      const { appMap } = await (
        await client()
      ).invoke(operation, {
        appMapId: document.appMapId,
        proposalId,
        expectedRevision: document.revision,
      });
      return requireDocument(appMap, document.test.id);
    },
  };
}

function requireDocument(appMap: AppMap, testId: string): ProductTestEditorDocument {
  const document = documentFromMap(appMap, testId);
  if (!document) throw new TypeError("The edited test is no longer available.");
  return document;
}

export function documentFromMap(
  appMap: AppMap,
  testId: string,
): ProductTestEditorDocument | undefined {
  const test = appMap.tests[testId];
  if (!test || test.kind !== "scenario") return undefined;
  const history = Object.values(appMap.activity)
    .filter((event) => event.subject.kind === "test" && event.subject.id === testId)
    .sort((left, right) => right.at - left.at)
    .map((event) => ({
      id: event.id,
      eventType: event.eventType,
      actorKind: event.actorKind,
      summary: event.summary,
      at: event.at,
      beforeRevision: event.beforeRevision,
      afterRevision: event.afterRevision,
      ...(event.touched ? { touched: [...event.touched] } : {}),
    }));
  const repairs = Object.values(appMap.proposals)
    .filter((proposal) =>
      proposal.changes.some((change) => change.kind === "test.edit" && change.testId === testId),
    )
    .filter(
      (proposal) =>
        proposal.status === "pending" ||
        (proposal.status === "approved" && Boolean(proposal.repair && !proposal.repair.reverted)),
    )
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((proposal) => ({
      id: proposal.id,
      title: proposal.title,
      ...(proposal.description ? { description: proposal.description } : {}),
      status: proposal.status,
      createdAt: proposal.createdAt,
      updatedAt: proposal.updatedAt,
      ...(proposal.repair ? { repair: structuredClone(proposal.repair) } : {}),
      editCount: proposal.changes.reduce(
        (count, change) =>
          count +
          (change.kind === "test.edit" && change.testId === testId ? change.edits.length : 0),
        0,
      ),
    }));
  const recordedPlatforms = recordedPlanPlatformsFromAppMap(appMap, test);
  const stepPlatformBlockers = testStepPlatformBlockers(test, appMap, recordedPlatforms);
  const routePlatformBlockers = Object.fromEntries(
    PLAN_PLATFORMS.flatMap((platform) => {
      const reason = recordedRoutePlatformBlocker(test, appMap, platform);
      return reason ? [[platform, reason] as const] : [];
    }),
  ) as Partial<Record<PlanPlatform, string>>;
  const hasRememberableReply = testHasRememberableReply(test, appMap);
  const originEvidenceMissing = scenarioTestOriginMissingEvidence(appMap, test)?.title;
  const textActions = testTextActions(appMap, testId);
  const textConnectionIds = new Set(
    Object.values(textActions)
      .flat()
      .map((action) => action.connectionId),
  );
  const latestTextRevision = Math.max(
    0,
    ...Object.values(appMap.activity)
      .filter(
        (event) =>
          event.subject.kind === "connection" &&
          textConnectionIds.has(event.subject.id) &&
          event.eventType === "connection.updated",
      )
      .map((event) => event.afterRevision),
  );
  return {
    appMapId: appMap.id,
    appName: appMap.name,
    browserTargetIds: [
      ...new Set(
        Object.values(appMap.screenVariants)
          .filter((variant) => variant.targetProfile.platform === "browser")
          .map((variant) => variant.targetProfile.targetId),
      ),
    ],
    revision: appMap.revision,
    test: structuredClone(test),
    displayTitles: testInstructionDisplayTitles(appMap, test),
    textActions,
    ...(latestTextRevision ? { latestTextRevision } : {}),
    savedPaths: Object.values(appMap.connections ?? {})
      .filter((connection) => connection.state === "ready" && connection.actions.length > 0)
      .map((connection) => ({
        kind: "connection" as const,
        id: connection.id,
        label: `${connection.label || "Saved action"} · ${appMap.screens?.[connection.fromScreenId]?.title || "Unknown start"} → ${connection.destination.kind === "screen" ? appMap.screens?.[connection.destination.screenId]?.title || "Unknown destination" : "End of path"}`,
      }))
      .sort((left, right) => left.label.localeCompare(right.label)),
    recordedPlatforms,
    ...(Object.keys(routePlatformBlockers).length ? { routePlatformBlockers } : {}),
    ...(Object.keys(stepPlatformBlockers).length ? { stepPlatformBlockers } : {}),
    ...(originEvidenceMissing ? { originEvidenceMissing } : {}),
    ...(hasRememberableReply ? { hasRememberableReply: true } : {}),
    history,
    repairs,
  };
}
