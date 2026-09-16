/**
 * RC-23 screenshot-first freeze: ten dest-end checkpoints × web/android/ios
 * × attempt 1 = 30 planned slots. The mixed 13-cell inventory is history; it
 * cannot shrink this denominator. Requirement ids are not workbook GQA
 * originals. Dest-end view packets bind GQA-004 and GQA-040 only; similar
 * names do not cover the other 51. grok-ios-daily 12/12 does not fill these
 * slots.
 */

import {
  captureReviewSlotId,
  type CaptureReviewConfiguration,
  type CaptureReviewPlannedSlot,
} from "./capture-review.js";
import {
  resolveGatedPlanCaptureReviewQueue,
  type CapabilityInventory,
  type PlanCaptureReviewCapabilityRun,
} from "./capability-gate.js";
import {
  selectedPlanCaptureReviewItems,
  type PlanCaptureReviewQueue,
  type PlanCaptureReviewRunInput,
} from "./capture-review-plan.js";

export const RC23_SCREENSHOT_FIRST_REQUIREMENT_ID = "rc23-screenshot-first";

export const RC23_SCREENSHOT_FIRST_CHECKPOINT_IDS = [
  "home-chrome",
  "dictation",
  "sidebar",
  "attach",
  "settings",
  "imagine",
  "logo",
  "composer-focus",
  "models",
  "private-chat",
] as const;

export type Rc23ScreenshotFirstCheckpointId = (typeof RC23_SCREENSHOT_FIRST_CHECKPOINT_IDS)[number];

export const RC23_SCREENSHOT_FIRST_PLATFORMS = ["web", "android", "ios"] as const;

export type Rc23ScreenshotFirstPlatform = (typeof RC23_SCREENSHOT_FIRST_PLATFORMS)[number];

export const RC23_SCREENSHOT_FIRST_PLATFORM_CONFIGURATION = {
  web: { browser: "grok-com" },
  android: { app: "android" },
  ios: { app: "ai.x.GrokApp" },
} as const satisfies Record<Rc23ScreenshotFirstPlatform, CaptureReviewConfiguration>;

const CAPTIONS: Record<Rc23ScreenshotFirstCheckpointId, string> = {
  "home-chrome": "Home chrome",
  dictation: "Dictation",
  sidebar: "Sidebar",
  attach: "Attach",
  settings: "Settings",
  imagine: "Imagine",
  logo: "Logo",
  "composer-focus": "Composer focus",
  models: "Models",
  "private-chat": "Private chat",
};

/** Dest-end (or inspect) Tests that exist. */
export const RC23_SCREENSHOT_FIRST_TESTS: Record<
  Rc23ScreenshotFirstCheckpointId,
  Record<Rc23ScreenshotFirstPlatform, string | null>
> = {
  "home-chrome": {
    web: "test-grok-web-signed-in-home",
    android: "test-grok-android-home-chrome",
    ios: "test-grok-ios-home-chrome",
  },
  dictation: {
    web: "test-grok-web-signed-in-dictation-inspect",
    android: "test-grok-android-dictation",
    ios: "test-grok-ios-dictation",
  },
  sidebar: {
    web: "test-grok-web-signed-in-sidebar",
    android: "test-grok-android-sidebar",
    ios: "test-grok-ios-sidebar",
  },
  attach: {
    web: "test-grok-web-signed-in-attach",
    android: "test-grok-android-attach",
    ios: "test-grok-ios-attach",
  },
  settings: {
    web: "test-grok-web-signed-in-settings",
    android: "test-grok-android-settings",
    ios: "test-grok-ios-settings",
  },
  imagine: {
    web: "test-grok-web-signed-in-imagine",
    android: "test-grok-android-imagine",
    ios: "test-grok-ios-imagine",
  },
  logo: {
    web: "test-grok-web-signed-in-logo",
    android: "test-grok-android-logo",
    ios: "test-grok-ios-logo",
  },
  "composer-focus": {
    web: "test-grok-web-signed-in-composer-focus",
    android: "test-grok-android-composer-focus",
    ios: "test-grok-ios-composer-focus",
  },
  models: {
    web: "test-grok-web-signed-in-model-iterate",
    android: "test-grok-android-models",
    ios: "test-grok-ios-models",
  },
  "private-chat": {
    web: "test-grok-web-signed-in-private-chat",
    android: "test-grok-android-private-chat",
    ios: "test-grok-ios-private-chat",
  },
};

export type Rc23ScreenshotFirstCapture = {
  checkpointId: Rc23ScreenshotFirstCheckpointId;
  platform: Rc23ScreenshotFirstPlatform;
  jobId: string;
};

/**
 * Screenshot-first pending capture-review jobs that fill a frozen slot.
 * Unsigned grok-daily Home/Settings are the same web slots as grok-lab —
 * they do not add a fourth configuration. grok-ios-daily is not this freeze.
 */
