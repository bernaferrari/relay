import {
  changeProofExecutionConfirmationReceiptSchema,
  changeProofExecutionPreviewSchema,
  executionRiskSchema,
  parseChangeVerification,
  type ChangeProofExecutionConfirmationReceipt,
  type ChangeProofExecutionConsumedReceipt,
  type ChangeProofExecutionPreview,
  type ChangeProofExecutionHumanIntervention,
  type ChangeVerification,
} from "@relay/protocol";
import { canonicalSha256 } from "./canonical-json.js";
import { readControlStore, withControlStore, type ControlStore } from "./collaboration-store.js";
import type { ChangeProofConfirmationRecord } from "./change-proof-confirmation-db.js";

export const DEFAULT_CHANGE_PROOF_CONFIRMATION_TTL_MS = 5 * 60_000;
export const MAX_CHANGE_PROOF_CONFIRMATION_TTL_MS = 60 * 60_000;

export type ChangeProofConfirmationErrorCode =
  | "PROOF_CONFIRMATION_REQUIRED"
  | "PROOF_CONFIRMATION_INVALID"
  | "PROOF_CONFIRMATION_EXPIRED"
  | "PROOF_CONFIRMATION_REPLAYED"
  | "PROOF_CONFIRMATION_HUMAN_ONLY"
  | "PROOF_CONFIRMATION_PROHIBITED";

export class ChangeProofConfirmationError extends Error {
  constructor(
    readonly code: ChangeProofConfirmationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ChangeProofConfirmationError";
  }
}

type FrozenCell = NonNullable<ChangeVerification["selection"]["cells"]>[number];

function cellForProof(proof: ChangeVerification, cellId: string): FrozenCell {
  const cell = proof.selection.cells?.find((candidate) => candidate.id === cellId);
  if (!cell) {
    throw new ChangeProofConfirmationError(
      "PROOF_CONFIRMATION_INVALID",
      `Proof cell ${cellId} is absent from the frozen Verification Plan`,
    );
  }
  return cell;
}

function parsedRisk(cell: FrozenCell) {
  if (!cell.executionRisk || !cell.executionRiskDigest) {
    throw new ChangeProofConfirmationError(
      "PROOF_CONFIRMATION_INVALID",
      `Proof cell ${cell.id} has no frozen execution-risk authority`,
    );
  }
  const risk = executionRiskSchema.safeParse(cell.executionRisk);
  if (!risk.success || canonicalSha256(risk.data) !== cell.executionRiskDigest) {
    throw new ChangeProofConfirmationError(
      "PROOF_CONFIRMATION_INVALID",
      `Proof cell ${cell.id} execution-risk authority is malformed or has drifted`,
    );
  }
  if (risk.data.cleanupRequired !== cell.cleanupRequired) {
    throw new ChangeProofConfirmationError(
      "PROOF_CONFIRMATION_INVALID",
      `Proof cell ${cell.id} cleanup authority disagrees with execution risk`,
    );
  }
  return risk.data;
}

/** Build the exact read-only authority a human sees before confirming a
 * guarded or destructive cell. The digest covers the complete frozen cell
 * set and every effect-bearing risk field, so changing any one of them makes
 * an already-issued receipt unusable. */
export function changeProofExecutionPreview(value: unknown): ChangeProofExecutionPreview {
  const proof = parseChangeVerification(value);
  const cells = proof.selection.cells;
  if (!cells?.length) {
    throw new ChangeProofConfirmationError(
      "PROOF_CONFIRMATION_INVALID",
      "Proof has no frozen Verification Cells to preview",
    );
  }
  const base = {
    schemaVersion: 1 as const,
    organizationId: proof.organizationId,
    projectId: proof.projectId,
    proofId: proof.id,
    proofVersion: proof.version,
    action: "proof.run" as const,
    cells: cells.map((cell) => {
      const executionRisk = parsedRisk(cell);
      return {
        cellId: cell.id,
        targetCaseId: cell.targetCaseId,
        buildId: cell.buildId,
        executionRisk,
        executionRiskDigest: cell.executionRiskDigest!,
        cleanupRequired: cell.cleanupRequired,
      };
    }),
  };
  return changeProofExecutionPreviewSchema.parse({
    ...base,
    previewDigest: canonicalSha256(base),
  });
}

