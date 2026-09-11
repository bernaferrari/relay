/**
 * Named action catalog (OpenCode-style command IDs).
 * CLI / TUI / desktop all resolve actions from this list.
 */
import type { Device } from "./device.js";
import {
  installLastAlpha,
  installLastProd,
  reinstallLastAlpha,
  updateLastAlpha,
  updateLastProd,
  type AccountFlowOptions,
  type GrokListingAction,
} from "./play-store.js";
import { loginEmail, loginGoogle, loginX, logout } from "./grok.js";
import { planForAction } from "./trace.js";

import { type ActionId } from "./action-ids.js";
export { ACTION_IDS, isActionId, type ActionId } from "./action-ids.js";

export type ActionCategory = "play-store" | "grok";

export type ActionMeta = {
  id: ActionId;
  title: string;
  description: string;
  category: ActionCategory;
  /** Needs PROD_ACCOUNT_MATCH */
  requiresProdMatch?: boolean;
  /** Alpha flow with restore-home options */
  isAlpha?: boolean;
  /** default trace glyphs (from RECIPE_TRACE_PLANS) */
  glyphs?: string[];
  /** planned trace steps (from RECIPE_TRACE_PLANS) for pre-run preview */
  planned?: { title: string; glyphs: string[] }[];
};

export const ACTIONS: readonly ActionMeta[] = [
  {
    id: "update-last-alpha",
    title: "Update last alpha",
    description:
      "Switches to the teachx account, updates Grok from the Play Store, restores your account.",
    category: "play-store",
    isAlpha: true,
  },
  {
    id: "install-last-alpha",
    title: "Install last alpha",
    description: "Switches to the teachx account, updates or installs Grok, restores your account.",
    category: "play-store",
    isAlpha: true,
  },
  {
    id: "reinstall-last-alpha",
    title: "Reinstall last alpha",
    description:
      "Switches to the teachx account, reinstalls Grok from scratch, restores your account.",
    category: "play-store",
    isAlpha: true,
  },
  {
    id: "update-last-prod",
    title: "Update last prod",
    description: "Switches to the prod account and updates Grok — no reinstall.",
    category: "play-store",
    requiresProdMatch: true,
  },
  {
    id: "install-last-prod",
    title: "Install last prod",
    description: "Switches to the prod account and reinstalls Grok from scratch.",
    category: "play-store",
    requiresProdMatch: true,
  },
  {
    id: "login-google",
    title: "Login with Google",
    description: "Opens Grok and signs in with the device's Google account.",
    category: "grok",
  },
  {
    id: "login-email",
    title: "Login with Email",
    description: "Opens Grok and signs in with email.",
    category: "grok",
  },
  {
    id: "login-x",
    title: "Login with X",
    description: "Opens Grok and signs in with X.",
    category: "grok",
  },
  {
    id: "logout",
    title: "Logout",
    description: "Opens settings and signs out of Grok.",
    category: "grok",
  },
] as const;

export function getAction(id: string): ActionMeta | undefined {
  return ACTIONS.find((a) => a.id === id);
}

export type RunActionOptions = AccountFlowOptions & {
  onLog?: (line: string) => void;
};

export type RunActionResult =
  | { ok: true; action: ActionId; result?: GrokListingAction | string }
  | { ok: false; action: ActionId; error: string };

export async function runAction(
  device: Device,
  action: ActionId,
  opts: RunActionOptions = {},
): Promise<RunActionResult> {
  const log = opts.onLog ?? ((line: string) => console.log(line));
  const flow: AccountFlowOptions = opts.prodAccountMatch
    ? { prodAccountMatch: opts.prodAccountMatch }
    : {};

  try {
    log(`==> ${action}`);
    switch (action) {
      case "update-last-alpha": {
        const result = await updateLastAlpha(device, flow);
        log(`==> DONE: ${action} — ${result}`);
        return { ok: true, action, result };
      }
      case "install-last-alpha": {
        const result = await installLastAlpha(device, flow);
        log(`==> DONE: ${action} — ${result}`);
        return { ok: true, action, result };
      }
      case "reinstall-last-alpha":
        await reinstallLastAlpha(device, flow);
        break;
      case "update-last-prod": {
        const result = await updateLastProd(device, flow);
        log(`==> DONE: ${action} — ${result}`);
        return { ok: true, action, result };
      }
      case "install-last-prod":
        await installLastProd(device, flow);
        break;
      case "login-google":
        await loginGoogle(device);
        break;
      case "login-email":
        await loginEmail(device);
        break;
      case "login-x":
        await loginX(device);
        break;
      case "logout":
        await logout(device);
        break;
    }
    log(`==> DONE: ${action}`);
    return { ok: true, action, result: "ok" };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log(`==> FAIL: ${action} — ${error}`);
    return { ok: false, action, error };
  }
}

/** ACTIONS with default trace glyphs + planned steps attached. */
export function listActionsWithTrace(): ActionMeta[] {
  return ACTIONS.map((a) => {
    const plan = planForAction(a.id);
    return { ...a, glyphs: plan.glyphs, planned: plan.planned };
  });
}
