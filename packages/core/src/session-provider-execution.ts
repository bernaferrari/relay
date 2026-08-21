/**
 * Provider-aware target boundary for scheduled session jobs.
 *
 * A TargetDriverRegistry is host-owned runtime state, never durable job data.
 * Capture it at admission, then enter provider control and capture scopes
 * before the session coordinator creates generic job control or consults any
 * local target/client path. Once inside that boundary, the coordinator only
 * receives a Device facade supplied by the registered driver.
 */
import type { TargetDefinition } from "@relay/protocol";
import { openApp, rememberedTargetApplication, resetDeviceClient, type Device } from "./device.js";
import { createDeviceForTarget } from "./device-factory.js";
import { getBrowserDevice } from "./browser-target.js";
import { hardStopDeviceSession } from "./control.js";
import { now } from "./events.js";
import type { TestJob } from "./session-contract.js";
import { resolveSessionDeviceMeta } from "./session-job-support.js";
import { executionTargetRefForJob } from "./target-driver.js";
import {
  assertProviderTargetExecutionAdmission,
  currentTargetDriverRegistry,
  withProviderTargetExecution,
  type TargetDriverRegistry,
} from "./target-driver-registry.js";
import { preflightTarget, readTarget } from "./targets.js";

/** A runtime driver implementation cannot cross a job transport or
 * persistence boundary. Capturing it at admission also prevents a queued job
 * from resolving against a later request's ambient provider registry. */
const providerDriverRegistriesByJob = new WeakMap<TestJob, TargetDriverRegistry>();

/** The only provider-specific state visible to the generic job lifecycle. */
export type ProviderSessionExecution = Readonly<{
  device: Device;
  deviceName: string;
}>;

/** Target discovery is separated from acquiring a Device so the coordinator
 * can publish its normal started event before potentially slow local setup. */
export type PreparedSessionTarget = Readonly<{
  browserTarget: TargetDefinition | null;
  deviceName?: string;
  deviceAvailable?: boolean;
  physicalIos?: boolean;
  providerDevice?: Device;
}>;

export function captureProviderDriverRegistry(job: TestJob): void {
  providerDriverRegistriesByJob.set(job, currentTargetDriverRegistry());
}

function providerDriverRegistryForJob(job: TestJob): TargetDriverRegistry {
  return providerDriverRegistriesByJob.get(job) ?? currentTargetDriverRegistry();
}

/** Reject an unsupported provider before scheduler staging, durable assignment
 * writes, or local target reservations can occur. */
export function assertProviderTargetJobAdmission(job: TestJob): void {
  const target = executionTargetRefForJob(job);
  if (target.kind !== "provider-session") return;
  assertProviderTargetExecutionAdmission(target, providerDriverRegistryForJob(job));
}

function recordProviderExecutionBoundary(job: TestJob): void {
  const target = executionTargetRefForJob(job);
  if (target.kind !== "provider-session") {
    throw new Error("Provider execution boundary requires a provider-session target");
  }
  // The canonical frozen ref and operation lease are persisted independently
  // in the run and durable assignment. This artifact makes the concrete
  // control/capture boundary inspectable without serializing a driver or
  // credential-bearing provider client.
  job.artifacts.push({
    kind: "target-driver-execution",
    capturedAt: now(),
    data: {
      schemaVersion: 1,
      target: structuredClone(target),
      provider: structuredClone(target.provider),
      capabilities: ["control", "capture"],
      ...(job.operationContext?.leaseId
        ? {
            lease: {
              id: job.operationContext.leaseId,
              ownerId: job.operationContext.leaseOwnerId ?? job.operationContext.actorId,
            },
          }
        : {}),
    },
  });
}

/**
 * Enter a registered provider's control and capture scopes if this job owns a
 * provider session. The callback is deliberately invoked only after both
 * scopes are active; it has no access to an AgentDevice factory or local
 * target metadata resolver. Returns false for established local targets.
 */
export async function runProviderTargetJobIfNeeded(
  job: TestJob,
  operation: (execution: ProviderSessionExecution) => Promise<void>,
): Promise<boolean> {
  const target = executionTargetRefForJob(job);
  if (target.kind !== "provider-session") return false;
  await withProviderTargetExecution(
    target,
    async (providerExecution) => {
      recordProviderExecutionBoundary(job);
      await operation(
        Object.freeze({
          device: providerExecution.control.device,
          deviceName: `${target.provider.key}:${target.targetId}`,
        }),
      );
    },
    providerDriverRegistryForJob(job),
  );
  return true;
}

/** Resolve target metadata without constructing a target client. Provider
 * sessions take the first branch, so local browser/device discovery can never
 * become a remote execution fallback. */
export async function prepareSessionTarget(
  job: TestJob,
  providerExecution?: ProviderSessionExecution,
): Promise<PreparedSessionTarget> {
  if (providerExecution) {
    return Object.freeze({
      browserTarget: null,
      deviceName: providerExecution.deviceName,
      deviceAvailable: true,
      physicalIos: false,
      providerDevice: providerExecution.device,
    });
  }
  const browserTarget = job.browserTargetId ? await readTarget(job.browserTargetId) : null;
  const meta =
    job.targetKind === "browser"
      ? { deviceName: browserTarget?.name, deviceAvailable: Boolean(browserTarget) }
      : await resolveSessionDeviceMeta(job.serial, job.platform);
  return Object.freeze({ browserTarget, ...meta });
}

/** Acquire the target-scoped Device after generic control/lease checks have
 * completed. A prepared provider target returns its driver facade before any
 * local cleanup, browser setup, or AgentDevice factory call. */
export async function acquirePreparedSessionDevice(
  job: TestJob,
  target: PreparedSessionTarget,
  pushLog: (line: string) => void,
): Promise<Device> {
  if (target.providerDevice) return target.providerDevice;
  if (job.targetKind === "browser" && target.browserTarget) {
    const preflight = await preflightTarget(target.browserTarget);
    job.artifacts.push({ kind: "target-preflight", capturedAt: now(), data: preflight });
    if (!preflight.ok) {
      const failures = preflight.checks
        .filter((check) => check.status === "fail")
        .map((check) => check.message)
        .join("; ");
      throw new Error(`environment preflight failed: ${failures}`);
    }
    return await getBrowserDevice(target.browserTarget.id);
  }

  // A physical iOS target uses one long-lived XCTest process. Stopping it
  // here backgrounds the app immediately before source verification and turns
  // a valid map run into a tap on SpringBoard. Simulators and Android still
  // benefit from releasing stale bindings between jobs.
  if (!target.physicalIos) {
    await hardStopDeviceSession(job.targetContext);
    resetDeviceClient(job.targetContext);
  }
  const device = createDeviceForTarget(job.targetContext);
  if (job.platform === "ios" && job.serial) {
    const app = await rememberedTargetApplication(job.targetContext);
    if (app) {
      pushLog(`session: prime ${app} without relaunch`);
      await openApp(device, app, { relaunch: false }).catch((error) => {
        pushLog(
          `warn: iOS session still unbound (${error instanceof Error ? error.message : String(error)}) — continuing with pixels`,
        );
      });
    }
  }
  return device;
}
