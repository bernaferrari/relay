export type WorkflowJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly WorkflowJsonValue[]
  | { readonly [key: string]: WorkflowJsonValue };

export type DurableWorkflowKind = "run-test" | "author-test" | "repeat-test";
export type DurableWorkflowStatus = "active" | "needs-attention" | "terminal" | "expired";

export type DurableWorkflowResourceRef =
  | { kind: "job"; id: string }
  | { kind: "authoring-session"; id: string }
  | { kind: "campaign"; id: string };

export type DurableWorkflowResolution = {
  kind: "abandoned";
  reason: string;
  at: number;
};

/**
 * Server-owned continuation state. A workflow ID is only a lookup key: project
 * authorization and target control remain authoritative on every transition.
 */
export type DurableWorkflowRecord = {
  schemaVersion: 1;
  workflowId: string;
  organizationId: string;
  projectId: string;
  kind: DurableWorkflowKind;
  version: number;
  status: DurableWorkflowStatus;
  frozenIdentity: WorkflowJsonValue;
  /** Immutable identity used only for create-request replay comparison. Later
   * canonical resource reconciliation may refine frozenIdentity, never this. */
  creationIdentity?: WorkflowJsonValue;
  /** Immutable create-time resource. Null records that no resource existed
   * before later canonical attachment. */
  creationResource?: DurableWorkflowResourceRef | null;
  resource?: DurableWorkflowResourceRef;
  createdBy: string;
  lastActorId: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  lastTransition: string;
  resolution?: DurableWorkflowResolution;
  /** A v1 client-carried reference may be adopted once, but is never emitted. */
  adoptedLegacyRefDigest?: string;
};

export type DurableWorkflowAuditEvent = {
  schemaVersion: 1;
  workflowId: string;
  sequence: number;
  version: number;
  actorId: string;
  transition: string;
  status: DurableWorkflowStatus;
  resource?: DurableWorkflowResourceRef;
  resolution?: DurableWorkflowResolution;
  at: number;
};

export type DurableWorkflowRead = {
  record: DurableWorkflowRecord;
  audit: readonly DurableWorkflowAuditEvent[];
};

export type WorkflowCreateInput = {
  workflowId?: string;
  kind?: DurableWorkflowKind;
  frozenIdentity?: WorkflowJsonValue;
  /** Bounded v1 input used only to create a digest-backed adoption record.
   * The raw reference is never stored or returned. */
  legacyRef?: string;
  expiresAt?: number;
};

type WorkflowTransitionFence = { workflowId: string; expectedVersion: number };

export type WorkflowTransitionInput = WorkflowTransitionFence &
  (
    | { action: "attach-run"; jobId: string }
    | { action: "abandon-run"; reason: string }
    | { action: "cancel-run" }
    | { action: "start-authoring"; leaseId: string }
    | { action: "authoring-record"; interaction: import("./authoring.js").AuthoringInteraction }
    | { action: "authoring-checkpoint"; label?: string }
    | { action: "authoring-stop" }
    | { action: "authoring-edit"; edit: import("./authoring.js").AuthoringRecordingEdit }
    | { action: "authoring-replay" }
    | {
        action: "authoring-approve";
        destination?: import("./authoring.js").AuthoringCommitDestination;
      }
    | { action: "authoring-discard" }
    | { action: "authoring-cancel" }
    | { action: "authoring-abandon"; reason: string }
    | { action: "reserve-repeat-pilot" }
    | { action: "attach-repeat"; campaignId: string }
    | { action: "reserve-repeat-resume"; reviewed?: boolean }
    | { action: "complete-repeat-resume" }
    | { action: "reserve-repeat-cancel" }
    | { action: "complete-repeat-cancel" }
  );

export type DurableWorkflowOperationOutput = {
  workflow: DurableWorkflowRead;
  /** Current canonical resource projection, never client authority. */
  job?: Record<string, unknown>;
  /** Current canonical Authoring Session projection. */
  session?: Record<string, unknown>;
  /** Current canonical Repeat campaign projection. */
  campaign?: Record<string, unknown>;
};

export type WorkflowOperationMap = {
  "workflow.create": {
    input: WorkflowCreateInput;
    output: DurableWorkflowOperationOutput & { disposition: "created" | "existing" };
  };
  "workflow.get": {
    input: { workflowId: string };
    output: DurableWorkflowOperationOutput;
  };
  "workflow.transition": {
    input: WorkflowTransitionInput;
    output: DurableWorkflowOperationOutput;
  };
};
