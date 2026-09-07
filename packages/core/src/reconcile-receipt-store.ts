/** Durable reconcile receipts. A lost HTTP response can retrieve the same
 * observed effect without resending input. */

export type DurableReconcileReceipt = {
  resolutionId: string;
  mutationId: string;
  serial: string;
  outcome: "applied" | "not-applied" | "ambiguous";
  observationId?: string;
  health?: {
    state: "ready" | "blocked" | "uncertain";
    pendingMutationId?: string;
    reason?: string;
  };
  healthSnapshot?: unknown;
  observation?: unknown;
  reviewedAt: number;
};

const byResolution = new Map<string, DurableReconcileReceipt>();
const byMutation = new Map<string, DurableReconcileReceipt>();

function mutationKey(serial: string, mutationId: string): string {
  return `${serial}:${mutationId}`;
}

export function rememberReconcileReceipt(
  input: Omit<DurableReconcileReceipt, "resolutionId" | "reviewedAt"> & {
    resolutionId?: string;
    reviewedAt?: number;
  },
): DurableReconcileReceipt {
  const existing = byMutation.get(mutationKey(input.serial, input.mutationId));
  if (existing) return existing;
  const receipt: DurableReconcileReceipt = {
    ...input,
    resolutionId: input.resolutionId ?? crypto.randomUUID(),
    reviewedAt: input.reviewedAt ?? Date.now(),
  };
  byResolution.set(receipt.resolutionId, receipt);
  byMutation.set(mutationKey(receipt.serial, receipt.mutationId), receipt);
  return receipt;
}

export function readReconcileReceipt(input: {
  resolutionId?: string;
  serial?: string;
  mutationId?: string;
}): DurableReconcileReceipt | undefined {
  const resolutionId = input.resolutionId?.trim();
  if (resolutionId) return byResolution.get(resolutionId);
  if (input.serial && input.mutationId) {
    return byMutation.get(mutationKey(input.serial, input.mutationId));
  }
  return undefined;
}

export function clearReconcileReceipts(): void {
  byResolution.clear();
  byMutation.clear();
}