export const RC23_SCREENSHOT_FIRST_CAPTURED_PENDING: readonly Rc23ScreenshotFirstCapture[] = [
  {
    checkpointId: "home-chrome",
    platform: "web",
    jobId: "a0b6380d-6bc9-4bf7-878c-714e6ddf7815",
  },
  {
    checkpointId: "attach",
    platform: "web",
    jobId: "a11c41b4-c699-4c88-b551-eedf739bb1ea",
  },
  {
    checkpointId: "imagine",
    platform: "web",
    jobId: "37014ba6-ae10-4e2a-b395-cc4cce72a6dc",
  },
  {
    checkpointId: "settings",
    platform: "web",
    jobId: "3787eb65-1523-4525-beb0-c310c28eaa10",
  },
  {
    checkpointId: "dictation",
    platform: "web",
    jobId: "b1eead7a-775e-4569-bb30-d9d63fe94071",
  },
  {
    checkpointId: "sidebar",
    platform: "web",
    jobId: "b7c18573-1cc2-4fb5-92fe-2ec35aa86885",
  },
  {
    checkpointId: "logo",
    platform: "web",
    jobId: "d8bf4385-97b1-4aee-9116-86cacc44b46e",
  },
  {
    checkpointId: "composer-focus",
    platform: "web",
    jobId: "ded7d047-82a0-4d69-b80c-03cf781cab60",
  },
  {
    checkpointId: "models",
    platform: "web",
    jobId: "f5116f81-87d6-448e-9d7d-2c545a649218",
  },
  {
    checkpointId: "private-chat",
    platform: "web",
    jobId: "2b2377c7-9e77-49a0-9aa1-e41299ec1831",
  },
  {
    checkpointId: "home-chrome",
    platform: "ios",
    jobId: "3754526f-bcf2-4818-838e-0adcb8596a0e",
  },
  {
    checkpointId: "dictation",
    platform: "ios",
    jobId: "ea3bfb8e-005a-4442-b78a-49b40c11ba23",
  },
  {
    checkpointId: "sidebar",
    platform: "ios",
    jobId: "345c2e67-8b32-49f3-9d9a-1876809d313d",
  },
  {
    checkpointId: "logo",
    platform: "ios",
    jobId: "eb3512fd-48d5-415e-8cdc-d5a0ffedc77d",
  },
  {
    checkpointId: "composer-focus",
    platform: "ios",
    jobId: "2e31db46-e93a-4b86-ab77-1f71917b110d",
  },
  {
    checkpointId: "attach",
    platform: "ios",
    jobId: "679b39b7-fb38-41de-a5b9-661504f0eeb0",
  },
  {
    checkpointId: "models",
    platform: "ios",
    jobId: "3cd34331-eacc-4f36-8a9d-6df00122a10d",
  },
  {
    checkpointId: "private-chat",
    platform: "ios",
    jobId: "dd229b0b-918e-42eb-9e62-fab1851a1d8d",
  },
  {
    checkpointId: "settings",
    platform: "ios",
    jobId: "ec09b7ba-fe83-4fa4-b076-121bc713a99a",
  },
  {
    checkpointId: "home-chrome",
    platform: "android",
    jobId: "ec54c62a-1de6-43ca-875a-0595c152b177",
  },
  {
    checkpointId: "sidebar",
    platform: "android",
    jobId: "de163986-c621-4fca-bb6a-bf1811f61ffe",
  },
  {
    checkpointId: "imagine",
    platform: "android",
    jobId: "001be26c-3440-443f-ac03-06545a320999",
  },
  {
    checkpointId: "logo",
    platform: "android",
    jobId: "1d9acbd6-214f-4544-b790-b1062db8f721",
  },
  {
    checkpointId: "dictation",
    platform: "android",
    jobId: "81b51428-9d40-401a-bffd-46121e962948",
  },
  {
    checkpointId: "composer-focus",
    platform: "android",
    jobId: "78a0127a-f0b0-45e0-b1b8-634489b62b39",
  },
  {
    checkpointId: "attach",
    platform: "android",
    jobId: "6529ee13-5d48-4db7-84da-d93783e74b47",
  },
  {
    checkpointId: "models",
    platform: "android",
    jobId: "5310092a-e5cf-4cd0-9e55-3a98e91bd9a2",
  },
  {
    checkpointId: "private-chat",
    platform: "android",
    jobId: "5e78db0d-1959-4cc1-b8ce-96848f371ce4",
  },
  {
    checkpointId: "settings",
    platform: "android",
    jobId: "6290fd6f-7ae0-4490-b45f-a8f7cb394830",
  },
];

export type Rc23ScreenshotFirstSlot = CaptureReviewPlannedSlot & {
  checkpointId: Rc23ScreenshotFirstCheckpointId;
  platform: Rc23ScreenshotFirstPlatform;
};

export function rc23ScreenshotFirstPlatform(
  configuration?: CaptureReviewConfiguration,
): Rc23ScreenshotFirstPlatform | undefined {
  if (configuration?.browser === "grok-com") return "web";
  if (configuration?.app === "android") return "android";
  if (configuration?.app === "ai.x.GrokApp") return "ios";
  return undefined;
}

