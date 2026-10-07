import type {
  AppMap,
  AppMapCompiledTest,
  AppMapCompiledRuntimeTargetProfile,
  OfflineTestPreflightReport,
  SourceRevision,
} from "@relay/protocol";
import {
  playerMapSnapshotArtifact,
  type AppMapTestExecutionIntent,
  type EnqueueJobInput,
  type prepareRegisteredBuildForProof,
} from "@relay/core";
import type { AppMapProofExecutionAuthority } from "./app-map-proof-execution-admission.js";

/** Immutable admission receipts assembled from the exact sources queued for this run. */
export function queuedAppMapTestArtifacts(input: {
  map: AppMap;
  plan: AppMapCompiledTest;
  executionIntent: AppMapTestExecutionIntent;
  preflight: OfflineTestPreflightReport;
  runtimeTargetProfile?: AppMapCompiledRuntimeTargetProfile;
  queuedAt: number;
  targetId: string;
  workflowRequestId?: string;
  proofExecutionAuthority?: AppMapProofExecutionAuthority;
  buildProvenance?: Awaited<ReturnType<typeof prepareRegisteredBuildForProof>>;
  webBuildBinding?: {
    id: string;
    artifactDigest: string;
    sourceSha: string;
    configuration: string;
    environmentRevision: string;
  };
  queuedSourceRevision?: SourceRevision;
  inputArtifacts?: EnqueueJobInput["artifacts"];
}): NonNullable<EnqueueJobInput["artifacts"]> {
  const {
    map,
    plan,
    executionIntent,
    preflight,
    runtimeTargetProfile,
    queuedAt,
    buildProvenance,
    webBuildBinding,
    queuedSourceRevision,
  } = input;
  return [
    ...(input.inputArtifacts ?? []),
    ...(input.proofExecutionAuthority?.humanInterventionEvidence
      ? [
          {
            kind: "proof-human-intervention-evidence",
            capturedAt: input.proofExecutionAuthority.humanInterventionEvidence.recordedAt,
            data: structuredClone(input.proofExecutionAuthority.humanInterventionEvidence),
          },
        ]
      : []),
    ...(buildProvenance
      ? [
          {
            kind: "proof-build-provenance",
            capturedAt: buildProvenance.observation.observedAt,
            data: structuredClone(buildProvenance),
          },
        ]
      : []),
    ...(webBuildBinding
      ? [
          {
            kind: "proof-web-deployment-binding",
            capturedAt: queuedAt,
            data: {
              ...structuredClone(webBuildBinding),
              schemaVersion: 1,
              buildId: webBuildBinding.id,
              target: { kind: "browser", id: input.targetId, platform: "browser" },
              observation: {
                status: "verified",
                observedAt: queuedAt,
                artifactDigest: webBuildBinding.artifactDigest,
              },
            },
          },
        ]
      : []),
    ...(input.workflowRequestId
      ? [
          {
            kind: "app-map-test-workflow-request",
            capturedAt: queuedAt,
            data: { schemaVersion: 1, requestId: input.workflowRequestId },
          },
        ]
      : []),
    {
      kind: "app-map-test-execution-intent",
      capturedAt: queuedAt,
      data: executionIntent,
    },
    {
      kind: "app-map-test-plan",
      capturedAt: queuedAt,
      data: plan,
    },
    playerMapSnapshotArtifact(map, queuedAt),
    {
      kind: "app-map-test-preflight",
      capturedAt: queuedAt,
      data: {
        schemaVersion: 1,
        ...(runtimeTargetProfile
          ? { runtimeTargetProfile: structuredClone(runtimeTargetProfile) }
          : {}),
        report: structuredClone(preflight),
      },
    },
  ];
}
