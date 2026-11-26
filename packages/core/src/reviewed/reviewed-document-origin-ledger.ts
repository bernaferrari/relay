/** Append-only lifecycle rules for reviewed-origin authority.
 *
 * A projection never becomes a bearer capability: it needs a signed pending →
 * active history, and any durable revocation tombstone wins over a stale active
 * event. This module is intentionally offline-only. */
import type {
  ReviewedDocumentOriginLedger,
  ReviewedDocumentOriginProjection,
  ReviewedDocumentOriginRevocation,
} from "@relay/protocol";
import {
  issueReviewedDocumentOriginLedgerAuthorization,
  reviewedDocumentOriginLedgerAuthorizationIsValid,
} from "./reviewed-document-origin-authority.js";
import { reviewedDocumentOriginRevocationEvidenceIsValid } from "./reviewed-document-origin-evidence.js";

export type ReviewedDocumentOriginLedgerState = "pending" | "active" | "revoked";

export type ReviewedDocumentOriginLedgerHistory = {
  state: ReviewedDocumentOriginLedgerState;
  pending: ReviewedDocumentOriginLedger;
  latest: ReviewedDocumentOriginLedger;
  active?: ReviewedDocumentOriginLedger;
  revoked?: ReviewedDocumentOriginLedger;
};

