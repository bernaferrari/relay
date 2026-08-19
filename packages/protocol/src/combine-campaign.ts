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
  world: string;
  values: Record<string, string>;
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
  target: {
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
};
