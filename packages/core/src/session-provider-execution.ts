/**
 * Provider-aware target boundary for scheduled session jobs.
 *
 * A TargetDriverRegistry is host-owned runtime state, never durable job data.
 * Capture it at admission, then enter provider control and capture scopes
 * before the session coordinator creates generic job control or consults any
 * local target/client path. Once inside that boundary, the coordinator only
 * receives a Device facade supplied by the registered driver.
 */
import {
  executionTargetRefKey,
  type ExecutionTargetRef,
  type TargetDefinition,
} from "@relay/protocol";
import { openApp, rememberedTargetApplication, resetDeviceClient, type Device } from "./device.js";
import { createDeviceForTarget } from "./device-factory.js";
import { getBrowserDevice } from "./browser-target.js";
import { hardStopDeviceSession } from "./control.js";
import { now } from "./events.js";
import { getRedactionPolicy, visualEvidenceAllowed } from "./redaction.js";
import type { TestJob } from "./session-contract.js";
import { resolveSessionDeviceMeta } from "./session-job-support.js";
import { executionTargetRefForJob } from "./target-driver.js";
import {
  createProviderTargetExecutionPlan,
  currentTargetDriverRegistry,
  withProviderTargetExecutionPlan,
  type ProviderTargetExecutionPlan,
  type TargetDriverRegistry,
} from "./target-driver-registry.js";
import { preflightTarget, readTarget } from "./targets.js";
import { isPhysicalRunnerRoute, resolveAppleControlRoute } from "./apple-control-route.js";
import { ensureSavedTestIosRunner } from "./session-ios-runner-readiness.js";
import { awaitColdSavedIosAppForeground } from "./ios-app-launch-readiness.js";

/** A registry snapshot is only an admission input. Once validation succeeds,
 * the immutable plan below owns the exact driver reference used at execution. */
const providerDriverRegistriesByJob = new WeakMap<TestJob, TargetDriverRegistry>();
const providerExecutionPlansByJob = new WeakMap<TestJob, ProviderTargetExecutionPlan>();

/** The only provider-specific state visible to the generic job lifecycle. */
export type ProviderSessionExecution = Readonly<{
  device: Device;
  deviceName: string;
}>;

/** Establish the saved application origin for a cold App Map Test before its
 * first strict screen assertion. The application binding is saved Test data
 * chosen explicitly in setup; deriving one from AX identifiers would turn
 * a screen observation into an unreviewed navigation instruction. */
export async function runColdAppMapStartup(
  job: TestJob,
  device: Device,
  startupMode: "warm" | "cold" | "verified-checkpoint" | undefined,
  originApplication: string | undefined,
  log: (line: string) => void,
  launch: (device: Device, app: string) => Promise<void> = async (target, app) => {
    await openApp(target, app, { relaunch: true });
  },
): Promise<void> {
  if (startupMode !== "cold" || job.targetKind === "browser") return;
  // Later iOS Combine cells share one XCTest process. Relaunching Grok between
  // dest-end Tests focuses the composer (keyboard leftover) and queues AX
  // behind abandoned watchdog work from the previous cell.
  if (job.platform === "ios" && typeof job.caseIndex === "number" && job.caseIndex > 0) {
    log("startup: skip cold relaunch on later iOS combine cell");
    return;
  }
  const app = originApplication;
  if (!app) {
    throw new Error("Choose a starting app in Test settings before using Restart app.");
  }
  await launch(device, app);
  log(`startup: launched saved origin application ${app}`);
  await awaitColdSavedIosAppForeground(job, app);
}

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
  providerExecutionPlansByJob.delete(job);
  providerDriverRegistriesByJob.set(job, currentTargetDriverRegistry());
}

function providerDriverRegistryForJob(job: TestJob): TargetDriverRegistry {
  return providerDriverRegistriesByJob.get(job) ?? currentTargetDriverRegistry();
}

function requireProviderExecutionPlan(
  job: TestJob,
  target: Extract<ExecutionTargetRef, { kind: "provider-session" }>,
): ProviderTargetExecutionPlan {
  const plan = providerExecutionPlansByJob.get(job);
  if (!plan) {
    throw new Error(
      "Provider execution plan is missing; the job was not admitted for this process",
    );
  }
  if (executionTargetRefKey(plan.target) !== executionTargetRefKey(target)) {
    throw new Error("Provider execution plan does not match the job's frozen execution target");
  }
  return plan;
}

/** Reject an unsupported provider before scheduler staging, durable assignment
 * writes, or local target reservations can occur. */
