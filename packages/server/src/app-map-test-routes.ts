import type http from "node:http";
import {
  AppMapDomainError,
  AppMapTestStepOperationError,
  activeReviewedDocumentOriginsForAppMap,
  AppMapTestCompileError,
  loadFrozenRawAccessibilityEvidence,
  compileAppMapTest,
  frozenRawAccessibilityTargetProfiles,
  compileIntentWalk,
  currentOperationContext,
  editAppMapScenarioTest,
  listDevices,
  preflightCompiledAppMapTestOffline,
  preflightAppMapCombine,
  proposalConflictsSince,
  readAppMap,
  removeAppMapCombine,
  removeAppMapTest,
  saveAppMapCombine,
  saveAppMapTest,
  submitAppMapProposal,
} from "@relay/core";
import type { OperationInput } from "@relay/protocol";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";
import type { RequestContext } from "./security.js";
import { applyAppMapMutation, applyRebasableAppMapMutation } from "./app-map-route-mutations.js";

type AppMapTestRouteInput = {
  method: string;
  pathname: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
};

export async function handleAppMapTestRoute(input: AppMapTestRouteInput): Promise<boolean> {
  const { method, pathname, request, response, scope } = input;
  const fromIntent = matchPath(pathname, "/app-maps/:appMapId/tests/from-intent");
  if (method === "POST" && fromIntent) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"app-map.test.from-intent">,
      "appMapId"
    >;
    const appMap = await readAppMap(scope.projectId, fromIntent.appMapId!);
    if (!appMap) throw new HttpError(404, `App Map ${fromIntent.appMapId} not found`);
    const walk = compileIntentWalk(appMap, String(body.intent ?? ""));
    json(response, 200, walk);
    return true;
  }
  const testSave = matchPath(pathname, "/app-maps/:appMapId/tests/:testId");
  if (method === "PUT" && testSave) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"app-map.test.save">,
      "appMapId" | "testId"
    >;
    const appMap = await applyAppMapMutation(
      scope,
      testSave.appMapId!,
      body.expectedRevision,
      body.eventId,
      (map, context) => {
        const id = testSave.testId!;
        return saveAppMapTest(
          map,
          {
            ...body.test,
            id,
            organizationId: map.organizationId,
            projectId: map.projectId,
            appMapId: map.id,
            createdAt: map.tests[id]?.createdAt ?? context.at,
            updatedAt: context.at,
          },
          context,
        );
      },
    );
    json(response, 200, { appMap });
    return true;
  }
  const testCompile = matchPath(pathname, "/app-maps/:appMapId/tests/:testId/compile");
  if (method === "GET" && testCompile) {
    const appMap = await readAppMap(scope.projectId, testCompile.appMapId!);
    if (!appMap) throw new HttpError(404, `App Map ${testCompile.appMapId} not found`);
    const test = appMap.tests[testCompile.testId!];
    if (!test) throw new HttpError(404, `Test ${testCompile.testId} not found`);
    try {
      const search = new URL(request.url ?? pathname, "http://relay.local").searchParams;
      const entryCheckpointScreenId = search.get("entryCheckpointScreenId");
      const targetProfileId = search.get("targetProfileId")?.trim() || undefined;
      const runtimeTargetProfiles = targetProfileId
        ? frozenRawAccessibilityTargetProfiles(appMap).filter(
            (profile) => profile.id === targetProfileId,
          )
        : [];
      const runtimeTargetProfile = runtimeTargetProfiles[0];
      if (targetProfileId && runtimeTargetProfiles.length === 0) {
        throw new HttpError(409, `Target profile ${targetProfileId} is not saved in this App Map`, {
          code: "TARGET_PROFILE_NOT_SAVED",
        });
      }
      if (runtimeTargetProfiles.length > 1) {
        throw new HttpError(409, `Target profile ${targetProfileId} has conflicting identities`, {
          code: "TARGET_PROFILE_AMBIGUOUS",
        });
      }
      const forceRecaptureScreenIds = search.getAll("forceRecaptureScreenIds");
      const reviewedDocumentOrigins = await activeReviewedDocumentOriginsForAppMap(appMap);
      const plan = compileAppMapTest(appMap, test, {
        ...(entryCheckpointScreenId ? { entryCheckpointScreenId } : {}),
        ...(forceRecaptureScreenIds.length
          ? { forceRecaptureSurfaceScreenIds: forceRecaptureScreenIds }
          : {}),
        reviewedDocumentOrigins,
        ...(runtimeTargetProfile ? { runtimeTargetProfile } : {}),
      }).plan;
      const evidence = await loadFrozenRawAccessibilityEvidence(plan);
      json(response, 200, {
        plan,
        preflight: preflightCompiledAppMapTestOffline(
          plan,
          evidence,
          targetProfileId ? { targetProfileId } : {},
        ),
      });
    } catch (error) {
      if (error instanceof AppMapTestCompileError) {
        throw new HttpError(409, error.message, {
          code: error.code,
          testId: error.testId,
          stepId: error.stepId,
          diagnostics: error.diagnostics,
          recovery:
            error.code === "unresolved-navigation"
              ? "Teach or author every missing reviewed return transition, then compile the Test again."
              : "Open the Test editor and resolve its blocking compile diagnostics.",
        });
      }
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    return true;
  }
  const testRemove = matchPath(pathname, "/app-maps/:appMapId/tests/:testId/remove");
  if (method === "POST" && testRemove) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"app-map.test.remove">,
      "appMapId" | "testId"
    >;
    const appMap = await applyAppMapMutation(
      scope,
      testRemove.appMapId!,
      body.expectedRevision,
      body.eventId,
      (map, context) => removeAppMapTest(map, testRemove.testId!, context),
    );
    json(response, 200, { appMap });
    return true;
  }
  const testEdit = matchPath(pathname, "/app-maps/:appMapId/tests/:testId/edit");
  if (method === "POST" && testEdit) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"app-map.test.edit">,
      "appMapId" | "testId"
    >;
    const appMap = await applyRebasableAppMapMutation(
      scope,
      testEdit.appMapId!,
      body.eventId,
      (map, context) => {
        const id = testEdit.testId!;
        const test = map.tests[id];
        if (!test) throw new AppMapDomainError("missing-reference", `Test ${id} does not exist`);
        try {
          if (body.expectedRevision > map.revision) {
            throw new AppMapDomainError(
              "revision-conflict",
              `Expected App Map revision ${body.expectedRevision}, current revision is ${map.revision}`,
            );
          }
          const conflicts = proposalConflictsSince(
            map,
            { changes: [{ kind: "test.edit", testId: id, edits: body.edits }] },
            body.expectedRevision,
          );
          if (conflicts.conflict) {
            throw new AppMapDomainError(
              "revision-conflict",
              `Test edits conflict with newer changes to ${conflicts.subjects.join(", ")}`,
            );
          }
          return editAppMapScenarioTest(map, id, body.edits, context);
        } catch (error) {
          if (error instanceof AppMapTestStepOperationError) {
            throw new AppMapDomainError("invalid-map", error.message);
          }
          throw error;
        }
      },
    );
    json(response, 200, { appMap });
    return true;
  }
  const testProposal = matchPath(pathname, "/app-maps/:appMapId/tests/:testId/proposals");
  if (method === "POST" && testProposal) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"app-map.test.propose">,
      "appMapId" | "testId"
    >;
    const operation = currentOperationContext();
    if (!operation) throw new HttpError(500, "App Map operation context is unavailable");
    const proposalId = body.proposalId?.trim() || `proposal:${operation.requestId}`;
    const appMap = await applyRebasableAppMapMutation(
      scope,
      testProposal.appMapId!,
      body.eventId,
      (map, context) => {
        const testId = testProposal.testId!;
        const test = map.tests[testId];
        if (!test) {
          throw new AppMapDomainError("missing-reference", `Test ${testId} does not exist`);
        }
        return submitAppMapProposal(
          map,
          {
            id: proposalId,
            organizationId: map.organizationId,
            projectId: map.projectId,
            appMapId: map.id,
            title: body.title?.trim() || `Edit ${test.name}`,
            ...(body.description?.trim() ? { description: body.description.trim() } : {}),
            status: "pending",
            baseRevision: body.expectedRevision,
            changes: [{ kind: "test.edit", testId, edits: body.edits }],
            createdAt: context.at,
            updatedAt: context.at,
          },
          context,
        );
      },
    );
    json(response, 200, { appMap, proposalId });
    return true;
  }
  const comboSave = matchPath(pathname, "/app-maps/:appMapId/combines/:combineId");
  if (method === "PUT" && comboSave) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"app-map.combine.save">,
      "appMapId" | "combineId"
    >;
    const appMap = await applyAppMapMutation(
      scope,
      comboSave.appMapId!,
      body.expectedRevision,
      body.eventId,
      (map, context) => {
        const id = comboSave.combineId!;
        return saveAppMapCombine(
          map,
          {
            ...body.combine,
            id,
            organizationId: map.organizationId,
            projectId: map.projectId,
            appMapId: map.id,
            createdAt: map.combines[id]?.createdAt ?? context.at,
            updatedAt: context.at,
          },
          context,
        );
      },
    );
    json(response, 200, { appMap });
    return true;
  }
  const comboPreflight = matchPath(pathname, "/app-maps/:appMapId/combines/:combineId/preflight");
  if (method === "POST" && comboPreflight) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"app-map.combine.preflight">,
      "appMapId" | "combineId"
    >;
    const appMap = await readAppMap(scope.projectId, comboPreflight.appMapId!);
    if (!appMap) throw new HttpError(404, `App Map ${comboPreflight.appMapId} not found`);
    const combine = appMap.combines[comboPreflight.combineId!];
    if (!combine) throw new HttpError(404, `Combine  not found`);
    const reviewedDocumentOrigins = await activeReviewedDocumentOriginsForAppMap(appMap);
    const serial = body.serial?.trim();
    const devices = serial ? await listDevices().catch(() => []) : [];
    const device = serial ? devices.find((candidate) => candidate.serial === serial) : undefined;
    const preflight = await preflightAppMapCombine(
      appMap,
      combine,
      {
        ...(body.selected ? { selected: body.selected } : {}),
        ...(body.strategy ? { strategy: body.strategy } : {}),
        ...(serial && device?.platform
          ? { target: { targetId: serial, platform: device.platform } }
          : {}),
      },
      { reviewedDocumentOrigins },
    );
    if (serial) {
      const state = !device
        ? "missing"
        : device.connectionState === "offline" ||
            device.connectionState === "unauthorized" ||
            device.booted === false ||
            device.developerMode === "disabled" ||
            device.developerServicesAvailable === false
          ? "not-ready"
          : "connected";
      preflight.target = { serial, state };
      if (state !== "connected") {
        preflight.blockers.push({
          code: state === "missing" ? "target-missing" : "target-not-ready",
          message:
            state === "missing"
              ? "The selected device is not connected."
              : "The selected device must be unlocked and ready for control.",
        });
        preflight.ok = false;
      }
    }
    json(response, 200, { preflight });
    return true;
  }
  const comboRemove = matchPath(pathname, "/app-maps/:appMapId/combines/:combineId/remove");
  if (method === "POST" && comboRemove) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"app-map.combine.remove">,
      "appMapId" | "combineId"
    >;
    const appMap = await applyAppMapMutation(
      scope,
      comboRemove.appMapId!,
      body.expectedRevision,
      body.eventId,
      (map, context) => removeAppMapCombine(map, comboRemove.combineId!, context),
    );
    json(response, 200, { appMap });
    return true;
  }
  return false;
}