export function humanOnlyInterventionForCell(input: {
  proof: unknown;
  cellId: string;
  at: number;
}): ChangeProofExecutionHumanIntervention {
  const proof = parseChangeVerification(input.proof);
  const cell = cellForProof(proof, input.cellId);
  const risk = parsedRisk(cell);
  if (risk.confirmation !== "human-only") {
    throw new ChangeProofConfirmationError(
      "PROOF_CONFIRMATION_INVALID",
      `Proof cell ${cell.id} does not contain a human-only step`,
    );
  }
  const stepId = risk.reasons.find((reason) => reason.stepId)?.stepId;
  if (!stepId) {
    throw new ChangeProofConfirmationError(
      "PROOF_CONFIRMATION_INVALID",
      `Proof cell ${cell.id} has no exact human-only step identity`,
    );
  }
  return {
    cellId: cell.id,
    stepId,
    effects: [...risk.externalEffects],
    reason:
      risk.reasons.find((reason) => reason.stepId === stepId)?.explanation ??
      "The reviewed Test requires a human-only step.",
    at: input.at,
  };
}

/** Issue a short-lived receipt from the exact preview. The helper is useful to
 * local UI/CLI callers and remains deterministic for tests; the server still
 * verifies every field again when the receipt is consumed. */
export function issueChangeProofExecutionConfirmationReceipt(input: {
  proof: unknown;
  cellId: string;
  actorId: string;
  now?: number;
  ttlMs?: number;
  fixtureScope?: ChangeProofExecutionConfirmationReceipt["fixtureScope"];
}): ChangeProofExecutionConfirmationReceipt {
  const proof = parseChangeVerification(input.proof);
  const preview = changeProofExecutionPreview(proof);
  const cell = cellForProof(proof, input.cellId);
  const now = input.now ?? Date.now();
  const ttlMs = input.ttlMs ?? DEFAULT_CHANGE_PROOF_CONFIRMATION_TTL_MS;
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("Confirmation issuedAt is invalid");
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > MAX_CHANGE_PROOF_CONFIRMATION_TTL_MS) {
    throw new Error("Confirmation TTL is outside the bounded policy");
  }
  const receiptBase = {
    schemaVersion: 1 as const,
    previewDigest: preview.previewDigest,
    actorId: input.actorId,
    scope: {
      organizationId: proof.organizationId,
      projectId: proof.projectId,
      proofId: proof.id,
      proofVersion: proof.version,
      cellId: cell.id,
      targetCaseId: cell.targetCaseId,
      buildId: cell.buildId,
    },
    action: "proof.run" as const,
    issuedAt: now,
    expiresAt: now + ttlMs,
    ...(input.fixtureScope ? { fixtureScope: input.fixtureScope } : {}),
  };
  const receiptIdentity = {
    previewDigest: receiptBase.previewDigest,
    actorId: receiptBase.actorId,
    scope: receiptBase.scope,
    action: receiptBase.action,
    issuedAt: receiptBase.issuedAt,
    expiresAt: receiptBase.expiresAt,
    ...(receiptBase.fixtureScope ? { fixtureScope: receiptBase.fixtureScope } : {}),
  };
  return changeProofExecutionConfirmationReceiptSchema.parse({
    ...receiptBase,
    receiptId: `proof-confirmation:${canonicalSha256(receiptIdentity).slice("sha256:".length)}`,
  });
}

function invalid(message: string): never {
  throw new ChangeProofConfirmationError("PROOF_CONFIRMATION_INVALID", message);
}

/** Verify receipts against the current immutable Proof before target control.
 * A receipt may authorize exactly one cell. The returned values are still the
 * caller's immutable receipts; the coordinator adds `consumedAt` only after
 * durable execution admission. */
