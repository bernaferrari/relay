/**
 * Compatibility surface for callers that historically imported the generic
 * approval-policy module. Merge authority lives in change-decision-policy.ts;
 * this module intentionally contains only aliases.
 */
export {
  approvalPolicyFindingReviewIsValid,
  approvalPolicyDecisionFromChangeDecision,
  approvalPolicyDecisionForChange,
  evaluateChangeDecisionPolicy,
  evaluateChangeVerificationPolicy,
} from "./change-decision-policy.js";

import { approvalPolicyDecisionForChange } from "./change-decision-policy.js";
import type { ApprovalPolicyInput } from "@relay/protocol";

/** Historical approval-policy output, projected from the canonical decision. */
export function evaluateApprovalPolicy(input: ApprovalPolicyInput) {
  return approvalPolicyDecisionForChange(input);
}
