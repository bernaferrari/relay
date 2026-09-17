/**
 * RC-19 platform/tier/version capability gates. Unsupported work stays in the
 * denominator as blocked / unbound / human-only. Empty adb does not omit
 * Android combinations. Compile unresolved-step does not delete a workbook
 * original. A browser or simulator approximation is labeled as such and is
 * never the physical iOS/Android Imagine scenario.
 */

import type {
  CaptureReviewConfiguration,
  CaptureReviewObservedSession,
  CaptureReviewPlannedSlot,
} from "./capture-review.js";
import {
  resolvePlanCaptureReviewQueue,
  type PlanCaptureReviewQueue,
  type PlanCaptureReviewRunInput,
} from "./capture-review-plan.js";
import {
  canCoverWorkbookFamily,
  SURVIVAL_FAMILY_ID,
  SURVIVAL_REQUIRED_DWELL_MS,
  type ExecutionQueue,
} from "./execution-queue.js";
import {
  evaluateWorkbookCoverage,
  type WorkbookCatalogTest,
  type WorkbookCoverageManifest,
  type WorkbookCoverageReport,
} from "./workbook-coverage.js";

export const CAPABILITY_GATE_KINDS = [
  "removed",
  "dead-skip",
  "skip-temporary",
  "nonapplicable",
  "unsupported",
  "not-yet-recorded",
  "human-only",
] as const;
export type CapabilityGateKind = (typeof CAPABILITY_GATE_KINDS)[number];

export const CAPTURE_REVIEW_SCENARIO_KINDS = [
  "physical",
  "simulator-approximation",
  "emulator-approximation",
  "browser-approximation",
] as const;
export type CaptureReviewScenarioKind = (typeof CAPTURE_REVIEW_SCENARIO_KINDS)[number];

export type CapabilityInventory = {
  /** Successful empty `adb devices` means Android is disconnected, not absent from the plan. */
  adbDeviceCount: number;
  /** SuperGrok iPad home has no `navigation.tab.imagine`. Undefined means unknown — do not invent. */
  iosImagineTabPresent?: boolean;
};

export type CapabilityGate = {
  kind: CapabilityGateKind;
  reason: string;
};

/** Screenshot-first §8: lock / airplane / cellular / wifi / external-app-auth
 * are named capabilities. A Settings screenshot does not imply them. */
export const DEVICE_EFFECT_CAPABILITIES = [
  "lock-screen",
  "airplane",
  "cellular",
  "wifi",
  "external-app-auth",
] as const;
export type DeviceEffectCapability = (typeof DEVICE_EFFECT_CAPABILITIES)[number];

export const DEVICE_EFFECT_SUPPORT_STATUSES = [
  "supported",
  "unsupported",
  "human-only",
  "simulator-only",
] as const;
export type DeviceEffectSupportStatus = (typeof DEVICE_EFFECT_SUPPORT_STATUSES)[number];

export type DeviceEffectSupport = {
  capability: DeviceEffectCapability;
  status: DeviceEffectSupportStatus;
  /** Named primitive, or `none`. simctl status_bar is cosmetic, not a radio. */
  primitive: string;
  reason: string;
};

export type PlanCaptureReviewCapabilityRun = PlanCaptureReviewRunInput & {
  platform?: "android" | "ios" | "browser";
  approximation?: "simulator" | "emulator" | "browser";
  observed?: CaptureReviewObservedSession;
  executionQueue?: ExecutionQueue;
  declaredDwellMs?: number;
  kind?: string;
  serial?: string;
  family?: string;
  /** Explicit device-effect claims. Caption text is not a capability. */
  deviceEffects?: readonly DeviceEffectCapability[];
};

export const IOS_HARDWARE_CLASSES = [
  "physical-ipad",
  "physical-iphone",
  "simulator",
  "unproven",
] as const;
export type IosHardwareClass = (typeof IOS_HARDWARE_CLASSES)[number];

