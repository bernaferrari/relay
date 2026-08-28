import type http from "node:http";
import {
  getActiveJob,
  groundAndInteract,
  groundTarget,
  GroundingError,
  connectionProofOutcomeUnknownDiagnostic,
  IosMutationOutcomeUnknownError,
  iosVisualVerificationDiagnostic,
  interact,
  previewInteract,
  scrollSurveyOutcomeUnknownDiagnostic,
  type InteractInput,
  type InteractResult,
  type ScrollSurveyOutcomeUnknownDiagnostic,
} from "@relay/core";
import { assertTargetControl, assertTargetObservation } from "./access-control.js";
import { HttpError, json, parseJsonBody } from "./http.js";
import type { RequestContext } from "./security.js";

type InteractionRouteInput = {
  method: string;
  pathname: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
};

type GroundingRequestBody = {
  serial?: string;
  target?: unknown;
  kind?: string;
  screenshot?: { base64?: string; mime?: string };
};

/**
 * Both routes accept either `{target}` or a flattened InteractInput, so callers
 * can post `{kind:"label",label:"Back"}` without nesting.
 */
function resolveTarget(body: GroundingRequestBody): string | InteractInput {
  if (body.target !== undefined && body.target !== null && body.target !== "") {
    return body.target as string | InteractInput;
  }
  if (body.kind) {
    const { serial: _serial, screenshot: _screenshot, ...interaction } = body;
    return interaction as unknown as InteractInput;
  }
  throw new HttpError(400, "body.target is required (string or InteractInput)");
}

function requireSerial(body: GroundingRequestBody): string {
  if (!body.serial) throw new HttpError(400, "serial is required");
  return body.serial;
}

function assertNoRunningJob(serial?: string): void {
  if (getActiveJob(serial)?.status === "running") {
    throw new HttpError(409, "A job is running — pause or cancel it before interacting manually");
  }
}

/**
 * The transport-safe portion of an ambiguous iOS mutation. Keep this shared
 * between interaction surfaces: an endpoint may choose a different HTTP
 * status, but it must never lose the fact that exactly one native command was
 * attempted or the evidence attached to it.
 */
export type IosMutationOutcomeUnknownPayload = Readonly<Record<string, unknown>> & {
  code: "IOS_MUTATION_OUTCOME_UNKNOWN";
  iosMutation: IosMutationOutcomeUnknownError["iosMutation"];
  iosSessionLifecycle?: unknown;
  iosVisualVerification?: unknown;
  /** Raw pre-ambiguity full-surface frames, when the failed command was a survey scroll. */
  scrollSurvey?: ScrollSurveyOutcomeUnknownDiagnostic;
  /** Existing App Map source/destination proof, when the error came from Keep replay. */
  connectionProof?: unknown;
  targetInputReview?: unknown;
};

function currentTargetInputReview(error: IosMutationOutcomeUnknownError): unknown {
  const supervised = error.supervisedMutation;
  if (!supervised) return undefined;
  const { serial, mutationId } = supervised;
  return {
    mutationId,
    observe: { operationId: "target.observation.capture", input: { serial } },
    decide: {
      operationId: "target.input.reconcile",
      input: { serial, mutationId, outcome: "applied | not-applied | ambiguous" },
      requiresConfirmation: true,
    },
  };
}

/**
 * Preserve the exact command diagnostic for both error and in-band result
 * transports. Route-specific fields are deliberately added first so the
 * canonical stop facts below cannot be overwritten by a caller.
 */
export function iosMutationOutcomeUnknownPayload(
  error: IosMutationOutcomeUnknownError,
  details?: Readonly<Record<string, unknown>>,
): IosMutationOutcomeUnknownPayload {
  const lifecycle = (
    error as IosMutationOutcomeUnknownError & {
      iosSessionLifecycle?: unknown;
    }
  ).iosSessionLifecycle;
  const visualVerification = iosVisualVerificationDiagnostic(error);
  const scrollSurvey = scrollSurveyOutcomeUnknownDiagnostic(error);
  const connectionProof = connectionProofOutcomeUnknownDiagnostic(error);
  const targetInputReview = currentTargetInputReview(error);
  return {
    ...details,
    code: "IOS_MUTATION_OUTCOME_UNKNOWN",
    iosMutation: error.iosMutation,
    ...(lifecycle ? { iosSessionLifecycle: lifecycle } : {}),
    ...(visualVerification ? { iosVisualVerification: visualVerification } : {}),
    ...(scrollSurvey ? { scrollSurvey } : {}),
    ...(connectionProof ? { connectionProof } : {}),
    ...(targetInputReview ? { targetInputReview } : {}),
  };
}

