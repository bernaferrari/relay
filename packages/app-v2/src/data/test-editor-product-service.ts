import type {
  ActivityEvent,
  AppMap,
  AppMapScenarioTest,
  AppMapScenarioTestEdit,
  Proposal,
} from "@relay/protocol";
import {
  recordedPlanPlatformsFromAppMap,
  testStepPlatformBlockers,
  type PlanPlatform,
} from "@relay/product/test-route-platforms";
import type { Platform } from "../platform/types";
import { productClientForPlatform } from "./product-client";

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
  recordedPlatforms?: readonly PlanPlatform[];
  stepPlatformBlockers?: Readonly<Record<string, string>>;
  history: readonly ProductTestHistoryItem[];
  repairs: readonly ProductTestRepair[];
};

export type TestEditorProductService = {
  get(testId: string): Promise<ProductTestEditorDocument | undefined>;
  saveSettings?(input: {
    document: ProductTestEditorDocument;
    name: string;
    originApplication?: string;
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
};

export function createTestEditorProductService(platform: Platform): TestEditorProductService {
  async function client() {
    return (await productClientForPlatform(platform)).client;
  }

  return {
    async get(testId) {
      const { appMaps } = await (await client()).invoke("app-map.list", {});
      const owners = appMaps.filter((candidate) => Boolean(candidate.tests[testId]));
      if (owners.length > 1) {
        throw new TypeError("This Test appears in more than one app and cannot be edited safely.");
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
    async saveSettings({ document, name, originApplication }) {
      const { kind, intentSchemaVersion, steps, family, capture, validation } = document.test;
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
          ...(capture ? { capture } : {}),
          ...(validation ? { validation } : {}),
          name: name.trim(),
          ...(originApplication?.trim() ? { originApplication: originApplication.trim() } : {}),
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
  if (!document) throw new TypeError("The edited Test is no longer available.");
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
  return {
    appMapId: appMap.id,
    appName: appMap.name,
    revision: appMap.revision,
    test: structuredClone(test),
    recordedPlatforms,
    ...(Object.keys(stepPlatformBlockers).length ? { stepPlatformBlockers } : {}),
    history,
    repairs,
  };
}
