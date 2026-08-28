import type { OperationDefinition, RuntimeParser } from "./operation-contract.js";
import { operationInputContract } from "./operation-builders.js";
import { fail, number, objectParser, record, string } from "./operation-parser-primitives.js";
import type { TargetObservation } from "./target-observation.js";
import type { TargetSupervisorHealth } from "./target-supervisor.js";

const PIXEL_STATES = new Set(["ready", "delayed", "unavailable"]);
const SEMANTIC_STATES = new Set(["current", "stale", "refreshing", "wedged", "unavailable"]);
const INPUT_STATES = new Set(["ready", "uncertain", "blocked"]);
const OVERALL_STATES = new Set([
  "starting",
  "ready",
  "pixel-only",
  "recovering",
  "needs-human",
  "quarantined",
]);

function boundedOptionalText(value: unknown, label: string, maximum = 512): void {
  if (value !== undefined && string(value, label).length > maximum) {
    fail(label, `must be at most ${maximum} characters`);
  }
}

function targetSupervisorHealthOutput(input: {
  assertTargetRuntimeReadiness(value: unknown, label: string): void;
}): RuntimeParser<{ health: TargetSupervisorHealth }> {
  return objectParser(
    "bounded target supervisor health response",
    (value) => {
      const health = record(value.health, "target health");
      if (health.schemaVersion !== 1) fail("target health schemaVersion", "must be 1");
      if (
        health.visibility !== undefined &&
        health.visibility !== "project" &&
        health.visibility !== "public"
      ) {
        fail("target health visibility", "is unsupported");
      }
      const target = record(health.target, "target health target");
      const targetId = string(target.id, "target health target id");
      if (!targetId.trim()) fail("target health target id", "must be non-empty");
      if (targetId.length > 512) fail("target health target id", "must be at most 512 characters");
      if (!new Set(["android", "ios", "browser"]).has(String(target.kind))) {
        fail("target health target kind", "is unsupported");
      }
      number(health.observedAt, "target health observedAt");
      const epochs = record(health.epochs, "target health epochs");
      number(epochs.target, "target health target epoch");
      number(epochs.semanticSession, "target health semantic session epoch");
      const pixels = record(health.pixels, "target health pixels");
      if (!PIXEL_STATES.has(String(pixels.state)))
        fail("target health pixels state", "is unsupported");
      boundedOptionalText(pixels.lastError, "target health pixels error", 480);
      const semantics = record(health.semantics, "target health semantics");
      if (!SEMANTIC_STATES.has(String(semantics.state))) {
        fail("target health semantics state", "is unsupported");
      }
      boundedOptionalText(semantics.lastError, "target health semantics error", 480);
      const targetInput = record(health.input, "target health input");
      if (!INPUT_STATES.has(String(targetInput.state))) {
        fail("target health input state", "is unsupported");
      }
      boundedOptionalText(targetInput.pendingMutationId, "target health mutation id");
      boundedOptionalText(targetInput.reason, "target health input reason", 480);
      if (!OVERALL_STATES.has(String(health.overall))) {
        fail("target health overall state", "is unsupported");
      }
      const context = record(health.context, "target health context");
      boundedOptionalText(context.foregroundApp, "target health foreground app");
      boundedOptionalText(context.screenFingerprint, "target health screen fingerprint", 256);
      record(health.counters, "target health counters");
      record(health.latency, "target health latency");
      input.assertTargetRuntimeReadiness(health.readiness, "target health readiness");
      if (!Array.isArray(health.events)) fail("target health events", "must be an array");
      if (health.events.length > 128) fail("target health events", "must have at most 128 entries");
      for (const [index, rawEvent] of health.events.entries()) {
        const event = record(rawEvent, `target health event ${index}`);
        number(event.sequence, `target health event ${index} sequence`);
        number(event.at, `target health event ${index} at`);
        string(event.code, `target health event ${index} code`);
        boundedOptionalText(event.message, `target health event ${index} message`, 480);
      }
    },
  );
}

export function createTargetSupervisorOperationDefinition(input: {
  assertTargetRuntimeReadiness(value: unknown, label: string): void;
}): OperationDefinition<
  "target.health.get",
  { serial: string },
  { health: TargetSupervisorHealth }
> {
  const operationInput = objectParser<{ serial: string }>("target health input", (value) => {
    if (!string(value.serial, "target health serial").trim()) {
      fail("target health serial", "must be non-empty");
    }
  });
  const output = targetSupervisorHealthOutput(input);
  return {
    id: "target.health.get",
    version: 1,
    label: "Read target health",
    category: "target",
    mode: "query",
    input: operationInputContract("target.health.get", operationInput),
    output,
    idempotency: "inherent",
    targetCapabilities: [],
    lease: "none",
    confirmation: "none",
    minimumRole: "viewer",
    progress: false,
    cancellable: false,
    transport: { method: "GET", path: "/device/health" },
  };
}

export function createTargetInputReconciliationOperationDefinition(input: {
  assertTargetRuntimeReadiness(value: unknown, label: string): void;
  targetObservation: RuntimeParser<TargetObservation>;
}): OperationDefinition<
  "target.input.reconcile",
  {
    serial: string;
    mutationId: string;
    outcome: "applied" | "not-applied" | "ambiguous";
  },
  { health: TargetSupervisorHealth; observation: TargetObservation }
> {
  const operationInput = objectParser<{
    serial: string;
    mutationId: string;
    outcome: "applied" | "not-applied" | "ambiguous";
  }>("target input reconciliation", (value) => {
    if (!string(value.serial, "target input reconciliation serial").trim()) {
      fail("target input reconciliation serial", "must be non-empty");
    }
    if (!string(value.mutationId, "target input reconciliation mutationId").trim()) {
      fail("target input reconciliation mutationId", "must be non-empty");
    }
    if (!new Set(["applied", "not-applied", "ambiguous"]).has(String(value.outcome))) {
      fail("target input reconciliation outcome", "is unsupported");
    }
  });
  const health = targetSupervisorHealthOutput(input);
  const output = objectParser<{
    health: TargetSupervisorHealth;
    observation: TargetObservation;
  }>("target input reconciliation response", (value) => {
    health.parse({ health: value.health });
    input.targetObservation.parse(value.observation);
  });
  return {
    id: "target.input.reconcile",
    version: 1,
    label: "Reconcile uncertain target input",
    category: "target",
    mode: "command",
    input: operationInputContract("target.input.reconcile", operationInput),
    output,
    idempotency: "required",
    targetCapabilities: ["screenshot", "snapshot"],
    lease: "exclusive",
    confirmation: "confirm",
    minimumRole: "runner",
    progress: false,
    cancellable: false,
    transport: { method: "POST", path: "/device/input/reconcile" },
  };
}

export function createTargetSupervisorOperationDefinitions(input: {
  assertTargetRuntimeReadiness(value: unknown, label: string): void;
  targetObservation: RuntimeParser<TargetObservation>;
}) {
  return [
    createTargetSupervisorOperationDefinition(input),
    createTargetInputReconciliationOperationDefinition(input),
  ] as const;
}
