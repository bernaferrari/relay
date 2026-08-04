import type http from "node:http";
import {
  AppMapDomainError,
  addAppMapScreen,
  authoringSessions,
  approveAppMapProposal,
  attachAppMapCaseStack,
  connectAppMapScreens,
  commitAppMapChanges,
  commitAppMapScreenCapture,
  createAppMap,
  currentOperationContext,
  deleteAppMap,
  duplicateAppMap,
  formatAppMapYaml,
  importAppMap,
  listAppMaps,
  listDevices,
  mutateStoredAppMap,
  now,
  proposalFromDiscovery,
  readAppMap,
  readDiscoverySession,
  appMapYamlFilename,
  parseAppMapYaml,
  rejectAppMapProposal,
  removeAppMapConnection,
  removeAppMapCaseStack,
  removeAppMapFlow,
  removeAppMapGroup,
  removeAppMapRoutine,
  removeAppMapScreen,
  saveAppMapFlow,
  saveAppMapGroup,
  saveAppMapCaseStack,
  saveAppMapRoutine,
  submitAppMapProposal,
  updateAppMap,
  updateAppMapConnection,
  updateAppMapScreen,
  type AppMap,
  type AppMapMutationContext,
} from "@relay/core";
import type { AuthoringSession, OperationInput, TargetProfile } from "@relay/protocol";
import { assertTargetLease } from "./access-control.js";
import { createAuthoringRuntime } from "./authoring-routes.js";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";
import type { RequestContext } from "./security.js";

type AppMapRouteInput = {
  method: string;
  pathname: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
};

function domainStatus(error: AppMapDomainError): number {
  if (error.code === "missing-reference") return 404;
  if (
    error.code === "revision-conflict" ||
    error.code === "in-use" ||
    error.code === "proposal-state" ||
    error.code === "duplicate-id"
  ) {
    return 409;
  }
  return 400;
}

async function applyMutation(
  scope: RequestContext,
  appMapId: string,
  expectedRevision: number,
  eventId: string | undefined,
  transform: (map: AppMap, context: AppMapMutationContext) => AppMap,
): Promise<AppMap> {
  const operation = currentOperationContext();
  if (!operation) throw new HttpError(500, "App Map operation context is unavailable");
  const stableEventId = eventId?.trim() || operation.requestId;
  const current = await readAppMap(scope.projectId, appMapId);
  if (!current) throw new HttpError(404, `App Map ${appMapId} not found`);
  if (current.activity[stableEventId]) return current;
  try {
    return await mutateStoredAppMap(scope.projectId, appMapId, (map) =>
      transform(map, {
        expectedRevision,
        eventId: stableEventId,
        actorId: operation.actorId,
        actorKind: operation.actorKind,
        at: Math.max(now(), map.updatedAt),
      }),
    );
  } catch (error) {
    if (error instanceof AppMapDomainError) {
      const body = {
        code: error.code,
        error: error.message,
        recovery:
          error.code === "revision-conflict"
            ? "Reload the App Map and retry against its current revision."
            : "Inspect the referenced App Map entities and retry.",
        current,
      };
      throw new HttpError(domainStatus(error), error.message, body);
    }
    throw error;
  }
}

/** Proposal work is optimistic and can safely move across unrelated revisions.
 * The domain layer performs the entity-level conflict check; this wrapper only
 * ensures the final write itself is atomic against the latest stored map. */
async function applyRebasableMutation(
  scope: RequestContext,
  appMapId: string,
  eventId: string | undefined,
  transform: (map: AppMap, context: AppMapMutationContext) => AppMap,
): Promise<AppMap> {
  const operation = currentOperationContext();
  if (!operation) throw new HttpError(500, "App Map operation context is unavailable");
  const stableEventId = eventId?.trim() || operation.requestId;
  const current = await readAppMap(scope.projectId, appMapId);
  if (!current) throw new HttpError(404, `App Map ${appMapId} not found`);
  if (current.activity[stableEventId]) return current;
  try {
    return await mutateStoredAppMap(scope.projectId, appMapId, (map) =>
      transform(map, {
        expectedRevision: map.revision,
        eventId: stableEventId,
        actorId: operation.actorId,
        actorKind: operation.actorKind,
        at: Math.max(now(), map.updatedAt),
      }),
    );
  } catch (error) {
    if (error instanceof AppMapDomainError) {
      throw new HttpError(domainStatus(error), error.message, {
        code: error.code,
        recovery:
          error.code === "revision-conflict"
            ? "Review the conflicting screen or connection, then update the proposal."
            : "Inspect the referenced App Map entities and retry.",
        current: await readAppMap(scope.projectId, appMapId),
      });
    }
    throw error;
  }
}

