import type { RecipeStep, StepTarget } from "@relay/protocol";
import { PRIVATE_INPUT } from "../input/private-inputs.js";
import {
  isSignInSecretReference,
  SIGN_IN_PASSWORD_REFERENCE,
  SIGN_IN_USERNAME_REFERENCE,
  type ActiveSignInSecrets,
} from "../sign-in/secret-references.js";
import { resolveSavedSignIn } from "../sign-in/sign-in-resolution.js";
import { normalizeSavedSignInKey } from "../sign-in/saved-sign-ins.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import type { ActCandidate, ActDecision } from "./recipe-runner-act.js";

export function scrubSignInText(value: string, active: ActiveSignInSecrets): string {
  let result = value;
  for (const secret of [active.username, active.password].sort(
    (left, right) => right.length - left.length,
  )) {
    if (secret) result = result.replaceAll(secret, PRIVATE_INPUT);
  }
  return result;
}

function scrubTarget(target: StepTarget, active: ActiveSignInSecrets): StepTarget {
  const next = structuredClone(target);
  for (const field of ["identifier", "ref", "label", "text"] as const) {
    const value = next[field];
    if (typeof value === "string" && value !== scrubSignInText(value, active)) delete next[field];
  }
  return next;
}

/** Tree candidates may expose a field's current value. During sign-in those
 * values can be credentials, so display text is scrubbed and a secret-bearing
 * semantic key is removed before the candidate can reach a prompt or artifact. */
export function scrubSignInCandidates(
  candidates: readonly ActCandidate[],
  active: ActiveSignInSecrets,
): ActCandidate[] {
  return candidates.map((candidate) => {
    const target = scrubTarget(candidate.target, active);
    return {
      ...candidate,
      ...(candidate.label ? { label: scrubSignInText(candidate.label, active) } : {}),
      ...(candidate.identifier
        ? { identifier: scrubSignInText(candidate.identifier, active) }
        : {}),
      target,
    };
  });
}

export function signInCachedStepsAreExecutable(steps: readonly RecipeStep[]): boolean {
  return steps.every((step) => step.kind !== "type" || isSignInSecretReference(step.text));
}

export function signInPromptLines(accountKey: string): string[] {
  return [
    `This step is a saved sign-in for account "${accountKey}".`,
    `Never invent, guess, reuse, or transform credentials. Type exactly ${SIGN_IN_USERNAME_REFERENCE} into the username/email field and exactly ${SIGN_IN_PASSWORD_REFERENCE} into the password field.`,
    "Those strings are opaque secret references, not literal text. Every type action must name its editable candidateId.",
    "Do not describe credential values in reasons or summaries.",
  ];
}

function candidateText(candidate: ActCandidate): string {
  return `${candidate.identifier ?? ""} ${candidate.label ?? ""} ${candidate.role ?? ""}`.toLowerCase();
}

/** A sign-in act may type only the two opaque references. plaintext-looking
 * model output is rejected before any device input and is never echoed. */
export function assertSignInActDecision(
  decision: ActDecision,
  candidates: readonly ActCandidate[],
): void {
  if (decision.action !== "type") return;
  if (!isSignInSecretReference(decision.text) || !decision.candidateId) {
    throw new Error(
      "Saved sign-in model did not use the required secret reference in a named field",
    );
  }
  const candidate = candidates.find((item) => item.id === decision.candidateId);
  if (!candidate?.editable) {
    throw new Error("Saved sign-in model did not choose an editable sign-in field");
  }
  const text = candidateText(candidate);
  const passwordish = /pass(word)?|credential|pin/u.test(text);
  const usernameish = /user|email|e-mail|login|log in|account/u.test(text);
  if (passwordish && decision.text !== SIGN_IN_PASSWORD_REFERENCE) {
    throw new Error("Saved sign-in model chose the wrong secret reference for the password field");
  }
  if (!passwordish && usernameish && decision.text !== SIGN_IN_USERNAME_REFERENCE) {
    throw new Error("Saved sign-in model chose the wrong secret reference for the username field");
  }
}

/** Resolve and register plaintext as sensitive runtime input. The job keeps it
 * only in memory; every persistence/transport projection already redacts
 * registered sensitive values. */
export async function prepareActiveSignIn(input: {
  ctx: RecipeStepContext;
  accountKey?: string;
}): Promise<ActiveSignInSecrets> {
  const accountKey = normalizeSavedSignInKey(input.accountKey);
  const job = input.ctx.job;
  if (!job?.projectId) {
    throw new Error(`Saved sign-in "${accountKey}" requires a project-scoped run`);
  }
  const resolved = await resolveSavedSignIn({ projectId: job.projectId, key: accountKey });
  const active: ActiveSignInSecrets = Object.freeze({
    accountKey,
    username: resolved.username,
    password: resolved.password,
    source: resolved.source,
    ...(resolved.reference ? { reference: resolved.reference } : {}),
  });
  const usernameInput = `signin.${accountKey}.username`;
  const passwordInput = `signin.${accountKey}.password`;
  job.resolvedInputs[usernameInput] = resolved.username;
  job.resolvedInputs[passwordInput] = resolved.password;
  job.sensitiveInputNames = [
    ...new Set([...(job.sensitiveInputNames ?? []), usernameInput, passwordInput]),
  ].sort((left, right) => left.localeCompare(right));
  return active;
}