/** Physical iPad Pro used by grok-ios. Not iPhone or simulator coverage. */
export const LAB_PHYSICAL_IPAD_SERIAL = "db0c9b7c3aeb83dc2259d08e3b521a30f621d3f5";

export function classifyIosHardware(input: {
  kind?: string;
  name?: string;
  device?: string;
  serial?: string;
  approximation?: "simulator" | "emulator" | "browser";
}): IosHardwareClass {
  if (input.approximation === "simulator") return "simulator";
  if (input.serial === LAB_PHYSICAL_IPAD_SERIAL || input.device === LAB_PHYSICAL_IPAD_SERIAL) {
    return "physical-ipad";
  }
  const blob = `${input.kind ?? ""} ${input.name ?? ""} ${input.device ?? ""}`;
  if (/simulator/iu.test(blob)) return "simulator";
  if (/ipad/iu.test(blob)) return "physical-ipad";
  if (/iphone|ipod/iu.test(blob)) return "physical-iphone";
  return "unproven";
}

export function iosHardwareLabel(value: IosHardwareClass): string {
  if (value === "physical-ipad") return "physical iPad";
  if (value === "physical-iphone") return "physical iPhone";
  if (value === "simulator") return "iOS simulator";
  return "unproven iOS hardware";
}

/** iPad dest-ends do not cover iPhone or simulator. Unproven covers nothing. */
export function iosHardwareCovers(observed: IosHardwareClass, claimed: IosHardwareClass): boolean {
  if (observed === "unproven" || claimed === "unproven") return false;
  return observed === claimed;
}

const CHECKPOINT_DEVICE_EFFECTS: Record<string, DeviceEffectCapability> = {
  lock: "lock-screen",
  unlock: "lock-screen",
  "lock-screen": "lock-screen",
  airplane: "airplane",
  cellular: "cellular",
  "mobile-data": "cellular",
  wifi: "wifi",
  "external-app-auth": "external-app-auth",
  "external-auth": "external-app-auth",
};

export function deviceEffectFromCheckpointId(
  checkpointId?: string,
): DeviceEffectCapability | undefined {
  const key = checkpointId?.trim().toLowerCase();
  if (!key) return undefined;
  return CHECKPOINT_DEVICE_EFFECTS[key];
}

