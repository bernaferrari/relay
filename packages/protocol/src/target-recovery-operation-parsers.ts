/**
 * Runtime parsers for the target-recovery boundary.
 *
 * Recovery has an intentionally stronger proof shape than ordinary target
 * control: an optional durable-fence release must carry immutable evidence
 * from a ready recovery. Keeping it here prevents that safety contract from
 * getting lost among the central operation registry's unrelated parsers.
 */
import type { RuntimeParser } from "./operation-contract.js";
import type { OperationInput, OperationOutput } from "./operation-map.js";
import {
  boolean,
  fail,
  number,
  objectParser,
  record,
  string,
} from "./operation-parser-primitives.js";

export type TargetRecoveryOperationParserDependencies = {
  assertTargetRuntimeReadiness(value: unknown, label: string): void;
};

function assertImmutableRecoveryFenceEvidence(
  value: unknown,
  label: string,
  expectedKind: "screenshot" | "snapshot",
): { sha256: string } {
  const evidence = record(value, label);
  string(evidence.id, `${label} id`);
  if (evidence.kind !== expectedKind) {
    fail(`${label} kind`, `must be ${expectedKind}`);
  }
  number(evidence.capturedAt, `${label} capturedAt`);
  const uri = string(evidence.uri, `${label} uri`);
  const sha256 = string(evidence.sha256, `${label} sha256`);
  if (!/^[a-f0-9]{64}$/iu.test(sha256) || uri !== `relay-evidence://${sha256}`) {
    fail(`${label} integrity`, "must be a content-addressed Relay evidence reference");
  }
  number(evidence.bytes, `${label} bytes`);
  if (typeof evidence.mime !== "string" || !evidence.mime.trim()) {
    fail(`${label} mime`, "is required");
  }
  return { sha256 };
}

export function createTargetRecoveryOperationParsers(
  dependencies: TargetRecoveryOperationParserDependencies,
): {
  targetRecoverInputParser: RuntimeParser<OperationInput<"target.recover">>;
  targetRecoverOutputParser: RuntimeParser<OperationOutput<"target.recover">>;
} {
  const { assertTargetRuntimeReadiness } = dependencies;
  const targetRecoverInputParser = objectParser<OperationInput<"target.recover">>(
    "target recovery input",
    (input) => {
      string(input.serial, "target recovery serial");
      if (
        input.reason !== undefined &&
        (typeof input.reason !== "string" ||
          !["connect", "observe", "control", "record", "auto"].includes(input.reason))
      ) {
        fail("target recovery reason", "must be connect, observe, control, record, or auto");
      }
      if (input.recoveryFenceAssignmentId !== undefined) {
        const assignmentId = string(
          input.recoveryFenceAssignmentId,
          "target recovery recoveryFenceAssignmentId",
        );
        if (!assignmentId.trim() || assignmentId.trim().length > 256) {
          fail(
            "target recovery recoveryFenceAssignmentId",
            "must be a non-empty identifier of at most 256 characters",
          );
        }
      }
    },
  );

  const targetRecoverOutputParser = objectParser<OperationOutput<"target.recover">>(
    "target recovery response",
    (input) => {
      const recovery = record(input.recovery, "target recovery");
      string(recovery.serial, "target recovery serial");
      boolean(recovery.recovered, "target recovered");
      boolean(recovery.ready, "target ready");
      string(recovery.summary, "target recovery summary");
      if (!Array.isArray(recovery.actions)) fail("target recovery actions", "must be an array");
      for (const value of recovery.actions as unknown[]) {
        const action = record(value, "target recovery action");
        if (!["stale-lock", "agent-device", "core-device"].includes(String(action.kind))) {
          fail("target recovery action kind", "is invalid");
        }
        if (!["completed", "skipped", "failed"].includes(String(action.status))) {
          fail("target recovery action status", "is invalid");
        }
        string(action.detail, "target recovery action detail");
      }
      const session = record(recovery.session, "target recovery session");
      if (session.status !== "restored" && session.status !== "unavailable") {
        fail("target recovery session status", "must be restored or unavailable");
      }
      if (session.app !== undefined) string(session.app, "target recovery session app");
      if (session.fallback !== undefined) {
        boolean(session.fallback, "target recovery session fallback");
      }
      string(session.detail, "target recovery session detail");
      if (recovery.readiness !== undefined) {
        assertTargetRuntimeReadiness(recovery.readiness, "target recovery readiness");
      }
      if (input.recoveryFenceRelease === undefined) return;

      if (recovery.ready !== true) {
        fail("target recovery fence release", "requires a ready recovered target");
      }
      const release = record(input.recoveryFenceRelease, "target recovery fence release");
      const assignmentId = string(
        release.assignmentId,
        "target recovery fence release assignmentId",
      );
      if (!assignmentId.trim()) {
        fail("target recovery fence release assignmentId", "must be non-empty");
      }
      number(release.releasedAt, "target recovery fence release releasedAt");
      const reproofId = string(release.reproofId, "target recovery fence release reproofId");
      const evidence = record(release.evidence, "target recovery fence release evidence");
      const manifest = assertImmutableRecoveryFenceEvidence(
        evidence.manifest,
        "target recovery fence release manifest",
        "snapshot",
      );
      assertImmutableRecoveryFenceEvidence(
        evidence.screenshotBefore,
        "target recovery fence release screenshotBefore",
        "screenshot",
      );
      assertImmutableRecoveryFenceEvidence(
        evidence.semanticSnapshot,
        "target recovery fence release semanticSnapshot",
        "snapshot",
      );
      assertImmutableRecoveryFenceEvidence(
        evidence.screenshotAfter,
        "target recovery fence release screenshotAfter",
        "screenshot",
      );
      if (reproofId !== `durable-recovery-fence-reproof:${manifest.sha256}`) {
        fail(
          "target recovery fence release reproofId",
          "must match the immutable recovery-fence manifest",
        );
      }
    },
  );

  return { targetRecoverInputParser, targetRecoverOutputParser };
}