export function validateChangeProofExecutionConfirmations(input: {
  proof: unknown;
  receipts?: readonly unknown[];
  actorId: string;
  now?: number;
}): ChangeProofExecutionConfirmationReceipt[] {
  const proof = parseChangeVerification(input.proof);
  const preview = changeProofExecutionPreview(proof);
  const cells = proof.selection.cells ?? [];
  const receipts = (input.receipts ?? []).map((value) => {
    const parsed = changeProofExecutionConfirmationReceiptSchema.safeParse(value);
    if (!parsed.success) invalid("Confirmation receipt is malformed");
    return parsed.data;
  });
  const now = input.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) invalid("Confirmation validation time is invalid");
  const byCell = new Map<string, ChangeProofExecutionConfirmationReceipt>();
  const byId = new Set<string>();
  for (const receipt of receipts) {
    if (byId.has(receipt.receiptId)) {
      throw new ChangeProofConfirmationError(
        "PROOF_CONFIRMATION_REPLAYED",
        `Confirmation receipt ${receipt.receiptId} is repeated`,
      );
    }
    byId.add(receipt.receiptId);
    if (byCell.has(receipt.scope.cellId)) {
      throw new ChangeProofConfirmationError(
        "PROOF_CONFIRMATION_REPLAYED",
        `Proof cell ${receipt.scope.cellId} has more than one confirmation receipt`,
      );
    }
    byCell.set(receipt.scope.cellId, receipt);
    if (receipt.actorId !== input.actorId)
      invalid(`Confirmation receipt ${receipt.receiptId} names another actor`);
    if (
      receipt.previewDigest !== preview.previewDigest ||
      receipt.action !== "proof.run" ||
      receipt.scope.organizationId !== proof.organizationId ||
      receipt.scope.projectId !== proof.projectId ||
      receipt.scope.proofId !== proof.id ||
      receipt.scope.proofVersion !== proof.version
    ) {
      invalid(`Confirmation receipt ${receipt.receiptId} does not match this Proof preview`);
    }
    if (receipt.issuedAt > now || receipt.expiresAt <= now) {
      throw new ChangeProofConfirmationError(
        "PROOF_CONFIRMATION_EXPIRED",
        `Confirmation receipt ${receipt.receiptId} is stale or not yet valid`,
      );
    }
  }
  for (const cell of cells) {
    const risk = parsedRisk(cell);
    if (risk.level === "prohibited") {
      throw new ChangeProofConfirmationError(
        "PROOF_CONFIRMATION_PROHIBITED",
        `Proof cell ${cell.id} is prohibited and cannot be run`,
      );
    }
    if (risk.confirmation === "human-only") {
      if (byCell.has(cell.id)) {
        throw new ChangeProofConfirmationError(
          "PROOF_CONFIRMATION_HUMAN_ONLY",
          `Proof cell ${cell.id} pauses for a human-only step and cannot consume an automation receipt`,
        );
      }
      continue;
    }
    const receipt = byCell.get(cell.id);
    const needsReceipt = risk.level !== "safe" || risk.confirmation !== "none";
    if (needsReceipt && !receipt) {
      throw new ChangeProofConfirmationError(
        "PROOF_CONFIRMATION_REQUIRED",
        `Proof cell ${cell.id} requires an exact human confirmation receipt`,
      );
    }
    if (!needsReceipt && receipt) {
      invalid(`Safe Proof cell ${cell.id} cannot consume a confirmation receipt`);
    }
    if (!receipt) continue;
    const targetCase = proof.selection.targetCases.find(
      (candidate) => candidate.id === cell.targetCaseId,
    );
    if (
      !targetCase ||
      receipt.scope.targetCaseId !== targetCase.id ||
      receipt.scope.buildId !== cell.buildId
    ) {
      invalid(
        `Confirmation receipt ${receipt.receiptId} does not match the exact cell target or build`,
      );
    }
    if (risk.level === "destructive") {
      if (!cell.cleanupRequired || !receipt.fixtureScope) {
        invalid(`Destructive Proof cell ${cell.id} requires fixture scope and cleanup authority`);
      }
      if (receipt.fixtureScope.targetProfileId !== targetCase.targetProfile.id) {
        invalid(`Confirmation receipt ${receipt.receiptId} is not scoped to the reviewed fixture`);
      }
    }
  }
  for (const receipt of receipts) {
    if (!cells.some((cell) => cell.id === receipt.scope.cellId)) {
      invalid(`Confirmation receipt ${receipt.receiptId} names an unknown Proof cell`);
    }
  }
  return receipts;
}

export function confirmationReceiptForCell(
  receipts: readonly ChangeProofExecutionConsumedReceipt[] | undefined,
  cellId: string,
): ChangeProofExecutionConsumedReceipt | undefined {
  return receipts?.find((receipt) => receipt.scope.cellId === cellId);
}

/** Persist issuance before a receipt can be submitted to proof.run. A
 * structurally valid client-forged receipt therefore has no authority unless
 * this authenticated human issuance boundary recorded the exact payload. */