function finiteTime(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function signature(ledger: ReviewedDocumentOriginLedger | undefined): string | undefined {
  const value = ledger?.authorization?.signature;
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/u.test(value) ? value : undefined;
}

function isPending(
  ledger: ReviewedDocumentOriginLedger | undefined,
): ledger is ReviewedDocumentOriginLedger {
  return Boolean(
    ledger &&
    ledger.schemaVersion === 1 &&
    typeof ledger.projectionId === "string" &&
    ledger.projectionId.length > 0 &&
    ledger.sequence === 1 &&
    ledger.status === "pending" &&
    finiteTime(ledger.createdAt) &&
    ledger.activatedAt === undefined &&
    ledger.revocation === undefined &&
    ledger.previousAuthorizationSignature === undefined &&
    signature(ledger),
  );
}

function isActive(
  ledger: ReviewedDocumentOriginLedger | undefined,
  pending: ReviewedDocumentOriginLedger,
): ledger is ReviewedDocumentOriginLedger {
  return Boolean(
    ledger &&
    ledger.schemaVersion === 1 &&
    ledger.projectionId === pending.projectionId &&
    ledger.sequence === 2 &&
    ledger.status === "active" &&
    ledger.createdAt === pending.createdAt &&
    finiteTime(ledger.activatedAt) &&
    ledger.activatedAt >= pending.createdAt &&
    ledger.revocation === undefined &&
    ledger.previousAuthorizationSignature === signature(pending) &&
    signature(ledger),
  );
}

function isRevoked(
  ledger: ReviewedDocumentOriginLedger | undefined,
  pending: ReviewedDocumentOriginLedger,
  active: ReviewedDocumentOriginLedger,
): ledger is ReviewedDocumentOriginLedger {
  return Boolean(
    ledger &&
    ledger.schemaVersion === 1 &&
    ledger.projectionId === pending.projectionId &&
    ledger.sequence === 3 &&
    ledger.status === "revoked" &&
    ledger.createdAt === pending.createdAt &&
    ledger.activatedAt === active.activatedAt &&
    ledger.previousAuthorizationSignature === signature(active) &&
    ledger.revocation &&
    signature(ledger),
  );
}

/** Structural validation used inside a synchronous control-store transaction.
 * Authorization additionally verifies HMACs and revocation CAS evidence. */
export function reviewedDocumentOriginLedgerHistory(
  events: readonly ReviewedDocumentOriginLedger[],
): ReviewedDocumentOriginLedgerHistory | undefined {
  const pending = events[0];
  if (!isPending(pending)) return undefined;
  if (events.length === 1) return { state: "pending", pending, latest: pending };

  const active = events[1];
  if (!isActive(active, pending)) return undefined;
  if (events.length === 2) return { state: "active", pending, active, latest: active };

  const revoked = events[2];
  if (!isRevoked(revoked, pending, active) || events.length !== 3) return undefined;
  return { state: "revoked", pending, active, revoked, latest: revoked };
}

export async function reviewedDocumentOriginLedgerHistoryIsActive(input: {
  projection: ReviewedDocumentOriginProjection;
  events: readonly ReviewedDocumentOriginLedger[];
  /** A separate durable tombstone prevents a copied pre-revocation active row
   * from becoming authoritative again. Any tombstone fails closed. */
  revocationTombstone?: ReviewedDocumentOriginLedger;
}): Promise<ReviewedDocumentOriginLedger | undefined> {
  const history = reviewedDocumentOriginLedgerHistory(input.events);
  if (
    !history ||
    history.state !== "active" ||
    history.latest.projectionId !== input.projection.id ||
    input.revocationTombstone
  ) {
    return undefined;
  }
  const authorized = await Promise.all(
    input.events.map((ledger) => reviewedDocumentOriginLedgerAuthorizationIsValid(ledger)),
  );
  return authorized.every(Boolean) ? history.latest : undefined;
}

export async function reviewedDocumentOriginLedgerHistoryIsRevoked(input: {
  projection: ReviewedDocumentOriginProjection;
  events: readonly ReviewedDocumentOriginLedger[];
  revocationTombstone?: ReviewedDocumentOriginLedger;
}): Promise<ReviewedDocumentOriginLedger | undefined> {
  const history = reviewedDocumentOriginLedgerHistory(input.events);
  if (
    !history ||
    history.state !== "revoked" ||
    history.latest.projectionId !== input.projection.id ||
    !history.revoked ||
    !input.revocationTombstone
  ) {
    return undefined;
  }
  if (signature(history.revoked) !== signature(input.revocationTombstone)) return undefined;
  const authorized = await Promise.all(
    input.events.map((ledger) => reviewedDocumentOriginLedgerAuthorizationIsValid(ledger)),
  );
  if (!authorized.every(Boolean)) return undefined;
  return (await reviewedDocumentOriginRevocationEvidenceIsValid({
    projection: input.projection,
    ledger: history.revoked,
  }))
    ? history.revoked
    : undefined;
}

/** A tombstone is sufficient to block authority even when a partial storage
 * rollback removed the final ledger event. It deliberately validates only the
 * signed revocation decision, not a reconstructed lifecycle: callers use it
 * for idempotent audit responses, never to restore authority. */
export async function reviewedDocumentOriginRevocationTombstoneIsValid(input: {
  projection: ReviewedDocumentOriginProjection;
  tombstone?: ReviewedDocumentOriginLedger;
}): Promise<ReviewedDocumentOriginLedger | undefined> {
  const tombstone = input.tombstone;
  if (
    !tombstone ||
    tombstone.schemaVersion !== 1 ||
    tombstone.projectionId !== input.projection.id ||
    tombstone.sequence !== 3 ||
    tombstone.status !== "revoked" ||
    !tombstone.revocation ||
    !signature(tombstone) ||
    !(await reviewedDocumentOriginLedgerAuthorizationIsValid(tombstone))
  ) {
    return undefined;
  }
  return (await reviewedDocumentOriginRevocationEvidenceIsValid({
    projection: input.projection,
    ledger: tombstone,
  }))
    ? tombstone
    : undefined;
}

export async function issueReviewedDocumentOriginActivationLedger(input: {
  projectionId: string;
  at: number;
}): Promise<{ pending: ReviewedDocumentOriginLedger; active: ReviewedDocumentOriginLedger }> {
  const pendingBase = {
    schemaVersion: 1 as const,
    projectionId: input.projectionId,
    sequence: 1 as const,
    status: "pending" as const,
    createdAt: input.at,
  };
  const pending: ReviewedDocumentOriginLedger = {
    ...pendingBase,
    authorization: await issueReviewedDocumentOriginLedgerAuthorization(pendingBase),
  };
  const activeBase = {
    schemaVersion: 1 as const,
    projectionId: input.projectionId,
    sequence: 2 as const,
    previousAuthorizationSignature: pending.authorization.signature,
    status: "active" as const,
    createdAt: input.at,
    activatedAt: input.at,
  };
  const active: ReviewedDocumentOriginLedger = {
    ...activeBase,
    authorization: await issueReviewedDocumentOriginLedgerAuthorization(activeBase),
  };
  return { pending, active };
}

export async function issueReviewedDocumentOriginRevocationLedger(input: {
  active: ReviewedDocumentOriginLedger;
  revocation: ReviewedDocumentOriginRevocation;
}): Promise<ReviewedDocumentOriginLedger> {
  if (input.active.status !== "active" || input.active.sequence !== 2 || !signature(input.active)) {
    throw new Error("Cannot revoke a reviewed-origin ledger without an active lifecycle event");
  }
  const ledgerBase = {
    schemaVersion: 1 as const,
    projectionId: input.active.projectionId,
    sequence: 3 as const,
    previousAuthorizationSignature: input.active.authorization.signature,
    status: "revoked" as const,
    createdAt: input.active.createdAt,
    activatedAt: input.active.activatedAt,
    revocation: input.revocation,
  };
  return {
    ...ledgerBase,
    authorization: await issueReviewedDocumentOriginLedgerAuthorization(ledgerBase),
  };
}
