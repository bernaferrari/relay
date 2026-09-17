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

export type PlanCaptureReviewCapabilityRun = PlanCaptureReviewRunInput & {
  platform?: "android" | "ios" | "browser";
  approximation?: "simulator" | "emulator" | "browser";
  observed?: CaptureReviewObservedSession;
  executionQueue?: ExecutionQueue;
  declaredDwellMs?: number;
  kind?: string;
};

export const IOS_HARDWARE_CLASSES = [
  "physical-ipad",
  "physical-iphone",
  "simulator",
  "unproven",
] as const;
export type IosHardwareClass = (typeof IOS_HARDWARE_CLASSES)[number];

export function classifyIosHardware(input: {
  kind?: string;
  name?: string;
  device?: string;
  approximation?: "simulator" | "emulator" | "browser";
}): IosHardwareClass {
  if (input.approximation === "simulator") return "simulator";
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

const ANDROID_APP = /^(android|com\.(x|twitter)\.android)/iu;
const IOS_APP = /^(ios|ai\.x\.GrokApp)$/u;
const IMAGINE = /\bimagine\b/iu;
const HUMAN_ONLY = /\b(lock|unlock|airplane|cellular|wifi|wi-?fi)\b/iu;

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
}): CapabilityGate | undefined {
  const platform = captureReviewSlotPlatform({
    configuration: input.slot.configuration,
    platform: input.platform,
    device: input.device,
  });
  const label = slotLabel(input.slot);
  const imagine = IMAGINE.test(label);
  const scenario = captureReviewScenarioKind({
    platform,
    approximation: input.approximation,
    configuration: input.slot.configuration,
    observed: input.observed,
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

  if (HUMAN_ONLY.test(label) && scenario === "physical") {
    return {
      kind: "human-only",
      reason: "Physical lock/airplane/cellular remain UNRECORDED / human, not a 10s fake",
    };
  }

  if (platform === "ios") {
    const observedClass = input.observed?.iosHardwareClass;
    const claimedClass = classifyIosHardware({
      device: input.device,
      approximation: input.approximation,
      kind: input.kind,
    });
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
