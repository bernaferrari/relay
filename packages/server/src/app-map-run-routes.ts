import type http from "node:http";
import {
  AppMapCompileError,
  RunMatrixError,
  compileAppMapFlow,
  currentOperationContext,
  enqueueJob,
  prepareCaseStackMatrix,
  readAppMap,
  readProjectVariables,
  referencedRuntimeInputs,
  redactRunMatrix,
  sensitiveInputNames,
  type Recipe,
} from "@relay/core";
import type { OperationInput } from "@relay/protocol";
import { assertTargetControl } from "./access-control.js";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";
import type { RequestContext } from "./security.js";

export type AppMapRunRouteContext = {
  method: string;
  pathname: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
};

export async function handleAppMapRunRoute(input: AppMapRunRouteContext): Promise<boolean> {
  const match = matchPath(input.pathname, "/app-maps/:appMapId/flows/:flowId/run");
  if (input.method !== "POST" || !match) return false;

  const body = (await parseJsonBody(input.request)) as Omit<
    OperationInput<"app-map.flow.run">,
    "appMapId" | "flowId"
  >;
  const targetId = body.browserTargetId?.trim() || body.serial?.trim();
  if (!targetId) throw new HttpError(400, "Choose a target before running this flow");
  await assertTargetControl(input.scope, targetId);

  const map = await readAppMap(input.scope.projectId, match.appMapId!);
  if (!map) throw new HttpError(404, `App Map ${match.appMapId} not found`);

  let plan;
  try {
    plan = compileAppMapFlow(map, match.flowId!);
  } catch (error) {
    if (error instanceof AppMapCompileError) {
      throw new HttpError(error.code === "missing-flow" ? 404 : 409, error.message, {
        code: error.code,
        recovery:
          error.code === "draft-connection"
            ? "Finish or remove the draft connection, then run the flow again."
            : "Capture and approve the destination screen, then run the flow again.",
      });
    }
    throw error;
  }

  const recipeGraph: Record<string, Recipe> = Object.fromEntries(
    Object.values(plan.recipes).map((compiled) => [
      compiled.id,
      {
        id: compiled.id,
        title: compiled.title,
        ...(compiled.description ? { description: compiled.description } : {}),
        ...(compiled.parameters.length ? { parameters: compiled.parameters } : {}),
        source: "custom" as const,
        steps: compiled.steps,
        createdAt: map.createdAt,
        updatedAt: map.updatedAt,
      },
    ]),
  );
  const recipeSnapshot = recipeGraph[plan.rootRecipeId]!;
  const operation = currentOperationContext();
  if (!operation) throw new HttpError(500, "App Map execution context is unavailable");
  const definitions = await readProjectVariables(input.scope.projectId);
  let matrix;
  try {
    matrix = plan.caseStacks.length
      ? await prepareCaseStackMatrix({
          variables: definitions.value,
          caseStacks: plan.caseStacks,
          runtimeValues: body.variables,
        })
      : undefined;
  } catch (error) {
    if (error instanceof RunMatrixError) {
      throw new HttpError(409, error.message, {
        code: error.code,
        recovery:
          error.code === "missing-private-value"
            ? "Set your private value locally or pass it in this run request."
            : error.code === "generation-failed"
              ? "Check the generation provider or add a fallback value to this variable."
              : "Open the Case Stack and adjust its variables or coverage strategy.",
      });
    }
    throw error;
  }
  const constantVariables = referencedRuntimeInputs(recipeGraph, definitions.value, body.variables);
  const cases = matrix?.cases ?? [
    { id: "default", name: "Default", index: 0, values: {}, provenance: [] },
  ];
  const safeMatrix = matrix ? redactRunMatrix(matrix, definitions.value) : undefined;
  const jobs = cases.map((item) => {
    const variables = { ...constantVariables, ...item.values };
    return enqueueJob({
      recipe: recipeSnapshot.id,
      title: cases.length > 1 ? `${recipeSnapshot.title} · ${item.name}` : recipeSnapshot.title,
      recipeSnapshot,
      recipeGraph,
      serial: body.serial,
      platform: body.platform,
      targetKind: body.targetKind,
      browserTargetId: body.browserTargetId,
      variables,
      sensitiveInputNames: sensitiveInputNames(definitions.value, variables),
      ...(matrix
        ? { batchId: matrix.id, caseIndex: item.index, caseCount: matrix.cases.length }
        : {}),
      artifacts: [
        { kind: "app-map-flow-plan", capturedAt: Date.now(), data: plan },
        ...(safeMatrix
          ? [
              {
                kind: "frozen-inputs",
                capturedAt: safeMatrix.createdAt,
                data: safeMatrix.cases[item.index],
              },
            ]
          : []),
      ],
      projectId: input.scope.projectId,
      ownerId: operation.actorId,
    });
  });
  json(input.response, 202, {
    job: jobs[0]!,
    jobs,
    plan,
    ...(safeMatrix ? { matrix: safeMatrix } : {}),
  });
  return true;
}
