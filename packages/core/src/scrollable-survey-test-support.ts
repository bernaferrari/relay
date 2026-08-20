/** Test-only fixture authority. Production code must obtain this capability
 * through recipe-runner's evidence loader, never through a type assertion. */
import { mintValidatedFrozenDocumentOrigin } from "./frozen-document-origin-capability.js";
import type {
  ScrollSurveyCapture,
  ValidatedFrozenDocumentOrigin,
} from "./scrollable-survey-types.js";

export function validatedFrozenOriginForTest(
  capture: ScrollSurveyCapture,
): ValidatedFrozenDocumentOrigin {
  return mintValidatedFrozenDocumentOrigin(capture);
}
