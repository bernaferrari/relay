import type { Lane, LaneSaveInput } from "@relay/protocol";
import { saveLane } from "./lane.js";

const UNSIGNED_GROK_COM = {
  appMapId: "grok-web",
  target: { kind: "browser", browserTargetId: "grok-com" },
  targetProfileId: "browser:grok-com",
  actorId: "human:local-cli",
} as const;

/** Unsigned grok.com daily pack. Credentials are not stored on the Lane. */
export const GROK_DAILY_LANE = {
  id: "grok-daily",
  ...UNSIGNED_GROK_COM,
} as const satisfies LaneSaveInput;

/** Extra unsigned grok.com Lanes. Same saved evidence profile as grok-daily;
 * distinct scheduler/session identities so unsigned work can overlap. Never
 * bind grok-lab or write grok-com authenticationFixtureId. */
export const GROK_DAILY_B_LANE = {
  id: "grok-daily-b",
  ...UNSIGNED_GROK_COM,
} as const satisfies LaneSaveInput;
export const GROK_DAILY_C_LANE = {
  id: "grok-daily-c",
  ...UNSIGNED_GROK_COM,
} as const satisfies LaneSaveInput;
export const GROK_DAILY_D_LANE = {
  id: "grok-daily-d",
  ...UNSIGNED_GROK_COM,
} as const satisfies LaneSaveInput;
export const GROK_DAILY_E_LANE = {
  id: "grok-daily-e",
  ...UNSIGNED_GROK_COM,
} as const satisfies LaneSaveInput;
export const GROK_DAILY_F_LANE = {
  id: "grok-daily-f",
  ...UNSIGNED_GROK_COM,
} as const satisfies LaneSaveInput;
export const GROK_DAILY_G_LANE = {
  id: "grok-daily-g",
  ...UNSIGNED_GROK_COM,
} as const satisfies LaneSaveInput;
export const GROK_DAILY_H_LANE = {
  id: "grok-daily-h",
  ...UNSIGNED_GROK_COM,
} as const satisfies LaneSaveInput;

/** Isolated Sign-in Lanes. Same saved evidence profile as grok-daily; distinct
 * scheduler keys and headed Chrome user-data. Never bind grok-lab or write
 * grok-com authenticationFixtureId. Gmail/X cookies stay in that Lane's
 * profile until a unique-profile fixture exists. */
export const GROK_AUTH_EMAIL_LANE = {
  id: "grok-auth-email",
  ...UNSIGNED_GROK_COM,
} as const satisfies LaneSaveInput;
export const GROK_AUTH_GMAIL_LANE = {
  id: "grok-auth-gmail",
  ...UNSIGNED_GROK_COM,
} as const satisfies LaneSaveInput;
export const GROK_AUTH_X_LANE = {
  id: "grok-auth-x",
  ...UNSIGNED_GROK_COM,
} as const satisfies LaneSaveInput;
export const GROK_AUTH_X_OUT_LANE = {
  id: "grok-auth-x-out",
  ...UNSIGNED_GROK_COM,
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

const GROK_UNSIGNED_DAILY_LANES = [
  GROK_DAILY_LANE,
  GROK_DAILY_B_LANE,
  GROK_DAILY_C_LANE,
  GROK_DAILY_D_LANE,
  GROK_DAILY_E_LANE,
  GROK_DAILY_F_LANE,
  GROK_DAILY_G_LANE,
  GROK_DAILY_H_LANE,
] as const;

const GROK_AUTH_LANES = [
  GROK_AUTH_EMAIL_LANE,
  GROK_AUTH_GMAIL_LANE,
  GROK_AUTH_X_LANE,
  GROK_AUTH_X_OUT_LANE,
] as const;

/** Write unsigned grok-daily{,-b…-h}, grok-auth-{email,gmail,x,x-out}, grok-lab. */
export async function seedGrokLanes(projectId: string): Promise<Lane[]> {
  const unsigned: Lane[] = [];
  for (const lane of [...GROK_UNSIGNED_DAILY_LANES, ...GROK_AUTH_LANES]) {
    unsigned.push(await saveLane({ projectId, ...lane }));
  }
  return [...unsigned, await saveLane({ projectId, ...GROK_LAB_LANE })];
}
