/**
 * Scoped media delivery for the immutable evidence which releases a human
 * intervention pause. A content hash by itself is never authority to read a
 * workspace blob: callers first prove ownership of the enclosing job or run.
 */
import type http from "node:http";
import {
  findHumanInterventionReproofEvidence,
  readAuthoringEvidence,
  visualEvidenceAllowed,
} from "@relay/core";
import { CORS_HEADERS, HttpError } from "./http.js";

export async function sendHumanInterventionReproofEvidence(input: {
  response: http.ServerResponse;
  artifacts: readonly { kind?: unknown; data?: unknown }[];
  sha256: string;
}): Promise<void> {
  const evidence = findHumanInterventionReproofEvidence(input.artifacts, input.sha256);
  if (!evidence) throw new HttpError(404, "Human intervention reproof evidence not found");
  // AX trees contain text just as screenshots contain pixels. Neither is safe
  // to expose while the workspace visual-redaction policy is enabled.
  if (!visualEvidenceAllowed()) {
    throw new HttpError(
      409,
      "Human intervention reproof evidence is withheld by redaction policy",
      {
        code: "VISUAL_EVIDENCE_REDACTED",
        recovery:
          "Disable visual evidence redaction in the trusted local workspace before reviewing this proof.",
      },
    );
  }
  const bytes = await readAuthoringEvidence(evidence.sha256!);
  if (!bytes) throw new HttpError(404, "Human intervention reproof evidence not found");
  input.response.writeHead(200, {
    "Content-Type": evidence.mime!,
    "Content-Length": bytes.byteLength,
    "Cache-Control": "private, max-age=31536000, immutable",
    ...CORS_HEADERS,
  });
  input.response.end(bytes);
}
