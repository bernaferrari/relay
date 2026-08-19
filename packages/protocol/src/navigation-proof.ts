/**
 * The one public answer to "where is this target now?" during a run.
 *
 * A prior proof is diagnostic context only. Consumers must never execute from
 * it after the cursor becomes unknown or enters an external application.
 */
export type NavigationProofCursor =
  | {
      status: "proven";
      screenId: string;
      proofToken: string;
      source: "screen-observation" | "transition" | "cleanup";
      updatedAt: number;
    }
  | {
      status: "unknown";
      reason: string;
      updatedAt: number;
      previous?: {
        screenId: string;
        proofToken: string;
      };
    }
  | {
      status: "external-handoff";
      foregroundApp: string;
      reason: string;
      updatedAt: number;
      previous?: {
        screenId: string;
        proofToken: string;
      };
    };

export type NavigationProofCursorArtifact = NavigationProofCursor & {
  schemaVersion: 1;
};