function currentTakeRevision(session: AuthoringSession) {
  const take = session.take;
  return take?.revisions.find((revision) => revision.revision === take.currentRevision);
}

async function profileForCapture(
  target: OperationInput<"app-map.screen.capture">["target"],
  observedAt: number,
): Promise<TargetProfile> {
  if (target.kind === "device") {
    const device = (await listDevices()).find((item) => item.serial === target.targetId);
    return {
      id: `device:${target.targetId}`,
      targetId: target.targetId,
      source: "device",
      platform: target.platform,
      name: device?.name?.trim() || target.targetId,
      ...(device?.kind ? { model: device.kind } : {}),
      ...(device?.osVersion ? { osVersion: device.osVersion } : {}),
      capabilities: ["snapshot", "screenshot"],
      observedAt,
    };
  }
  return {
    id: `browser:${target.targetId}`,
    targetId: target.targetId,
    source: "browser",
    platform: "browser",
    name: target.targetId,
    capabilities: ["snapshot", "screenshot"],
    observedAt,
  };
}

export async function handleAppMapRoute(input: AppMapRouteInput): Promise<boolean> {
  const { method, pathname, request, response, scope } = input;

  if (method === "GET" && pathname === "/app-maps") {
    json(response, 200, { appMaps: await listAppMaps(scope.projectId) });
    return true;
  }
  if (method === "POST" && pathname === "/app-maps/import") {
    const body = (await parseJsonBody(request)) as OperationInput<"app-map.import">;
    let parsed: AppMap;
    try {
      parsed = parseAppMapYaml(body.yaml, {
        organizationId: scope.organizationId,
        projectId: scope.projectId,
      });
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error), {
        code: "invalid-map",
        recovery: "Fix the reported YAML field and retry the import.",
      });
    }
    if (body.dryRun) {
      json(response, 200, { appMap: parsed, imported: false });
      return true;
    }
    try {
      const appMap = await importAppMap({
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        appMap: parsed,
        conflict: body.conflict,
      });
      json(response, 201, { appMap, imported: true });
    } catch (error) {
      throw new HttpError(409, error instanceof Error ? error.message : String(error), {
        code: "duplicate-id",
        recovery: "Use conflict=replace or conflict=copy, then retry.",
      });
    }
    return true;
  }
  if (method === "POST" && pathname === "/app-maps") {
    const body = (await parseJsonBody(request)) as OperationInput<"app-map.create">;
    try {
      const appMap = await createAppMap({
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        appMapId: body.appMapId,
        name: body.name,
      });
      json(response, 201, { appMap });
    } catch (error) {
      throw new HttpError(409, error instanceof Error ? error.message : String(error));
    }
    return true;
  }

  const mapDuplicate = matchPath(pathname, "/app-maps/:sourceAppMapId/duplicate");
  if (method === "POST" && mapDuplicate) {
    const body = (await parseJsonBody(request)) as OperationInput<"app-map.duplicate">;
    try {
      const appMap = await duplicateAppMap({
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        sourceAppMapId: mapDuplicate.sourceAppMapId!,
        appMapId: body.appMapId,
        ...(body.name ? { name: body.name } : {}),
      });
      json(response, 201, { appMap });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HttpError(message.endsWith("not found") ? 404 : 409, message);
    }
    return true;
  }

  const mapRemove = matchPath(pathname, "/app-maps/:appMapId/remove");
  if (method === "POST" && mapRemove) {
    const removed = await deleteAppMap(scope.projectId, mapRemove.appMapId!);
    if (!removed) throw new HttpError(404, `App Map ${mapRemove.appMapId} not found`);
    json(response, 200, { ok: true });
    return true;
  }

  const mapExport = matchPath(pathname, "/app-maps/:appMapId/export");
  if (method === "GET" && mapExport) {
    const appMap = await readAppMap(scope.projectId, mapExport.appMapId!);
    if (!appMap) throw new HttpError(404, `App Map ${mapExport.appMapId} not found`);
    json(response, 200, {
      appMap,
      yaml: formatAppMapYaml(appMap),
      filename: appMapYamlFilename(appMap.id),
    });
    return true;
  }

  const mapCommit = matchPath(pathname, "/app-maps/:appMapId/commit");
  if (method === "POST" && mapCommit) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"app-map.commit">,
      "appMapId"
    >;
    const appMap = await applyMutation(
      scope,
      mapCommit.appMapId!,
      body.expectedRevision,
      body.eventId,
      (map, context) => commitAppMapChanges(map, body.changes, body.patch, context, body.summary),
    );
    json(response, 200, { appMap });
    return true;
  }

  const mapMatch = matchPath(pathname, "/app-maps/:appMapId");
  if (method === "GET" && mapMatch) {
    const appMap = await readAppMap(scope.projectId, mapMatch.appMapId!);
    if (!appMap) throw new HttpError(404, `App Map ${mapMatch.appMapId} not found`);
    json(response, 200, { appMap });
    return true;
  }
  if (method === "PUT" && mapMatch) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"app-map.update">,
      "appMapId"
    >;
    const appMap = await applyMutation(
      scope,
      mapMatch.appMapId!,
      body.expectedRevision,
      body.eventId,
      (map, context) => updateAppMap(map, body.patch, context),
    );
    json(response, 200, { appMap });
    return true;
  }

  const screenAdd = matchPath(pathname, "/app-maps/:appMapId/screens");
  if (method === "POST" && screenAdd) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"app-map.screen.add">,
      "appMapId"
    >;
    const appMap = await applyMutation(
      scope,
      screenAdd.appMapId!,
      body.expectedRevision,
      body.eventId,
      (map, context) => addAppMapScreen(map, body.input, context),
    );
    json(response, 200, { appMap });
    return true;
  }

  const screenCapture = matchPath(pathname, "/app-maps/:appMapId/screens/capture");
  if (method === "POST" && screenCapture) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"app-map.screen.capture">,
      "appMapId"
    >;
    await assertTargetLease(scope, body.target.targetId, body.leaseId);
    const current = await readAppMap(scope.projectId, screenCapture.appMapId!);
    if (!current) throw new HttpError(404, `App Map ${screenCapture.appMapId} not found`);
    if (current.revision !== body.expectedRevision) {
      throw new HttpError(409, "App Map changed before the screen could be captured", {
        code: "revision-conflict",
        recovery: "Reload the App Map and retry against its current revision.",
        current,
      });
    }

    let session: AuthoringSession | undefined;
    try {
      session = await authoringSessions.create({
        appMapId: current.id,
        target: body.target,
        leaseId: body.leaseId,
        expectedAppMapRevision: body.expectedRevision,
      });
      session = await authoringSessions.capture(session.id, createAuthoringRuntime());
      const revision = currentTakeRevision(session);
      if (!revision?.before) throw new HttpError(502, "The target returned no screen observation");
      const profile = await profileForCapture(body.target, revision.before.capturedAt);
      let capturedScreenId = "";
      let capturedVariantId = "";
      let created = false;
      const appMap = await applyMutation(
        scope,
        current.id,
        body.expectedRevision,
        body.eventId,
        (map, context) => {
          const result = commitAppMapScreenCapture(
            map,
            {
              target: body.target,
              targetProfile: profile,
              observation: revision.before!,
              evidenceUrisById: Object.fromEntries(
                revision.evidence.map((item) => [item.id, item.uri]),
              ),
              evidenceKindsById: Object.fromEntries(
                revision.evidence.map((item) => [item.id, item.kind]),
              ),
              ...(body.title?.trim() ? { title: body.title.trim() } : {}),
              ...(body.position ? { position: body.position } : {}),
            },
            context,
          );
          capturedScreenId = result.screenId;
          capturedVariantId = result.variantId;
          created = result.created;
          return result.appMap;
        },
      );
      json(response, 200, {
        appMapId: appMap.id,
        appMapRevision: appMap.revision,
        screen: appMap.screens[capturedScreenId],
        variant: appMap.screenVariants[capturedVariantId],
        created,
      });
    } finally {
      if (session) await authoringSessions.cleanup(session.id).catch(() => undefined);
    }
    return true;
  }

  const screenUpdate = matchPath(pathname, "/app-maps/:appMapId/screens/:screenId");
  if (method === "PUT" && screenUpdate) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"app-map.screen.update">,
      "appMapId" | "screenId"
    >;
    const appMap = await applyMutation(
      scope,
      screenUpdate.appMapId!,
      body.expectedRevision,
      body.eventId,
      (map, context) => updateAppMapScreen(map, screenUpdate.screenId!, body.input, context),
    );
    json(response, 200, { appMap });
    return true;
  }

  const screenRemove = matchPath(pathname, "/app-maps/:appMapId/screens/:screenId/remove");
  if (method === "POST" && screenRemove) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"app-map.screen.remove">,
      "appMapId" | "screenId"
    >;
    const appMap = await applyMutation(
      scope,
      screenRemove.appMapId!,
      body.expectedRevision,
      body.eventId,
      (map, context) => removeAppMapScreen(map, screenRemove.screenId!, context),
    );
    json(response, 200, { appMap });
    return true;
  }

  const connectionCreate = matchPath(pathname, "/app-maps/:appMapId/connections");
  if (method === "POST" && connectionCreate) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"app-map.connection.create">,
      "appMapId"
    >;
    const appMap = await applyMutation(
      scope,
      connectionCreate.appMapId!,
      body.expectedRevision,
      body.eventId,
      (map, context) => connectAppMapScreens(map, body.connection, context),
    );
    json(response, 200, { appMap });
    return true;
  }

  const connectionUpdate = matchPath(pathname, "/app-maps/:appMapId/connections/:connectionId");
  if (method === "PUT" && connectionUpdate) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"app-map.connection.update">,
      "appMapId" | "connectionId"
    >;
    const appMap = await applyMutation(
      scope,
      connectionUpdate.appMapId!,
      body.expectedRevision,
      body.eventId,
      (map, context) =>
        updateAppMapConnection(map, connectionUpdate.connectionId!, body.patch, context),
    );
    json(response, 200, { appMap });
    return true;
  }

  const connectionRemove = matchPath(
    pathname,
    "/app-maps/:appMapId/connections/:connectionId/remove",
  );
  if (method === "POST" && connectionRemove) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"app-map.connection.remove">,
      "appMapId" | "connectionId"
    >;
    const appMap = await applyMutation(
      scope,
      connectionRemove.appMapId!,
      body.expectedRevision,
      body.eventId,
      (map, context) => removeAppMapConnection(map, connectionRemove.connectionId!, context),
    );
    json(response, 200, { appMap });
    return true;
  }

  const groupSave = matchPath(pathname, "/app-maps/:appMapId/groups/:groupId");
  if (method === "PUT" && groupSave) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"app-map.group.save">,
      "appMapId" | "groupId"
    >;
    if (body.group.id !== groupSave.groupId) {
      throw new HttpError(400, "Group id must match the route");
    }
    const appMap = await applyMutation(
      scope,
      groupSave.appMapId!,
      body.expectedRevision,
      body.eventId,
      (map, context) => saveAppMapGroup(map, body.group, context),
    );
    json(response, 200, { appMap });
    return true;
  }

  const groupRemove = matchPath(pathname, "/app-maps/:appMapId/groups/:groupId/remove");
  if (method === "POST" && groupRemove) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"app-map.group.remove">,
      "appMapId" | "groupId"
    >;
    const appMap = await applyMutation(
      scope,
      groupRemove.appMapId!,
      body.expectedRevision,
      body.eventId,
      (map, context) => removeAppMapGroup(map, groupRemove.groupId!, context),
    );
    json(response, 200, { appMap });
    return true;
  }

  const flowSave = matchPath(pathname, "/app-maps/:appMapId/flows/:flowId");
  if (method === "PUT" && flowSave) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"app-map.flow.save">,
      "appMapId" | "flowId"
    >;
    if (body.flow.id !== flowSave.flowId) throw new HttpError(400, "Flow id must match the route");
    const appMap = await applyMutation(
      scope,
      flowSave.appMapId!,
      body.expectedRevision,
      body.eventId,
      (map, context) => saveAppMapFlow(map, body.flow, context),
    );
    json(response, 200, { appMap });
    return true;
  }

  const flowRemove = matchPath(pathname, "/app-maps/:appMapId/flows/:flowId/remove");
  if (method === "POST" && flowRemove) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"app-map.flow.remove">,
      "appMapId" | "flowId"
    >;
    const appMap = await applyMutation(
      scope,
      flowRemove.appMapId!,
      body.expectedRevision,
      body.eventId,
      (map, context) => removeAppMapFlow(map, flowRemove.flowId!, context),
    );
    json(response, 200, { appMap });
    return true;
  }

  const caseStackSave = matchPath(pathname, "/app-maps/:appMapId/case-stacks/:caseStackId");
  if (method === "PUT" && caseStackSave) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"app-map.case-stack.save">,
      "appMapId" | "caseStackId"
    >;
    if (body.caseStack.id !== caseStackSave.caseStackId) {
      throw new HttpError(400, "Case stack id must match the route");
    }
    const appMap = await applyMutation(
      scope,
      caseStackSave.appMapId!,
      body.expectedRevision,
      body.eventId,
      (map, context) => saveAppMapCaseStack(map, body.caseStack, context),
    );
    json(response, 200, { appMap });
    return true;
  }

  const caseStackAttach = matchPath(
    pathname,
    "/app-maps/:appMapId/connections/:connectionId/case-stack",
  );
  if (method === "POST" && caseStackAttach) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"app-map.case-stack.attach">,
      "appMapId" | "connectionId"
    >;
    if (body.caseStack && body.caseStack.id !== body.caseStackId) {
      throw new HttpError(400, "Case stack id must match the supplied stack");
    }
    const appMap = await applyMutation(
      scope,
      caseStackAttach.appMapId!,
      body.expectedRevision,
      body.eventId,
      (map, context) =>
        attachAppMapCaseStack(
          map,
          caseStackAttach.connectionId!,
          body.caseStackId,
          body.caseStack,
          context,
        ),
    );
    json(response, 200, { appMap });
    return true;
  }

  const caseStackRemove = matchPath(
    pathname,
    "/app-maps/:appMapId/case-stacks/:caseStackId/remove",
  );
  if (method === "POST" && caseStackRemove) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"app-map.case-stack.remove">,
      "appMapId" | "caseStackId"
    >;
    const appMap = await applyMutation(
      scope,
      caseStackRemove.appMapId!,
      body.expectedRevision,
      body.eventId,
      (map, context) => removeAppMapCaseStack(map, caseStackRemove.caseStackId!, context),
    );
    json(response, 200, { appMap });
    return true;
  }

  const routineSave = matchPath(pathname, "/app-maps/:appMapId/routines/:routineId");
  if (method === "PUT" && routineSave) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"app-map.routine.save">,
      "appMapId" | "routineId"
    >;
    if (body.routine.id !== routineSave.routineId)
      throw new HttpError(400, "Routine id must match the route");
    const appMap = await applyMutation(
      scope,
      routineSave.appMapId!,
      body.expectedRevision,
      body.eventId,
      (map, context) => saveAppMapRoutine(map, body.routine, context),
    );
    json(response, 200, { appMap });
    return true;
  }

  const routineRemove = matchPath(pathname, "/app-maps/:appMapId/routines/:routineId/remove");
  if (method === "POST" && routineRemove) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"app-map.routine.remove">,
      "appMapId" | "routineId"
    >;
    const appMap = await applyMutation(
      scope,
      routineRemove.appMapId!,
      body.expectedRevision,
      body.eventId,
      (map, context) => removeAppMapRoutine(map, routineRemove.routineId!, context),
    );
    json(response, 200, { appMap });
    return true;
  }

  const proposalSubmit = matchPath(pathname, "/app-maps/:appMapId/proposals");
  if (method === "POST" && proposalSubmit) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"app-map.proposal.submit">,
      "appMapId"
    >;
    const appMap = await applyRebasableMutation(
      scope,
      proposalSubmit.appMapId!,
      body.eventId,
      (map, context) => submitAppMapProposal(map, body.proposal, context),
    );
    json(response, 200, { appMap });
    return true;
  }

  const observationProposal = matchPath(pathname, "/app-maps/:appMapId/observation-proposals");
  if (method === "POST" && observationProposal) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"app-map.observations.propose">,
      "appMapId"
    >;
    const session = await readDiscoverySession(body.sessionId);
    if (!session) throw new HttpError(404, `Observation session ${body.sessionId} not found`);
    const operation = currentOperationContext();
    if (!operation) throw new HttpError(500, "App Map operation context is unavailable");
    const proposalId = body.proposalId?.trim() || `proposal:${operation.requestId}`;
    const appMap = await applyRebasableMutation(
      scope,
      observationProposal.appMapId!,
      body.eventId,
      (map, context) => {
        const proposal = proposalFromDiscovery({
          map,
          session,
          proposalId,
          ...(body.title ? { title: body.title } : {}),
          ...(body.transitionIds ? { transitionIds: body.transitionIds } : {}),
          at: context.at,
        });
        return submitAppMapProposal(
          map,
          {
            ...proposal,
            baseRevision: Math.min(body.expectedRevision, map.revision),
          },
          context,
        );
      },
    );
    json(response, 200, { appMap, proposalId });
    return true;
  }

  for (const decision of ["approve", "reject"] as const) {
    const proposalDecision = matchPath(
      pathname,
      `/app-maps/:appMapId/proposals/:proposalId/${decision}`,
    );
    if (method !== "POST" || !proposalDecision) continue;
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<`app-map.proposal.${typeof decision}`>,
      "appMapId" | "proposalId"
    >;
    const appMap = await applyRebasableMutation(
      scope,
      proposalDecision.appMapId!,
      body.eventId,
      (map, context) =>
        decision === "approve"
          ? approveAppMapProposal(map, proposalDecision.proposalId!, context, body.reason)
          : rejectAppMapProposal(map, proposalDecision.proposalId!, context, body.reason),
    );
    json(response, 200, { appMap });
    return true;
  }

  return false;
}