export function deviceEffectFromRecipeStep(step: {
  kind?: string;
  action?: string;
  setting?: string;
}): DeviceEffectCapability | undefined {
  if (step.kind === "device" && (step.action === "lock" || step.action === "unlock")) {
    return "lock-screen";
  }
  if (step.kind !== "settings") return undefined;
  if (step.setting === "airplane") return "airplane";
  if (step.setting === "mobile-data") return "cellular";
  if (step.setting === "wifi") return "wifi";
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function deviceEffectsFromRecipeSteps(
  steps: readonly unknown[] | undefined,
): DeviceEffectCapability[] {
  const found: DeviceEffectCapability[] = [];
  for (const step of steps ?? []) {
    if (!isRecord(step)) continue;
    const effect = deviceEffectFromRecipeStep({
      kind: typeof step.kind === "string" ? step.kind : undefined,
      action: typeof step.action === "string" ? step.action : undefined,
      setting: typeof step.setting === "string" ? step.setting : undefined,
    });
    if (effect && !found.includes(effect)) found.push(effect);
  }
  return found;
}

/** Caption / lookFor text is display only and is not a capability claim. */
export function claimedDeviceEffects(input: {
  checkpointId?: string;
  deviceEffects?: readonly DeviceEffectCapability[];
  recipeSteps?: readonly unknown[];
}): DeviceEffectCapability[] {
  const found: DeviceEffectCapability[] = [];
  const push = (effect: DeviceEffectCapability | undefined): void => {
    if (effect && !found.includes(effect)) found.push(effect);
  };
  for (const effect of input.deviceEffects ?? []) push(effect);
  for (const effect of deviceEffectsFromRecipeSteps(input.recipeSteps)) push(effect);
  push(deviceEffectFromCheckpointId(input.checkpointId));
  return found;
}

const PHYSICAL_LOCK: DeviceEffectSupport = {
  capability: "lock-screen",
  status: "human-only",
  primitive: "none",
  reason:
    "Physical lock/unlock remains human. CoreDevice `devicectl device info lockState` is read-only; XCTest and go-ios have no lock command. Unlock still needs a person. Do not reboot.",
};

const SIMULATOR_LOCK: DeviceEffectSupport = {
  capability: "lock-screen",
  status: "unsupported",
  primitive: "none",
  reason:
    "lock-screen control is not supported by this iOS runner — including the simulator. Cmd-L is not a recipe.",
};

const PHYSICAL_AIRPLANE: DeviceEffectSupport = {
  capability: "airplane",
  status: "human-only",
  primitive: "none",
  reason:
    "airplane on iOS is a Settings handoff, not settings airplane on the Grok runner. agent-device `settings` requires a simulator; XCTest stays on Grok unless Preferences is launched. A required 1-minute outage cannot become a 10-second outage.",
};

function simulatorStatusBar(capability: "airplane" | "wifi" | "cellular"): DeviceEffectSupport {
  return {
    capability,
    status: "simulator-only",
    primitive: "simctl status_bar override",
    reason: `iOS simulator ${capability} is simctl status_bar cosmetic, not a radio outage, and is not physical iPad ${SURVIVAL_FAMILY_ID} coverage`,
  };
}

const PHYSICAL_CELLULAR: DeviceEffectSupport = {
  capability: "cellular",
  status: "unsupported",
  primitive: "none",
  reason:
    "settings mobile-data is only supported on Android (`adb shell svc data`). Relay has no iOS cellular primitive on iPad or iPhone. Do not invent radios.",
};

const PHYSICAL_WIFI: DeviceEffectSupport = {
  capability: "wifi",
  status: "human-only",
  primitive: "none",
  reason:
    "Wifi/cell/airplane stay human on physical iOS. agent-device wifi is simulator status_bar only.",
};

const EXTERNAL_AUTH: DeviceEffectSupport = {
  capability: "external-app-auth",
  status: "human-only",
  primitive: "none",
  reason:
    "External app authentication stays human (OAuth / Settings / Safari). A screenshot is not a recorded auth capability.",
};

function resolvedIosHardware(input: {
  hardware: IosHardwareClass;
  serial?: string;
}): IosHardwareClass {
  if (input.serial === LAB_PHYSICAL_IPAD_SERIAL) return "physical-ipad";
  return input.hardware;
}

/** Actual Relay support. Physical iPad and iPhone share these primitives. */
export function iosDeviceEffectSupport(input: {
  hardware: IosHardwareClass;
  serial?: string;
  capability: DeviceEffectCapability;
}): DeviceEffectSupport {
  const hardware = resolvedIosHardware(input);
  if (input.capability === "external-app-auth") return EXTERNAL_AUTH;
  if (hardware === "simulator") {
    if (input.capability === "lock-screen") return SIMULATOR_LOCK;
    if (input.capability === "airplane") return simulatorStatusBar("airplane");
    if (input.capability === "wifi") return simulatorStatusBar("wifi");
    return simulatorStatusBar("cellular");
  }
  if (hardware === "unproven") {
    return {
      capability: input.capability,
      status: "unsupported",
      primitive: "none",
      reason: `unproven iOS hardware cannot claim ${input.capability}`,
    };
  }
  if (input.capability === "lock-screen") return PHYSICAL_LOCK;
  if (input.capability === "airplane") return PHYSICAL_AIRPLANE;
  if (input.capability === "cellular") return PHYSICAL_CELLULAR;
  return PHYSICAL_WIFI;
}

export function iosDeviceEffectMatrix(input: {
  hardware: IosHardwareClass;
  serial?: string;
}): DeviceEffectSupport[] {
  return DEVICE_EFFECT_CAPABILITIES.map((capability) =>
    iosDeviceEffectSupport({ ...input, capability }),
  );
}

/** S16 on this iPad: 60s + stateful-survival is necessary and still not sufficient
 * without a supported physical primitive. Simulator status-bar is not coverage. */
export function canCoverPhysicalIpadSurvival(input: {
  hardware: IosHardwareClass;
  serial?: string;
  capability: DeviceEffectCapability;
  executionQueue?: ExecutionQueue;
  declaredDwellMs?: number;
}): { ok: true } | { ok: false; reason: string } {
  const dwell = canCoverWorkbookFamily({
    family: SURVIVAL_FAMILY_ID,
    executionQueue: input.executionQueue,
    declaredDwellMs: input.declaredDwellMs,
  });
  if (!dwell.ok) return dwell;
  const hardware = resolvedIosHardware(input);
  if (!iosHardwareCovers(hardware, "physical-ipad")) {
    return {
      ok: false,
      reason: `${iosHardwareLabel(hardware)} ${input.capability} is not physical iPad ${SURVIVAL_FAMILY_ID} coverage`,
    };
  }
  const support = iosDeviceEffectSupport({ ...input, hardware });
  if (support.status !== "supported") {
    return { ok: false, reason: support.reason };
  }
  return { ok: true };
}

function survivalEffectClaim(input: {
  family?: string;
  executionQueue?: ExecutionQueue;
  declaredDwellMs?: number;
}): boolean {
  if (input.family === SURVIVAL_FAMILY_ID) return true;
  if (input.executionQueue === "stateful-survival") return true;
  return (input.declaredDwellMs ?? 0) >= SURVIVAL_REQUIRED_DWELL_MS;
}

function gateForDeviceEffect(input: {
  support: DeviceEffectSupport;
  claimed: IosHardwareClass;
  family?: string;
  executionQueue?: ExecutionQueue;
  declaredDwellMs?: number;
}): CapabilityGate | undefined {
  if (input.support.status === "human-only") {
    return { kind: "human-only", reason: input.support.reason };
  }
  if (input.support.status === "unsupported") {
    return { kind: "unsupported", reason: input.support.reason };
  }
  if (input.support.status !== "simulator-only") return undefined;
  if (input.claimed === "physical-ipad" || input.claimed === "physical-iphone") {
    return { kind: "nonapplicable", reason: input.support.reason };
  }
  if (survivalEffectClaim(input)) {
    return { kind: "nonapplicable", reason: input.support.reason };
  }
  return undefined;
}

const ANDROID_APP = /^(android|com\.(x|twitter)\.android)/iu;
const IOS_APP = /^(ios|ai\.x\.GrokApp)$/u;
const IMAGINE = /\bimagine\b/iu;

export function captureReviewSlotPlatform(input: {
  configuration?: CaptureReviewConfiguration;
  platform?: "android" | "ios" | "browser";
  device?: string;
}): "android" | "ios" | "browser" | undefined {
  if (input.platform === "android" || input.platform === "ios" || input.platform === "browser") {
    return input.platform;
  }
  if (input.configuration?.browser?.trim()) return "browser";
  const app = input.configuration?.app?.trim() ?? "";
  if (ANDROID_APP.test(app)) return "android";
  if (IOS_APP.test(app)) return "ios";
  if (input.device === "android" || input.device === "ios" || input.device === "browser") {
    return input.device;
  }
  return undefined;
}

export function captureReviewScenarioKind(input: {
  platform?: "android" | "ios" | "browser";
  approximation?: "simulator" | "emulator" | "browser";
  configuration?: CaptureReviewConfiguration;
  observed?: CaptureReviewObservedSession;
  kind?: string;
}): CaptureReviewScenarioKind {
  if (input.approximation === "simulator") return "simulator-approximation";
  if (input.approximation === "emulator") return "emulator-approximation";
  if (input.approximation === "browser") return "browser-approximation";
  if (input.configuration?.browser?.trim() || input.platform === "browser") {
    return "browser-approximation";
  }
  if (
    input.observed?.sessionStore === "playwright-user-data" ||
    input.observed?.sessionStore === "electron-partition"
  ) {
    return "browser-approximation";
  }
  if (/simulator/iu.test(input.kind ?? "")) return "simulator-approximation";
  if (/emulator/iu.test(input.kind ?? "")) return "emulator-approximation";
  return "physical";
}

/** grok-lab / Electron persist:lane:grok-lab is a browser session, never physical Imagine. */
export function physicalImagineClaim(input: {
  caption?: string;
  checkpointId?: string;
  platform?: "android" | "ios" | "browser";
  configuration?: CaptureReviewConfiguration;
  observed?: CaptureReviewObservedSession;
  approximation?: "simulator" | "emulator" | "browser";
  kind?: string;
}): {
  physical: boolean;
  scenarioKind: CaptureReviewScenarioKind;
  reason: string;
} {
  const imagine = IMAGINE.test(`${input.caption ?? ""} ${input.checkpointId ?? ""}`);
  const lane = input.observed?.laneId?.trim() ?? "";
  const grokLab = lane === "grok-lab" || lane.startsWith("persist:lane:grok-lab");
  const scenarioKind = grokLab ? "browser-approximation" : captureReviewScenarioKind(input);
  if (!imagine) {
    return {
      physical: scenarioKind === "physical",
      scenarioKind,
      reason: "not Imagine",
    };
  }
  if (scenarioKind !== "physical") {
    return {
      physical: false,
      scenarioKind,
      reason: `${scenarioKind.replaceAll("-", " ")} is not iOS/Android physical Imagine`,
    };
  }
  const platform = captureReviewSlotPlatform(input);
  if (platform === "ios") {
    return { physical: true, scenarioKind: "physical", reason: "physical iOS Imagine" };
  }
  if (platform === "android") {
    return { physical: true, scenarioKind: "physical", reason: "physical Android Imagine" };
  }
  return {
    physical: false,
    scenarioKind: "browser-approximation",
    reason: "Browser Imagine is not iOS/Android physical Imagine",
  };
}

function slotLabel(slot: CaptureReviewPlannedSlot): string {
  return `${slot.caption} ${slot.checkpointId} ${slot.lookFor ?? ""} ${slot.requirementId ?? ""}`;
}

export function capabilityGateForSlot(input: {
  slot: CaptureReviewPlannedSlot;
  inventory: CapabilityInventory;
  platform?: "android" | "ios" | "browser";
  device?: string;
  observed?: CaptureReviewObservedSession;
  approximation?: "simulator" | "emulator" | "browser";
  executionQueue?: ExecutionQueue;
  declaredDwellMs?: number;
  kind?: string;
  serial?: string;
  family?: string;
  deviceEffects?: readonly DeviceEffectCapability[];
  recipeSteps?: readonly unknown[];
}): CapabilityGate | undefined {
  const platform = captureReviewSlotPlatform({
    configuration: input.slot.configuration,
    platform: input.platform,
    device: input.device,
  });
  const label = slotLabel(input.slot);
  const imagine = IMAGINE.test(label);
  const claimedClass = classifyIosHardware({
    device: input.device,
    serial: input.serial,
    approximation: input.approximation,
    kind: input.kind,
  });

  if (platform === "android" && input.inventory.adbDeviceCount === 0) {
    return {
      kind: "unsupported",
      reason: "adb is empty — Android combinations stay blocked in the denominator, not omitted",
    };
  }

  if (imagine && platform === "ios" && input.inventory.iosImagineTabPresent === false) {
    return {
      kind: "not-yet-recorded",
      reason: "iOS Imagine Unbound — navigation.tab.imagine absent. Do not invent the tab.",
    };
  }

  if (platform === "ios") {
    for (const capability of claimedDeviceEffects({
      checkpointId: input.slot.checkpointId,
      deviceEffects: input.deviceEffects,
      recipeSteps: input.recipeSteps,
    })) {
      const support = iosDeviceEffectSupport({
        hardware: claimedClass,
        serial: input.serial ?? input.device,
        capability,
      });
      const gate = gateForDeviceEffect({
        support,
        claimed: claimedClass,
        family: input.family,
        executionQueue: input.executionQueue,
        declaredDwellMs: input.declaredDwellMs,
      });
      if (gate) return gate;
    }

    const observedClass = input.observed?.iosHardwareClass;
    if (
      observedClass &&
      claimedClass !== "unproven" &&
      !iosHardwareCovers(observedClass, claimedClass)
    ) {
      return {
        kind: "nonapplicable",
        reason: `${iosHardwareLabel(observedClass)} dest-end is not ${iosHardwareLabel(claimedClass)} coverage`,
      };
    }
  }

  if (input.executionQueue !== undefined || input.declaredDwellMs !== undefined) {
    const survival = canCoverWorkbookFamily({
      executionQueue: input.executionQueue,
      declaredDwellMs: input.declaredDwellMs,
      family: SURVIVAL_FAMILY_ID,
    });
    if (!survival.ok) {
      return { kind: "nonapplicable", reason: survival.reason };
    }
  }

  return undefined;
}

/**
 * Keep every run. Empty adb marks Android cells blocked; it never drops them
 * from the planned set.
 */
export function capabilityGateForRun(
  run: PlanCaptureReviewCapabilityRun,
  inventory: CapabilityInventory,
): CapabilityGate | undefined {
  const platform = captureReviewSlotPlatform({
    platform: run.platform,
    device: run.device,
    configuration: run.plannedSlots?.[0]?.configuration,
  });
  if (platform === "android" && inventory.adbDeviceCount === 0) {
    return {
      kind: "unsupported",
      reason: "adb is empty — Android combinations stay blocked in the denominator, not omitted",
    };
  }
  const slots = run.plannedSlots ?? [];
  for (const slot of slots) {
    const gate = capabilityGateForSlot({
      slot,
      inventory,
      platform: run.platform,
      device: run.device,
      observed: run.observed,
      approximation: run.approximation,
      executionQueue: run.executionQueue,
      declaredDwellMs: run.declaredDwellMs,
      kind: run.kind,
      serial: run.serial,
      family: run.family,
      deviceEffects: run.deviceEffects,
      recipeSteps: run.recipeSteps,
    });
    if (gate) return gate;
  }
  return undefined;
}

export function gatePlanCaptureReviewRuns(
  runs: readonly PlanCaptureReviewCapabilityRun[],
  inventory: CapabilityInventory,
): PlanCaptureReviewCapabilityRun[] {
  return runs.map((run) => {
    const gate = capabilityGateForRun(run, inventory);
    if (!gate) return run;
    return { ...run, blocked: true };
  });
}

export function resolveGatedPlanCaptureReviewQueue(
  runs: readonly PlanCaptureReviewCapabilityRun[],
  inventory: CapabilityInventory,
): PlanCaptureReviewQueue {
  const gated = gatePlanCaptureReviewRuns(runs, inventory);
  const queue = resolvePlanCaptureReviewQueue(gated);
  return {
    ...queue,
    items: queue.items.map((item) => {
      const run = gated.find((candidate) => candidate.runId === item.runId);
      const claim = physicalImagineClaim({
        caption: item.caption,
        checkpointId: item.checkpointId,
        platform: run?.platform,
        configuration: item.configuration,
        observed: item.observed ?? run?.observed,
        approximation: run?.approximation,
      });
      return {
        ...item,
        scenarioKind: claim.scenarioKind,
        ...(item.observed || !run?.observed ? {} : { observed: run.observed }),
      };
    }),
  };
}

export type WorkbookCompileAttempt = {
  testId: string;
  errorCode: string;
};

/**
 * Compile unresolved-step / Unbound never deletes the original from the
 * remaining-before-gates denominator and never counts as coverage.
 */
export function workbookCoverageAfterCompileAttempts(
  manifest: WorkbookCoverageManifest,
  catalog: readonly WorkbookCatalogTest[] = [],
  attempts: readonly WorkbookCompileAttempt[] = [],
): WorkbookCoverageReport {
  void attempts;
  return evaluateWorkbookCoverage(manifest, catalog);
}