export function assertProviderTargetJobAdmission(job: TestJob): void {
  const target = executionTargetRefForJob(job);
  if (target.kind !== "provider-session") return;
  const existing = providerExecutionPlansByJob.get(job);
  if (existing) {
    requireProviderExecutionPlan(job, target);
    return;
  }
  const plan = createProviderTargetExecutionPlan(target, providerDriverRegistryForJob(job));
  providerExecutionPlansByJob.set(job, plan);
  providerDriverRegistriesByJob.delete(job);
}

function recordProviderExecutionBoundary(
  job: TestJob,
  target: ProviderTargetExecutionPlan["target"],
): void {
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
  const plan = requireProviderExecutionPlan(job, target);
  await withProviderTargetExecutionPlan(plan, async (providerExecution) => {
    recordProviderExecutionBoundary(job, plan.target);
    await operation(
      Object.freeze({
        device: providerExecution.control.device,
        deviceName: `${plan.target.provider.key}:${plan.target.targetId}`,
      }),
    );
  });
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

/** First Combine cell and standalone jobs reset Android helper bindings.
 * Later cells in the same batch (`caseIndex > 0`) keep the helper. Physical
 * iOS never hard-stops here — that backgrounds the app onto SpringBoard. */
export function shouldHardStopPreparedSession(
  physicalIos: boolean | undefined,
  caseIndex: number | undefined,
): boolean {
  if (physicalIos) return false;
  return !(typeof caseIndex === "number" && caseIndex > 0);
}

/** Acquire the target-scoped Device after generic control/lease checks have
 * completed. A prepared provider target returns its driver facade before any
 * local cleanup, browser setup, or AgentDevice factory call. */
export async function acquirePreparedSessionDevice(
  job: TestJob,
  target: PreparedSessionTarget,
  pushLog: (line: string) => void,
  options?: { requirePhysicalIosSemantics?: boolean },
): Promise<Device> {
  if (target.providerDevice) return target.providerDevice;
  if (job.targetKind === "browser" && target.browserTarget) {
    if (!job.browserCaseProfile) {
      throw new Error("Browser proof is missing its frozen browser case profile");
    }
    const preflight = await preflightTarget(target.browserTarget);
    job.artifacts.push({ kind: "target-preflight", capturedAt: now(), data: preflight });
    if (!preflight.ok) {
      const failures = preflight.checks
        .filter((check) => check.status === "fail")
        .map((check) => check.message)
        .join("; ");
      throw new Error(`environment preflight failed: ${failures}`);
    }
    // A scheduled proof owns a fresh, non-persistent context. The persistent
    // authoring profile remains available only through the explicit authoring
    // path (openBrowserTarget/getBrowserDevice({ mode: "authoring" })).
    return await getBrowserDevice(target.browserTarget.id, {
      mode: "proof",
      headless: true,
      profile: job.browserCaseProfile,
      projectId: job.projectId ?? "default",
      ...(job.unsignedLaneId ? { unsignedLaneId: job.unsignedLaneId } : {}),
      // Browser proof contexts are acquired before generic collectors start.
      // Carry the Run-frozen privacy decision into Playwright so a redacted
      // Run never opens a context that records visual bytes in the first place.
      recordVideo: visualEvidenceAllowed(job.evidencePolicy.redaction ?? getRedactionPolicy()),
    });
  }

  // A physical iOS target uses one long-lived XCTest process. Stopping it
  // here backgrounds the app immediately before source verification and turns
  // a valid map run into a tap on SpringBoard. The first Combine cell (and
  // any standalone job) still releases stale Android helper bindings. Later
  // cells in the same batch keep the helper — recover-between-cells was the
  // grok-android-daily tax on every Test.
  const savedPhysicalIos =
    options?.requirePhysicalIosSemantics === true &&
    isPhysicalRunnerRoute(resolveAppleControlRoute(job.targetContext));
  if (shouldHardStopPreparedSession(savedPhysicalIos || target.physicalIos, job.caseIndex)) {
    await hardStopDeviceSession(job.targetContext);
    resetDeviceClient(job.targetContext);
  }
  const device = createDeviceForTarget(job.targetContext);
  if (savedPhysicalIos) {
    await ensureSavedTestIosRunner(device, job.targetContext, pushLog);
    // Physical openApp is a sidecar activation, not an SDK attach. The saved
    // cold startup owns its one launch; warm/later cells keep the current app.
    return device;
  }
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
