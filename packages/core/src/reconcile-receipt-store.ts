import { KeyedSerialQueue } from "./coordination-store.js";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findWorkspaceRoot } from "./workspace-root.js";

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

type ReceiptScope = { organizationId?: string; projectId?: string };

function directory(scope: ReceiptScope): string {
  const root = process.env.RELAY_STATE_DIR?.trim() || join(findWorkspaceRoot(), ".relay");
  const key = createHash("sha256")
    .update(JSON.stringify([scope.organizationId ?? "local", scope.projectId ?? "local"]))
    .digest("hex");
  return join(root, "reconciliation", key);
}

function receiptPath(scope: ReceiptScope, resolutionId: string): string {
  return join(directory(scope), createHash("sha256").update(resolutionId).digest("hex") + ".json");
}

function write(scope: ReceiptScope, receipt: DurableReconcileReceipt): void {
  const dir = directory(scope);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = receiptPath(scope, receipt.resolutionId);
  const temp = path + "." + randomUUID() + ".tmp";
  try {
    writeFileSync(temp, JSON.stringify(receipt), { mode: 0o600 });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}

export function rememberReconcileReceipt(
  input: Omit<DurableReconcileReceipt, "resolutionId" | "reviewedAt"> &
    ReceiptScope & {
      resolutionId?: string;
      reviewedAt?: number;
    },
): DurableReconcileReceipt {
  const exact = input.resolutionId
    ? readReconcileReceipt({
        organizationId: input.organizationId,
        projectId: input.projectId,
        resolutionId: input.resolutionId,
      })
    : undefined;
  if (exact && (exact.serial !== input.serial || exact.mutationId !== input.mutationId))
    throw new Error("Reconciliation attempt belongs to a different input");
  if (exact) return exact;
  const latest = readReconcileReceipt({ ...input, resolutionId: undefined });
  // A resolved mutation is final. A fresh request may progress an ambiguous decision.
  if (latest && (latest.outcome !== "ambiguous" || !input.resolutionId)) return latest;
  const { organizationId: _org, projectId: _project, ...fields } = input;
  const receipt: DurableReconcileReceipt = {
    ...fields,
    resolutionId: input.resolutionId ?? randomUUID(),
    reviewedAt: Math.max(input.reviewedAt ?? Date.now(), (latest?.reviewedAt ?? 0) + 1),
  };
  write(input, receipt);
  return receipt;
}

/** Complete the prepared decision after the in-memory supervisor transition. */
export function completeReconcileReceipt(
  input: ReceiptScope & {
    receipt: DurableReconcileReceipt;
    health: NonNullable<DurableReconcileReceipt["health"]>;
    healthSnapshot: unknown;
  },
): DurableReconcileReceipt {
  const receipt = { ...input.receipt, health: input.health, healthSnapshot: input.healthSnapshot };
  write(input, receipt);
  return receipt;
}

export function readReconcileReceipt(
  input: ReceiptScope & {
    resolutionId?: string;
    serial?: string;
    mutationId?: string;
  },
): DurableReconcileReceipt | undefined {
  const resolutionId = input.resolutionId?.trim();
  const matches = (receipt: DurableReconcileReceipt) =>
    (!input.serial || receipt.serial === input.serial) &&
    (!input.mutationId || receipt.mutationId === input.mutationId);
  if (resolutionId) {
    try {
      const receipt = JSON.parse(
        readFileSync(receiptPath(input, resolutionId), "utf8"),
      ) as DurableReconcileReceipt;
      return receipt.resolutionId === resolutionId && matches(receipt) ? receipt : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  if (!input.serial || !input.mutationId) return undefined;
  let names: string[];
  try {
    names = readdirSync(directory(input));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return names
    .filter((name) => name.endsWith(".json"))
    .map(
      (name) =>
        JSON.parse(readFileSync(join(directory(input), name), "utf8")) as DurableReconcileReceipt,
    )
    .filter(matches)
    .sort((a, b) => b.reviewedAt - a.reviewedAt)[0];
}

/** There is no process cache; test callers may safely simulate a restart. */
export function clearReconcileReceipts(): void {}

const attempts = new KeyedSerialQueue();
export function serializeReconciliation<T>(
  serial: string,
  operation: () => Promise<T>,
): Promise<T> {
  return attempts.run(serial, operation);
}
