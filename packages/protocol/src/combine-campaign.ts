import type {
  CampaignCapacityDurationInput,
  LocalCampaignCapacityPreflight,
} from "./campaign-capacity-plan.js";
import type { ExecutionTargetRef, LocalAgentDeviceExecutionTargetRef } from "./execution-target.js";

export type CombineCampaignCaseStatus =
  | "pending"
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "blocked"
  | "cancelled";

export type CombineCampaignStatus =
  | "pilot-running"
  | "ready-to-resume"
  | "needs-review"
  | "running"
  | "completed"
  | "completed-with-problems"
  | "cancelled";

export type CombineCampaignCase = {
  index: number;
  cellId: string;
  testId: string;
  world: string;
  values: Record<string, string>;
  targetProfileId: string;
  /**
   * Frozen per-cell execution location. Optional only for schema-v1 campaigns
   * written before target binding was introduced; those records fall back to
   * the legacy campaign-wide target during resume.
   */
  target?: ExecutionTargetRef;
  childIntentDigest: string;
  outerIntentDigest: string;
  wrapperGraphDigest: string;
  staticInputDigest: string;
  phase: "pilot" | "coverage";
  status: CombineCampaignCaseStatus;
  jobId?: string;
  error?: string;
};

/** Durable, bounded execution state for a saved Combine. App Map/Test data
 * remains the editable source of truth; this record only owns scheduling and
 * immutable lineage. */
export type CombineCampaign = {
  schemaVersion: 1;
  id: string;
  projectId: string;
  ownerId?: string;
  appMapId: string;
  combineId: string;
  sourceRevision: number;
  latestRevision: number;
  /** Legacy campaign-wide target for schema-v1 records. New multi-target
   * campaigns put the authoritative target on every case instead. */
  target?: {
    kind: "device" | "browser";
    id: string;
    platform: "android" | "ios" | "browser";
  };
  status: CombineCampaignStatus;
  createdAt: number;
  updatedAt: number;
  cases: CombineCampaignCase[];
  lineage: Array<{
    kind: "created" | "resumed" | "cancelled";
    at: number;
    appMapRevision: number;
    actorId?: string;
  }>;
  execution?: {
    selected?: Record<string, string[]>;
    selectedCellIds: string[];
    strategy?: "zip" | "cartesian" | "pairwise";
    seed: number;
    title?: string;
    /** Immutable admission evidence captured before any Combine jobs queued. */
    localAdmission?: {
      request: {
        deadlineMs: number;
        duration: LocalCampaignCapacityPreflight["input"]["duration"];
        /** Required for a mixed Android/iOS campaign so one platform's timing
         * is never silently used as the other platform's SLA. */
        durationsByPlatform?: Partial<Record<"android" | "ios", CampaignCapacityDurationInput>>;
        setupHeadroomMs?: number;
        recoveryHeadroomMs?: number;
      };
      preflight: LocalCampaignCapacityPreflight;
      /** Per-bound-target checks preserve target affinity rather than
       * pretending that same-platform work can move between devices. */
      targetPreflights?: LocalCampaignCapacityPreflight[];
      /** Exact local execution targets that were admitted. */
      targets: LocalAgentDeviceExecutionTargetRef[];
    };
  };
};