export async function issueDurableChangeProofExecutionConfirmation(input: {
  proof: unknown;
  cellId: string;
  actorId: string;
  actorKind: "human" | "agent" | "system";
  now?: number;
  ttlMs?: number;
  fixtureScope?: ChangeProofExecutionConfirmationReceipt["fixtureScope"];
}): Promise<ChangeProofExecutionConfirmationReceipt> {
  if (input.actorKind !== "human") {
    throw new ChangeProofConfirmationError(
      "PROOF_CONFIRMATION_INVALID",
      "Only a human actor can issue a Proof confirmation receipt",
    );
  }
  const proof = parseChangeVerification(input.proof);
  const cell = cellForProof(proof, input.cellId);
  const risk = parsedRisk(cell);
  if (risk.level === "prohibited") {
    throw new ChangeProofConfirmationError(
      "PROOF_CONFIRMATION_PROHIBITED",
      `Proof cell ${cell.id} is prohibited and cannot be confirmed`,
    );
  }
  if (risk.confirmation === "human-only") {
    throw new ChangeProofConfirmationError(
      "PROOF_CONFIRMATION_HUMAN_ONLY",
      `Proof cell ${cell.id} pauses for a human-only step`,
    );
  }
  if (risk.level === "safe" && risk.confirmation === "none") {
    throw new ChangeProofConfirmationError(
      "PROOF_CONFIRMATION_INVALID",
      `Safe Proof cell ${cell.id} does not require a confirmation receipt`,
    );
  }
  if (risk.level === "destructive") {
    const targetCase = proof.selection.targetCases.find(
      (candidate) => candidate.id === cell.targetCaseId,
    );
    if (
      !targetCase ||
      !cell.cleanupRequired ||
      !input.fixtureScope ||
      input.fixtureScope.targetCaseId !== targetCase.id ||
      input.fixtureScope.targetProfileId !== targetCase.targetProfile.id
    ) {
      throw new ChangeProofConfirmationError(
        "PROOF_CONFIRMATION_INVALID",
        `Destructive Proof cell ${cell.id} requires the exact reviewed fixture and cleanup scope`,
      );
    }
  }
  const receipt = issueChangeProofExecutionConfirmationReceipt(input);
  const record: ChangeProofConfirmationRecord = { receipt };
  let persisted = receipt;
  await withControlStore((store) => {
    const existing = store.changeProofConfirmation(receipt.receiptId);
    if (existing) {
      if (
        existing.receipt.previewDigest !== receipt.previewDigest ||
        existing.receipt.actorId !== receipt.actorId ||
        canonicalSha256(existing.receipt.scope) !== canonicalSha256(receipt.scope) ||
        canonicalSha256(existing.receipt.fixtureScope ?? null) !==
          canonicalSha256(receipt.fixtureScope ?? null)
      ) {
        throw new ChangeProofConfirmationError(
          "PROOF_CONFIRMATION_REPLAYED",
          `Confirmation receipt ${receipt.receiptId} is already bound to another intent`,
        );
      }
      if (existing.consumedAt !== undefined) {
        throw new ChangeProofConfirmationError(
          "PROOF_CONFIRMATION_REPLAYED",
          `Confirmation receipt ${receipt.receiptId} was already consumed`,
        );
      }
      persisted = existing.receipt;
      return;
    }
    if (!store.insertChangeProofConfirmation(record)) {
      throw new ChangeProofConfirmationError(
        "PROOF_CONFIRMATION_REPLAYED",
        `Confirmation receipt ${receipt.receiptId} could not be issued`,
      );
    }
  });
  return persisted;
}

export async function validateIssuedChangeProofExecutionConfirmations(
  receipts: readonly ChangeProofExecutionConfirmationReceipt[],
): Promise<void> {
  await readControlStore((store) => {
    for (const receipt of receipts) {
      const stored = store.changeProofConfirmation(receipt.receiptId);
      if (!stored || canonicalSha256(stored.receipt) !== canonicalSha256(receipt)) {
        throw new ChangeProofConfirmationError(
          "PROOF_CONFIRMATION_INVALID",
          `Confirmation receipt ${receipt.receiptId} was not issued for this exact intent`,
        );
      }
      if (stored.consumedAt !== undefined) {
        throw new ChangeProofConfirmationError(
          "PROOF_CONFIRMATION_REPLAYED",
          `Confirmation receipt ${receipt.receiptId} was already consumed`,
        );
      }
    }
  });
}

/** Consume receipts in the same SQLite transaction as execution insertion.
 * This is the crash boundary: either the durable execution and all receipts
 * are committed together, or no authority is spent. */
export function consumeIssuedChangeProofExecutionConfirmations(
  store: ControlStore,
  receipts: readonly ChangeProofExecutionConfirmationReceipt[],
  consumedAt: number,
): void {
  for (const receipt of receipts) {
    const stored = store.changeProofConfirmation(receipt.receiptId);
    if (!stored || canonicalSha256(stored.receipt) !== canonicalSha256(receipt)) {
      throw new ChangeProofConfirmationError(
        "PROOF_CONFIRMATION_INVALID",
        `Confirmation receipt ${receipt.receiptId} was not issued for this exact intent`,
      );
    }
    if (
      stored.consumedAt !== undefined ||
      !store.consumeChangeProofConfirmation(receipt, consumedAt)
    ) {
      throw new ChangeProofConfirmationError(
        "PROOF_CONFIRMATION_REPLAYED",
        `Confirmation receipt ${receipt.receiptId} was already consumed`,
      );
    }
  }
}
