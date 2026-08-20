import {
  addAppMapScreen,
  attachAppMapCaseStack,
  connectAppMapScreens,
  commitAppMapChanges,
  createAppMap,
  currentOperationContext,
  deleteAppMap,
  duplicateAppMap,
  formatAppMapYaml,
  importAppMap,
  listAppMapCatalog,
  proposalFromDiscovery,
  readAppMap,
  readDiscoverySession,
  appMapYamlFilename,
  parseAppMapYaml,
  removeAppMapConnection,
  removeAppMapCaseStack,
  removeAppMapVariable,
  removeAppMapFlow,
  removeAppMapGroup,
  removeAppMapRoutine,
  saveAppMapFlow,
  saveAppMapGroup,
  saveAppMapCaseStack,
  saveAppMapVariable,
  saveAppMapRoutine,
  submitAppMapProposal,
  updateAppMap,
  updateAppMapConnection,
  updateAppMapScreen,
  type AppMap,
} from "@relay/core";
import type { OperationInput } from "@relay/protocol";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";
import type { AppMapRouteInput } from "./app-map-route-input.js";
import {
  applyAppMapMutation as applyMutation,
  applyRebasableAppMapMutation as applyRebasableMutation,
} from "./app-map-route-mutations.js";
import {
  handleScreenConsolidationRoute,
  handleScreenRemovalRoute,
} from "./app-map-screen-consolidation-route.js";
import { handleAppMapTestRoute } from "./app-map-test-routes.js";
import { handleAppMapProposalRoute } from "./app-map-proposal-routes.js";
import { handleAppMapScrollSurfaceRoute } from "./app-map-scroll-surface-route.js";
import { handleAppMapReviewedOriginRoute } from "./app-map-reviewed-origin-route.js";
import { handleAppMapCaptureRoute } from "./app-map-capture-routes.js";

export {
  findEquivalentTeachConnection,
  iosTeachObservationMatchesTitle,
  sourceAnchorForTeachInteraction,
  teachInteractionToAuthoringInteraction,
} from "./app-map-capture-support.js";

export async function handleAppMapRoute(input: AppMapRouteInput): Promise<boolean> {
  const { method, pathname, request, response, scope } = input;

  if (await handleAppMapReviewedOriginRoute(input)) return true;
  if (await handleAppMapScrollSurfaceRoute(input)) return true;

  if (method === "GET" && pathname === "/app-maps") {
    json(response, 200, await listAppMapCatalog(scope.projectId));
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
      (map, context) =>
        addAppMapScreen(
          map,
          {
            screen: {
              ...body.screen,
              organizationId: map.organizationId,
              projectId: map.projectId,
              appMapId: map.id,
              variantIds: [],
              createdAt: context.at,
              updatedAt: context.at,
            },
          },
          context,
        ),
    );
    json(response, 200, { appMap });
    return true;
  }

  if (await handleAppMapCaptureRoute(input)) return true;

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

  if (await handleScreenRemovalRoute(input)) return true;
  if (await handleScreenConsolidationRoute(input)) return true;

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
      (map, context) =>
        connectAppMapScreens(
          map,
          {
            ...body.connection,
            organizationId: map.organizationId,
            projectId: map.projectId,
            appMapId: map.id,
            state: body.connection.state ?? "ready",
            actions: body.connection.actions ?? [],
            createdAt: context.at,
            updatedAt: context.at,
          },
          context,
        ),
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
    const appMap = await applyMutation(
      scope,
      flowSave.appMapId!,
      body.expectedRevision,
      body.eventId,
      (map, context) => {
        const existing = map.flows[flowSave.flowId!];
        return saveAppMapFlow(
          map,
          {
            ...body.flow,
            organizationId: map.organizationId,
            projectId: map.projectId,
            appMapId: map.id,
            id: flowSave.flowId!,
            createdAt: existing?.createdAt ?? context.at,
            updatedAt: context.at,
          },
          context,
        );
      },
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

  const variableSave = matchPath(pathname, "/app-maps/:appMapId/variables/:variableId");
  if (method === "PUT" && variableSave) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"app-map.variable.save">,
      "appMapId" | "variableId"
    >;
    const appMap = await applyMutation(
      scope,
      variableSave.appMapId!,
      body.expectedRevision,
      body.eventId,
      (map, context) => {
        const id = variableSave.variableId!;
        return saveAppMapVariable(
          map,
          {
            ...body.variable,
            id,
            organizationId: map.organizationId,
            projectId: map.projectId,
            appMapId: map.id,
            createdAt: map.variables[id]?.createdAt ?? context.at,
            updatedAt: context.at,
          },
          context,
        );
      },
    );
    json(response, 200, { appMap });
    return true;
  }

  const variableRemove = matchPath(pathname, "/app-maps/:appMapId/variables/:variableId/remove");
  if (method === "POST" && variableRemove) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"app-map.variable.remove">,
      "appMapId" | "variableId"
    >;
    const appMap = await applyMutation(
      scope,
      variableRemove.appMapId!,
      body.expectedRevision,
      body.eventId,
      (map, context) => removeAppMapVariable(map, variableRemove.variableId!, context),
    );
    json(response, 200, { appMap });
    return true;
  }

  if (await handleAppMapTestRoute(input)) return true;
  if (await handleAppMapProposalRoute(input)) return true;

  const routineSave = matchPath(pathname, "/app-maps/:appMapId/routines/:routineId");
  if (method === "PUT" && routineSave) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"app-map.routine.save">,
      "appMapId" | "routineId"
    >;
    const appMap = await applyMutation(
      scope,
      routineSave.appMapId!,
      body.expectedRevision,
      body.eventId,
      (map, context) => {
        const existing = map.routines[routineSave.routineId!];
        return saveAppMapRoutine(
          map,
          {
            ...body.routine,
            organizationId: map.organizationId,
            projectId: map.projectId,
            appMapId: map.id,
            id: routineSave.routineId!,
            parameters: body.routine.parameters ?? [],
            createdAt: existing?.createdAt ?? context.at,
            updatedAt: context.at,
          },
          context,
        );
      },
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
    const session = await readDiscoverySession(
      body.sessionId,
      scope.localTrusted ? undefined : { projectId: scope.projectId },
    );
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

  return false;
}