/** Preserve the exact device-command fact for both people and MCP callers.
 * A retry is an explicit follow-up after fresh pixels, never an HTTP retry. */
export function iosMutationOutcomeUnknownHttpError(
  error: IosMutationOutcomeUnknownError,
  /** Route-specific, reviewed context (for example a Discovery review
   * pointer). Canonical mutation facts below always win over this extension. */
  details?: Readonly<Record<string, unknown>>,
): HttpError {
  return new HttpError(409, error.message, iosMutationOutcomeUnknownPayload(error, details));
}

export async function handleInteractionRoute(input: InteractionRouteInput): Promise<boolean> {
  const { method, pathname, request, response, scope } = input;

  if (method === "POST" && pathname === "/ground") {
    const body = (await parseJsonBody(request)) as GroundingRequestBody;
    const serial = requireSerial(body);
    const target = resolveTarget(body);
    assertTargetObservation(scope, serial);
    try {
      const result = await groundTarget({
        serial,
        target,
        ...(body.screenshot?.base64
          ? { screenshot: { base64: body.screenshot.base64, mime: body.screenshot.mime } }
          : {}),
      });
      json(response, 200, { ok: true, ...result });
    } catch (error) {
      if (error instanceof GroundingError) {
        json(response, 404, error.toJSON());
        return true;
      }
      throw error;
    }
    return true;
  }

  if (method === "POST" && pathname === "/do") {
    const body = (await parseJsonBody(request)) as GroundingRequestBody;
    const serial = requireSerial(body);
    const target = resolveTarget(body);
    assertNoRunningJob(serial);
    await assertTargetControl(scope, serial);
    try {
      const result = await groundAndInteract({ serial, target });
      json(response, 200, {
        ok: true,
        ...result.grounding,
        ...(result.interact.resolution ? { resolution: result.interact.resolution } : {}),
        ...(result.interact.iosSessionLifecycle
          ? { iosSessionLifecycle: result.interact.iosSessionLifecycle }
          : {}),
        ...(result.interact.iosMutation ? { iosMutation: result.interact.iosMutation } : {}),
      });
    } catch (error) {
      if (error instanceof GroundingError) {
        json(response, 404, error.toJSON());
        return true;
      }
      if (error instanceof IosMutationOutcomeUnknownError) {
        throw iosMutationOutcomeUnknownHttpError(error);
      }
      throw error;
    }
    return true;
  }

  if (method === "POST" && pathname === "/interact") {
    const body = (await parseJsonBody(request)) as InteractInput & { serial?: string };
    if (!body || typeof body !== "object" || !("kind" in body)) {
      throw new HttpError(
        400,
        "body.kind required (identifier|label|point|ref|find|text-match|swipe|key|type|replace)",
      );
    }
    const { serial, preview, ...rest } = body as InteractInput & {
      serial?: string;
      preview?: unknown;
    };
    const interaction = rest as InteractInput;
    if (preview === true) {
      assertTargetObservation(scope, serial);
      const result = await previewInteract(interaction, { serial });
      json(response, 200, {
        ok: true,
        preview: true,
        mime: "image/png",
        base64: result.base64,
        bytes: result.bytes,
        width: result.width,
        height: result.height,
        inspectable: result.inspectable,
        ...(result.resolution ? { resolution: result.resolution } : {}),
      });
      return true;
    }
    assertNoRunningJob(serial);
    await assertTargetControl(scope, serial);
    let result: InteractResult;
    try {
      result = await interact(interaction, { serial });
    } catch (error) {
      if (error instanceof IosMutationOutcomeUnknownError) {
        throw iosMutationOutcomeUnknownHttpError(error);
      }
      throw error;
    }
    json(response, 200, {
      ok: true,
      ...(result.resolution ? { resolution: result.resolution } : {}),
      ...(result.iosSessionLifecycle ? { iosSessionLifecycle: result.iosSessionLifecycle } : {}),
      ...(result.iosMutation ? { iosMutation: result.iosMutation } : {}),
    });
    return true;
  }

  return false;
}
