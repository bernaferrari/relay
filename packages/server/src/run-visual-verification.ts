import { VisualVerificationError } from "@relay/core";
import { HttpError } from "./http.js";

function visualVerificationHttpError(error: VisualVerificationError): HttpError {
  const status =
    error.code === "VISUAL_COMPARISON_NOT_FOUND"
      ? 404
      : error.code === "VISUAL_REVIEW_AGENT_FORBIDDEN"
        ? 403
        : 409;
  return new HttpError(status, error.message, {
    code: error.code,
    recovery: error.recovery,
  });
}

/** Keep visual storage failures in the route's stable HTTP error contract. */
export async function guardVisualVerification(handler: () => Promise<void>): Promise<true> {
  try {
    await handler();
  } catch (error) {
    if (error instanceof VisualVerificationError) throw visualVerificationHttpError(error);
    throw error;
  }
  return true;
}
