import {
  authoringSessions,
  commitAppMapScreenCapture,
  connectAppMapScreens,
  currentOperationContext,
  findAppMapCaptureScreen,
  inferVariableOptionsFromTeach,
  now,
  readAppMap,
  reviewAppMapScreenCapture,
  submitAppMapProposal,
  stabilizeOptionIds,
  type AppMap,
} from "@relay/core";
import type { AuthoringSession, OperationInput, ScreenVariant } from "@relay/protocol";
import { assertTargetLease } from "./access-control.js";
import { createAuthoringRuntime } from "./authoring-routes.js";
import {
  currentTakeRevision,
  findEquivalentTeachConnection,
  iosTeachObservationMatchesTitle,
  profileForCapture,
  sourceAnchorForTeachInteraction,
  teachInteractionToAuthoringInteraction,
} from "./app-map-capture-support.js";
import * as teachHandoff from "./app-map-handoff-support.js";
import type { AppMapRouteInput } from "./app-map-route-input.js";
import {
  applyAppMapMutation as applyMutation,
  applyRebasableAppMapMutation as applyRebasableMutation,
} from "./app-map-route-mutations.js";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";

/**
 * Routes that borrow an Authoring Session to observe or teach a screen. The
 * top-level App Map router stays a dispatcher; this module owns the temporary
 * session lifecycle and only commits its reviewed capture after it is proven.
 */
