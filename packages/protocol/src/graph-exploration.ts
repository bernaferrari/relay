import type { Connection, ScreenVariant } from "./app-map.js";
import type {
  ExplorationActionPolicyDecision,
  ExplorationFrontierRanking,
} from "./exploration-policy.js";
import type { StepTarget } from "./recipes.js";
import type { AppMapScenarioTest } from "./test-intent.js";

export type GraphExplorationControl = {
  key: string;
  label: string;
  target: StepTarget;
  role?: string;
  value?: string;
  enabled?: boolean;
  selected?: boolean;
  documentOrder: number;
  documentY: number;
};

export type GraphExplorationObservation = {
  controlKey: string;
  outcome:
    | { kind: "no-op"; reason: string }
    | { kind: "external"; ownerApp?: string; reason: string }
    | {
        kind: "screen";
        destinationScreenId: string;
        /** Existing reviewed cleanup edges, in execution order. */
        cleanupConnectionIds?: string[];
      };
};

export type GraphExplorationClassification =
  | "navigation"
  | "reversible"
  | "destructive"
  | "external"
  | "no-op"
  | "unknown";

export type GraphExplorationDecision = {
  control: GraphExplorationControl;
  classification: GraphExplorationClassification;
  decision: "explore" | "skip" | "defer";
  reason: string;
  existingConnectionId?: string;
  proposedConnectionId?: string;
  cleanupConnectionIds?: string[];
  /** Deterministic admission; model provenance never authorizes this action. */
  policy?: ExplorationActionPolicyDecision;
};

/** Pure, review-only output. Applying any connection or Test remains an
 * explicit canonical App Map mutation after a person or agent reviews it. */
export type GraphExplorationProposal = {
  schemaVersion: 1;
  status: "review-required";
  appMapId: string;
  baseRevision: number;
  sourceScreenId: string;
  sourceVariantId: ScreenVariant["id"];
  surface: { id: string; captureId: string };
  decisions: GraphExplorationDecision[];
  proposedConnections: Connection[];
  proposedTest: AppMapScenarioTest;
  /** Proposal priority only. Ranking never schedules or executes an action. */
  frontier?: ExplorationFrontierRanking;
  summary: {
    controls: number;
    explore: number;
    skipped: number;
    deferred: number;
    proposedConnections: number;
  };
};
