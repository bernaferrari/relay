import type { Lane, LaneSaveInput } from "@relay/protocol";
import { saveLane } from "./lane.js";

/** Unsigned grok.com daily pack. Credentials are not stored on the Lane. */
export const GROK_DAILY_LANE = {
  id: "grok-daily",
  appMapId: "grok-web",
  target: { kind: "browser", browserTargetId: "grok-com" },
  targetProfileId: "browser:grok-com",
  actorId: "human:local-cli",
} as const satisfies LaneSaveInput;

/** Second unsigned grok.com Lane. Same saved evidence profile as grok-daily;
 * a distinct scheduler/session identity so unsigned work can overlap. Never
 * binds grok-lab or writes grok-com authenticationFixtureId. */
export const GROK_DAILY_B_LANE = {
  id: "grok-daily-b",
  appMapId: "grok-web",
  target: { kind: "browser", browserTargetId: "grok-com" },
  targetProfileId: "browser:grok-com",
  actorId: "human:local-cli",
} as const satisfies LaneSaveInput;

/** Unique-profile lab overlay. Fixture ids only — passwords stay in the fixture. */
export const GROK_LAB_LANE = {
  id: "grok-lab",
  appMapId: "grok-web",
  target: { kind: "browser", browserTargetId: "grok-com" },
  targetProfileId: "browser:grok-com-1280x800-339a5a430a41",
  engine: "chromium",
  account: {
    kind: "fixture",
    accountId: "7189423f-193e-45ed-b674-154505cc5107",
    accountRevision: "1",
    reference: "authfx:7189423f-193e-45ed-b674-154505cc5107:1",
  },
  actorId: "human:hourly-heavy",
} as const satisfies LaneSaveInput;

/** Write the grok-daily, grok-daily-b, and grok-lab Lane records for the project. */
export async function seedGrokLanes(projectId: string): Promise<Lane[]> {
  return [
    await saveLane({ projectId, ...GROK_DAILY_LANE }),
    await saveLane({ projectId, ...GROK_DAILY_B_LANE }),
    await saveLane({ projectId, ...GROK_LAB_LANE }),
  ];
}
