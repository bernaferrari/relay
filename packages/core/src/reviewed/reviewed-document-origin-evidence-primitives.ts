import { createHash } from "node:crypto";
import type { AppMap, ScrollSurfaceEvidence } from "@relay/protocol";
import { serializeAppMap } from "../app-map/serialization.js";

export function reviewedDocumentOriginAppMapDigest(map: AppMap): string {
  return createHash("sha256")
    .update(JSON.stringify(serializeAppMap(map)))
    .digest("hex");
}

export function sameReviewedDocumentOriginEvidence(
  left: ScrollSurfaceEvidence,
  right: ScrollSurfaceEvidence,
): boolean {
  return (
    left.id === right.id &&
    left.uri === right.uri &&
    left.sha256 === right.sha256 &&
    left.mime === right.mime &&
    left.bytes === right.bytes
  );
}