export function materializeRc23ScreenshotFirstSlots(): Rc23ScreenshotFirstSlot[] {
  const slots: Rc23ScreenshotFirstSlot[] = [];
  for (const checkpointId of RC23_SCREENSHOT_FIRST_CHECKPOINT_IDS) {
    for (const platform of RC23_SCREENSHOT_FIRST_PLATFORMS) {
      const configuration = RC23_SCREENSHOT_FIRST_PLATFORM_CONFIGURATION[platform];
      slots.push({
        requirementId: RC23_SCREENSHOT_FIRST_REQUIREMENT_ID,
        checkpointId,
        caption: CAPTIONS[checkpointId],
        attempt: 1,
        configuration,
        platform,
      });
    }
  }
  return slots;
}

function runPlatform(platform: Rc23ScreenshotFirstPlatform): "browser" | "android" | "ios" {
  return platform === "web" ? "browser" : platform;
}

/**
 * Product persist mapping: Unbound iOS Imagine is a blocked Run, not a
 * missing caption and not a capability-gate-only in-memory row. Capture-review
 * GET/export after restart must keep this slot in the planned denominator.
 */
export function rc23ScreenshotFirstProductPlanRuns(input?: {
  captured?: readonly Rc23ScreenshotFirstCapture[];
}): PlanCaptureReviewRunInput[] {
  return rc23ScreenshotFirstRuns(input).map((run) => {
    const captured = Boolean(run.artifacts?.length);
    return {
      runId: run.runId,
      plannedSlots: run.plannedSlots,
      artifacts: [
        {
          kind: "app-map-test-execution-intent",
          data: { plan: { plannedSlots: run.plannedSlots } },
        },
        ...(run.artifacts ?? []),
      ],
      ...(!captured ? { blocked: true } : {}),
    };
  });
}

export function rc23ScreenshotFirstRuns(input?: {
  captured?: readonly Rc23ScreenshotFirstCapture[];
}): PlanCaptureReviewCapabilityRun[] {
  const captured = input?.captured ?? RC23_SCREENSHOT_FIRST_CAPTURED_PENDING;
  return materializeRc23ScreenshotFirstSlots().map((slot) => {
    const slotId = captureReviewSlotId(slot);
    const hit = captured.find(
      (item) => item.checkpointId === slot.checkpointId && item.platform === slot.platform,
    );
    const web = slot.platform === "web";
    return {
      runId: slotId,
      platform: runPlatform(slot.platform),
      plannedSlots: [slot],
      ...(web ? { approximation: "browser" as const } : {}),
      ...(web
        ? { observed: { laneId: "grok-lab", sessionStore: "playwright-user-data" as const } }
        : {}),
      ...(hit
        ? {
            artifacts: [
              {
                kind: "capture-review",
                data: {
                  caption: slot.caption,
                  framePath: `frames/${slot.checkpointId}-${slot.platform}.png`,
                  imageSha256: hit.jobId,
                  checkpointId: slot.checkpointId,
                  slotId,
                  attempt: 1,
                  requirementId: slot.requirementId,
                  configuration: slot.configuration,
                  ...(web
                    ? {
                        observed: {
                          laneId: "grok-lab",
                          sessionStore: "playwright-user-data",
                        },
                      }
                    : {}),
                },
              },
            ],
          }
        : {}),
    };
  });
}

export type Rc23ScreenshotFirstCounts = {
  planned: number;
  captured: number;
  blocked: number;
  missing: number;
  pending: number;
  accepted: number;
};

/** Partition: blocked is not also missing. captured + blocked + missing = planned. */
export function partitionRc23ScreenshotFirst(
  queue: PlanCaptureReviewQueue,
): Rc23ScreenshotFirstCounts {
  const blocked = queue.items.filter((item) => item.blocked).length;
  const captured = queue.items.filter((item) => item.status !== "missing").length;
  const missing = queue.items.filter((item) => item.status === "missing" && !item.blocked).length;
  return {
    planned: queue.items.length,
    captured,
    blocked,
    missing,
    pending: queue.summary.pending,
    accepted: queue.summary.accepted,
  };
}

export function resolveRc23ScreenshotFirstQueue(input?: {
  captured?: readonly Rc23ScreenshotFirstCapture[];
  inventory?: CapabilityInventory;
}): PlanCaptureReviewQueue {
  return resolveGatedPlanCaptureReviewQueue(
    rc23ScreenshotFirstRuns({ captured: input?.captured }),
    input?.inventory ?? { adbDeviceCount: 1, iosImagineTabPresent: false },
  );
}

/** Looks correct cannot accept a missing slot, including iOS Imagine Unbound. */
export function rc23LooksCorrectCannotAcceptMissing(queue: PlanCaptureReviewQueue): {
  selected: number;
  missingAttempted: number;
} {
  const missing = queue.items.filter((item) => item.status === "missing");
  const selected = selectedPlanCaptureReviewItems(
    queue,
    missing.map((item) => ({ runId: item.runId, captureId: item.captureId })),
  );
  return { selected: selected.length, missingAttempted: missing.length };
}