export async function handleAppMapCaptureRoute(input: AppMapRouteInput): Promise<boolean> {
  const { method, pathname, request, response, scope } = input;

  const variableInfer = matchPath(pathname, "/app-maps/:appMapId/variables/:variableId/infer");
  if (method === "POST" && variableInfer) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"app-map.variable.infer">,
      "appMapId" | "variableId"
    >;
    await assertTargetLease(scope, body.target.targetId, body.leaseId);
    const appMap = await readAppMap(scope.projectId, variableInfer.appMapId!);
    if (!appMap) throw new HttpError(404, `App Map ${variableInfer.appMapId} not found`);
    if (appMap.revision !== body.expectedRevision) {
      throw new HttpError(
        409,
        `App Map revision conflict: expected ${body.expectedRevision}, current ${appMap.revision}`,
        {
          code: "revision-conflict",
          recovery: "Reload the App Map and teach the Variable again from the current revision.",
        },
      );
    }
    let session: AuthoringSession | undefined;
    try {
      session = await authoringSessions.create({
        appMapId: appMap.id,
        target: body.target,
        leaseId: body.leaseId,
        expectedAppMapRevision: appMap.revision,
      });
      session = await authoringSessions.capture(session.id, createAuthoringRuntime());
      const observation = currentTakeRevision(session)?.before;
      if (!observation) throw new HttpError(502, "The target returned no screen observation");
      const inferred = inferVariableOptionsFromTeach({
        nodes: observation.nodes as never,
        taughtRows: body.taughtRows,
      });
      const existing = appMap.variables[variableInfer.variableId!];
      const at = Math.max(now(), appMap.updatedAt);
      const variable = {
        id: variableInfer.variableId!,
        organizationId: appMap.organizationId,
        projectId: appMap.projectId,
        appMapId: appMap.id,
        createdAt: existing?.createdAt ?? at,
        updatedAt: at,
        name:
          body.name?.trim() ||
          existing?.name ||
          (body.kind === "language" ? "Language" : variableInfer.variableId!),
        kind: body.kind ?? existing?.kind ?? "custom",
        apply: body.apply ?? existing?.apply ?? { kind: "list" as const },
        options: stabilizeOptionIds(
          inferred.map((option) => ({
            id: option.id,
            ...(option.identifier ? { identifier: option.identifier } : {}),
            ...(option.label ? { label: option.label } : {}),
            ...(option.text ? { text: option.text } : {}),
          })),
        ),
        ...(existing?.restoreId ? { restoreId: existing.restoreId } : {}),
        ...(existing?.screenshotEach !== undefined
          ? { screenshotEach: existing.screenshotEach }
          : {}),
      };
      const mutation = {
        operationId: "app-map.variable.save" as const,
        input: {
          appMapId: appMap.id,
          variableId: variable.id,
          expectedRevision: appMap.revision,
          variable,
        },
      };
      json(response, 200, {
        appMapId: appMap.id,
        expectedRevision: appMap.revision,
        capturedAt: observation.capturedAt,
        variable,
        mutation,
      });
    } finally {
      if (session) {
        if (!["committed", "cancelled", "failed"].includes(session.state)) {
          await authoringSessions
            .cancel(session.id, createAuthoringRuntime())
            .catch(() => undefined);
        }
        await authoringSessions.cleanup(session.id).catch(() => undefined);
      }
    }
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
    const expectedRevision =
      current.revision !== body.expectedRevision ? current.revision : body.expectedRevision;

    let session: AuthoringSession | undefined;
    try {
      session = await authoringSessions.create({
        appMapId: current.id,
        target: body.target,
        leaseId: body.leaseId,
        expectedAppMapRevision: expectedRevision,
      });
      session = await authoringSessions.capture(session.id, createAuthoringRuntime());
      const take = currentTakeRevision(session);
      if (!take?.before) throw new HttpError(502, "The target returned no screen observation");
      const profile = await profileForCapture(
        body.target,
        take.before.capturedAt,
        take.before.bounds,
      );
      let capturedScreenId = "";
      let capturedVariantId = "";
      let created = false;
      let reviewProposalId: string | undefined;
      let proposedVariant: ScreenVariant | undefined;
      const capture = {
        target: body.target,
        targetProfile: profile,
        observation: take.before!,
        evidenceUrisById: Object.fromEntries(take.evidence.map((item) => [item.id, item.uri])),
        evidenceKindsById: Object.fromEntries(take.evidence.map((item) => [item.id, item.kind])),
        evidenceById: Object.fromEntries(take.evidence.map((item) => [item.id, item])),
        ...(body.title?.trim() ? { title: body.title.trim() } : {}),
        ...(body.position ? { position: body.position } : {}),
      };
      const operation = currentOperationContext();
      const initialReview = reviewAppMapScreenCapture(current, capture, {
        expectedRevision: current.revision,
        eventId: body.eventId?.trim() || operation?.requestId || "screen-capture-review",
        actorId: operation?.actorId || "system:screen-capture",
        actorKind: operation?.actorKind || "system",
        at: Math.max(now(), current.updatedAt),
      });
      if (initialReview) {
        const appMap = await applyRebasableMutation(
          scope,
          current.id,
          body.eventId,
          (map, context) => {
            const review = reviewAppMapScreenCapture(map, capture, context);
            if (!review) {
              throw new HttpError(409, "The screen changed again while preparing its review");
            }
            capturedScreenId = review.screenId;
            capturedVariantId = review.proposedVariant.id;
            proposedVariant = review.proposedVariant;
            reviewProposalId = review.proposal.id;
            return submitAppMapProposal(map, review.proposal, context);
          },
        );
        json(response, 200, {
          appMapId: appMap.id,
          appMapRevision: appMap.revision,
          screen: appMap.screens[capturedScreenId],
          variant: proposedVariant!,
          created,
          reviewProposalId: reviewProposalId!,
        });
        return true;
      }
      const persistCapture = (mapRevision: number) =>
        applyMutation(scope, current.id, mapRevision, body.eventId, (map, context) => {
          const result = commitAppMapScreenCapture(map, capture, context);
          capturedScreenId = result.screenId;
          capturedVariantId = result.variantId;
          created = result.created;
          return result.appMap;
        });
      let appMap: AppMap;
      try {
        appMap = await persistCapture(expectedRevision);
      } catch (error) {
        if (!(error instanceof HttpError) || error.status !== 409) throw error;
        const latest = await readAppMap(scope.projectId, current.id);
        if (!latest) throw error;
        appMap = await persistCapture(latest.revision);
      }
      json(response, 200, {
        appMapId: appMap.id,
        appMapRevision: appMap.revision,
        screen: appMap.screens[capturedScreenId],
        variant: proposedVariant ?? appMap.screenVariants[capturedVariantId],
        created,
        ...(reviewProposalId ? { reviewProposalId } : {}),
      });
    } finally {
      if (session) {
        // Screenshot-only capture borrows the Authoring Session observation boundary, but it is
        // not a path proposal. Finish its temporary review before cleanup to avoid phantom reviews.
        if (!["committed", "cancelled", "failed"].includes(session.state)) {
          await authoringSessions
            .cancel(session.id, createAuthoringRuntime())
            .catch(() => undefined);
        }
        await authoringSessions.cleanup(session.id).catch(() => undefined);
      }
    }
    return true;
  }

  const teach = matchPath(pathname, "/app-maps/:appMapId/teach");
  if (method === "POST" && teach) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"app-map.teach">,
      "appMapId"
    >;
    await assertTargetLease(scope, body.target.targetId, body.leaseId);
    const appMapId = teach.appMapId!;
    const existing = await readAppMap(scope.projectId, appMapId);
    if (!existing) throw new HttpError(404, `App Map ${appMapId} not found`);
    let current = existing;
    if (body.interaction && !body.fromScreenId?.trim()) {
      throw new HttpError(400, "fromScreenId is required when teaching a destination");
    }
    if (body.fromScreenId && !current.screens[body.fromScreenId]) {
      throw new HttpError(404, `Screen ${body.fromScreenId} not found`);
    }
    teachHandoff.assertValidTeachHandoff(body);
    let session: AuthoringSession | undefined;
    try {
      if (body.interaction) {
        // Do not let an explicit source id turn a tap on whatever happens to
        // be visible into a permanent map edge. `start` observes and verifies
        // the source before the interaction is executed.
        session = await authoringSessions.create({
          appMapId: current.id,
          target: body.target,
          leaseId: body.leaseId,
          expectedAppMapRevision: current.revision,
          sourceScreenId: body.fromScreenId,
        });
        const runtime = createAuthoringRuntime();
        session = await authoringSessions.observe(session.id, runtime);
        session = await authoringSessions.start(session.id, runtime);
        if (session.state === "failed") {
          throw new HttpError(409, session.error ?? "The device is not on the requested source", {
            code: "unexpected-source",
            recovery:
              "Return to the selected map screen, then teach the control again. Relay did not tap the device.",
          });
        }
        session = await authoringSessions.interact(
          session.id,
          teachInteractionToAuthoringInteraction(body.interaction, body.handoff?.expectedApp),
          runtime,
        );
        await runtime.settle?.(800);
        session = await authoringSessions.observe(session.id, runtime);
        session = await authoringSessions.stop(session.id, runtime);
      }
      {
        const latestMap = await readAppMap(scope.projectId, appMapId);
        if (latestMap) current = latestMap;
      }
      const expectedRevision = current.revision;
      const mapId = current.id;
      if (!session) {
        session = await authoringSessions.create({
          appMapId: mapId,
          target: body.target,
          leaseId: body.leaseId,
          expectedAppMapRevision: expectedRevision,
        });
        session = await authoringSessions.capture(session.id, createAuthoringRuntime());
      }
      const take = currentTakeRevision(session);
      const destinationObservation = body.interaction ? take?.after : take?.before;
      if (!take || !destinationObservation) {
        throw new HttpError(502, "The target returned no destination screen observation");
      }
      teachHandoff.assertTeachHandoffDestination(body, take, destinationObservation);
      const intendedTitle = body.title?.trim();
      if (
        body.target.kind === "device" &&
        body.target.platform === "ios" &&
        intendedTitle &&
        !iosTeachObservationMatchesTitle(destinationObservation.nodes, intendedTitle)
      ) {
        throw new HttpError(
          409,
          "The iPad opened a different screen than the requested destination",
          {
            code: "unexpected-destination",
            recovery:
              "The iOS accessibility tree still describes another surface. Return to the source, wait for the intended destination to settle, then teach it again. No map screen was saved.",
          },
        );
      }
      if (
        body.interaction &&
        findAppMapCaptureScreen(current, {
          target: body.target,
          observation: destinationObservation,
        })?.id === body.fromScreenId
      ) {
        throw new HttpError(409, "The interaction did not open another screen", {
          code: "interaction-no-change",
          recovery:
            "Choose a visible control or point that opens another screen. Use a recorded path for gestures or changes that stay on this screen.",
        });
      }
      const profile = await profileForCapture(
        body.target,
        destinationObservation.capturedAt,
        destinationObservation.bounds,
      );
      let capturedScreenId = "";
      let capturedVariantId = "";
      let created = false;
      let reviewProposalId: string | undefined;
      let proposedVariant: ScreenVariant | undefined;
      const capture = teachHandoff.buildTeachScreenCapture(
        body,
        profile,
        destinationObservation,
        take,
      );
      const operation = currentOperationContext();
      const initialReview = reviewAppMapScreenCapture(current, capture, {
        expectedRevision: current.revision,
        eventId: body.eventId?.trim() || operation?.requestId || "teach-capture-review",
        actorId: operation?.actorId || "system:teach-capture",
        actorKind: operation?.actorKind || "system",
        at: Math.max(now(), current.updatedAt),
      });
      if (initialReview) {
        const appMap = await applyRebasableMutation(scope, mapId, body.eventId, (map, context) => {
          const review = reviewAppMapScreenCapture(map, capture, context);
          if (!review) {
            throw new HttpError(409, "The destination changed again while preparing its review");
          }
          capturedScreenId = review.screenId;
          capturedVariantId = review.proposedVariant.id;
          proposedVariant = review.proposedVariant;
          reviewProposalId = review.proposal.id;
          return submitAppMapProposal(map, review.proposal, context);
        });
        json(response, 200, {
          appMapId: appMap.id,
          appMapRevision: appMap.revision,
          screen: appMap.screens[capturedScreenId],
          variant: proposedVariant!,
          created,
          reviewProposalId: reviewProposalId!,
        });
        return true;
      }
      const persistCapture = (mapRevision: number) =>
        applyMutation(scope, mapId, mapRevision, body.eventId, (map, context) => {
          const result = commitAppMapScreenCapture(map, capture, context, {
            // Teaching creates graph-native evidence and an edge. A runnable Flow
            // is an explicit authoring decision; do not resurrect the old
            // implicit “Main flow” after an operator removes all Flows.
            createInitialFlow: false,
          });
          capturedScreenId = result.screenId;
          capturedVariantId = result.variantId;
          created = result.created;
          return result.appMap;
        });
      let appMap: AppMap;
      try {
        appMap = await persistCapture(expectedRevision);
      } catch (error) {
        if (!(error instanceof HttpError) || error.status !== 409) throw error;
        const latest = await readAppMap(scope.projectId, mapId);
        if (!latest) throw error;
        appMap = await persistCapture(latest.revision);
      }

      let connectionId: string | undefined;
      if (
        !reviewProposalId &&
        body.fromScreenId &&
        body.interaction &&
        capturedScreenId !== body.fromScreenId
      ) {
        const sourceAnchor = sourceAnchorForTeachInteraction(
          current,
          body.fromScreenId,
          body.interaction,
          undefined,
          profile,
        );
        const label =
          body.label?.trim() ||
          body.title?.trim() ||
          appMap.screens[capturedScreenId]?.title ||
          "Open";
        const slug = label
          .toLocaleLowerCase()
          .replace(/[^a-z0-9]+/gu, "-")
          .replace(/^-+|-+$/gu, "")
          .slice(0, 40);
        connectionId = slug ? `open-${slug}` : `open-${Date.now().toString(36)}`;
        if (appMap.connections[connectionId]) {
          connectionId = `${connectionId}-${appMap.revision}`;
        }
        const action =
          body.interaction.kind === "swipe"
            ? {
                id: `swipe-${connectionId}`,
                kind: "gesture" as const,
                label,
                gesture: {
                  kind: "swipe" as const,
                  from: body.interaction.from,
                  to: body.interaction.to,
                  ...(body.interaction.durationMs !== undefined
                    ? { durationMs: body.interaction.durationMs }
                    : {}),
                },
              }
            : {
                id: `tap-${connectionId}`,
                kind: "tap" as const,
                target:
                  body.interaction.kind === "point"
                    ? { point: { x: body.interaction.x, y: body.interaction.y }, label }
                    : body.interaction.kind === "label"
                      ? {
                          label: body.interaction.label,
                          ...(body.interaction.point ? { point: body.interaction.point } : {}),
                        }
                      : {
                          identifier: body.interaction.identifier,
                          ...(body.interaction.point ? { point: body.interaction.point } : {}),
                        },
                ...(body.handoff ? { expectedApp: body.handoff.expectedApp } : {}),
              };
        const equivalentConnectionId = findEquivalentTeachConnection(appMap, {
          fromScreenId: body.fromScreenId,
          destinationScreenId: capturedScreenId,
          action,
        });
        if (equivalentConnectionId) {
          connectionId = equivalentConnectionId;
        } else {
          const persistConnection = (mapRevision: number) =>
            applyMutation(
              scope,
              mapId,
              mapRevision,
              `${body.eventId?.trim() || currentOperationContext()?.requestId || "teach"}-connect`,
              (map, context) =>
                connectAppMapScreens(
                  map,
                  {
                    id: connectionId!,
                    organizationId: map.organizationId,
                    projectId: map.projectId,
                    appMapId: map.id,
                    fromScreenId: body.fromScreenId!,
                    destination: { kind: "screen", screenId: capturedScreenId },
                    label,
                    state: "ready",
                    actions: [action],
                    ...(sourceAnchor ? { sourceAnchor } : {}),
                    createdAt: context.at,
                    updatedAt: context.at,
                  },
                  context,
                ),
            );
          try {
            appMap = await persistConnection(appMap.revision);
          } catch (error) {
            if (!(error instanceof HttpError) || error.status !== 409) throw error;
            const latest = await readAppMap(scope.projectId, mapId);
            if (!latest) throw error;
            appMap = await persistConnection(latest.revision);
          }
        }
      }

      json(response, 200, {
        appMapId: appMap.id,
        appMapRevision: appMap.revision,
        screen: appMap.screens[capturedScreenId],
        variant: proposedVariant ?? appMap.screenVariants[capturedVariantId],
        created,
        ...(reviewProposalId ? { reviewProposalId } : {}),
        ...(connectionId ? { connectionId } : {}),
      });
    } finally {
      if (session) await authoringSessions.cleanup(session.id).catch(() => undefined);
    }
    return true;
  }

  return false;
}
