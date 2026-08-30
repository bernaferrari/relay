export type ProofDraft = {
  pullRequest: string;
  summary: string;
  acceptanceCriteria: string;
};

export type ProofDraftField = keyof ProofDraft;
export type ProofDraftErrors = Partial<Record<ProofDraftField, string>>;

export const emptyProofDraft: ProofDraft = {
  pullRequest: "",
  summary: "",
  acceptanceCriteria: "",
};

export function normalizedProofDraft(draft: ProofDraft): ProofDraft {
  return {
    pullRequest: draft.pullRequest.trim(),
    summary: draft.summary.trim(),
    acceptanceCriteria: draft.acceptanceCriteria.trim(),
  };
}

export function validateProofDraft(draftInput: ProofDraft): ProofDraftErrors {
  const draft = normalizedProofDraft(draftInput);
  const errors: ProofDraftErrors = {};
  if (draft.pullRequest) {
    const value = Number(draft.pullRequest);
    if (!Number.isSafeInteger(value) || value <= 0) {
      errors.pullRequest = "Pull request must be a positive whole number.";
    }
  }
  if (draft.acceptanceCriteria && !draft.summary) {
    errors.summary = "Summarize the change before adding acceptance criteria.";
  }
  const criteria = draft.acceptanceCriteria
    .split("\n")
    .map((criterion) => criterion.trim())
    .filter(Boolean);
  if (criteria.length > 64) {
    errors.acceptanceCriteria = "Keep the claim to 64 acceptance criteria or fewer.";
  } else if (criteria.some((criterion) => criterion.length > 4096)) {
    errors.acceptanceCriteria = "Each acceptance criterion must be 4,096 characters or fewer.";
  }
  return errors;
}
