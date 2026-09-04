import type {
  AuthoringEvidence,
  ChangeProofExecutionHumanEvidenceAttachment,
} from "@relay/protocol";
import { canonicalSha256 } from "./canonical-json.js";
import { persistAuthoringEvidence } from "./authoring-evidence.js";

const MAX_BYTES = 1_500_000;

export type ChangeProofHumanEvidenceScope = {
  organizationId: string;
  projectId: string;
  proofId: string;
  executionId: string;
  cellId: string;
  stepId: string;
};

export type PersistedChangeProofHumanEvidence = {
  evidence: AuthoringEvidence;
  evidenceDigest: `sha256:${string}`;
  scopeDigest: `sha256:${string}`;
};

/** A stable binding between the content and the exact paused Proof boundary.
 * This digest is retained in the execution audit record, so a copied content
 * digest cannot be presented as evidence for another cell or step. */
export function changeProofHumanEvidenceScopeDigest(input: {
  scope: ChangeProofHumanEvidenceScope;
  evidenceDigest: `sha256:${string}`;
}): `sha256:${string}` {
  return canonicalSha256({ scope: input.scope, evidenceDigest: input.evidenceDigest });
}

function decodeAttachment(attachment: ChangeProofExecutionHumanEvidenceAttachment): Buffer {
  if (attachment.encoding === "utf8") {
    const bytes = Buffer.from(attachment.data, "utf8");
    if (bytes.byteLength > MAX_BYTES) {
      throw new Error(`Human evidence attachment exceeds ${MAX_BYTES} bytes`);
    }
    return bytes;
  }

  // Buffer.from(base64) silently ignores malformed characters. Require a
  // canonical round-trip so the server hashes exactly what the client sent.
  if (
    attachment.data.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(attachment.data)
  ) {
    throw new Error("Human evidence attachment is not canonical base64");
  }
  const bytes = Buffer.from(attachment.data, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
    throw new Error(`Human evidence attachment must be between 1 and ${MAX_BYTES} bytes`);
  }
  if (bytes.toString("base64") !== attachment.data) {
    throw new Error("Human evidence attachment is not canonical base64");
  }
  return bytes;
}

/** Persist a bounded attachment before resuming the coordinator. The returned
 * digest is server-derived and can only be used with the supplied exact
 * execution scope. */
export async function persistChangeProofHumanEvidence(input: {
  scope: ChangeProofHumanEvidenceScope;
  attachment: ChangeProofExecutionHumanEvidenceAttachment;
}): Promise<PersistedChangeProofHumanEvidence> {
  const bytes = decodeAttachment(input.attachment);
  const evidence = await persistAuthoringEvidence({
    kind: input.attachment.kind,
    capturedAt: input.attachment.capturedAt,
    data: bytes,
    ...(input.attachment.mime ? { mime: input.attachment.mime } : {}),
    ...(input.attachment.startMs === undefined ? {} : { startMs: input.attachment.startMs }),
    ...(input.attachment.endMs === undefined ? {} : { endMs: input.attachment.endMs }),
  });
  if (!evidence.sha256) throw new Error("Persisted human evidence has no integrity digest");
  const evidenceDigest = `sha256:${evidence.sha256}` as `sha256:${string}`;
  return {
    evidence,
    evidenceDigest,
    scopeDigest: changeProofHumanEvidenceScopeDigest({
      scope: input.scope,
      evidenceDigest,
    }),
  };
}
