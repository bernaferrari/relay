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

export const ACTION_IDS = [
  "update-last-alpha",
  "install-last-alpha",
  "reinstall-last-alpha",
  "update-last-prod",
  "install-last-prod",
  "login-google",
  "login-email",
  "login-x",
  "logout",
] as const;

export type ActionId = (typeof ACTION_IDS)[number];

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
};

export const ACTIONS: readonly ActionMeta[] = [
  {
    id: "update-last-alpha",
    title: "Update last alpha",
    description: "Any account → teachx → Update only (or already-latest) → restore gmail",
    category: "play-store",
    isAlpha: true,
  },
  {
    id: "install-last-alpha",
    title: "Install last alpha",
    description: "Any account → teachx → Update or first Install → restore gmail",
    category: "play-store",
    isAlpha: true,
  },
  {
    id: "reinstall-last-alpha",
    title: "Reinstall last alpha",
    description: "Any account → teachx → Uninstall → Install → restore gmail",
    category: "play-store",
    isAlpha: true,
  },
  {
    id: "update-last-prod",
    title: "Update last prod",
    description: "Any account → PROD_ACCOUNT_MATCH → Update only (no reinstall)",
    category: "play-store",
    requiresProdMatch: true,
  },
  {
    id: "install-last-prod",
    title: "Install last prod",
    description: "Any account → PROD_ACCOUNT_MATCH → Uninstall → Install",
    category: "play-store",
    requiresProdMatch: true,
  },
  {
    id: "login-google",
    title: "Login with Google",
    description: "Continue with Google → notifications Allow",
    category: "grok",
  },
  {
    id: "login-email",
    title: "Login with Email",
    description: "Continue with Email → notifications Allow",
    category: "grok",
  },
  {
    id: "login-x",
    title: "Login with X",
    description: "Continue with X → notifications Allow",
    category: "grok",
  },
  {
    id: "logout",
    title: "Logout",
    description: "Menu → Settings → Sign out",
    category: "grok",
  },
] as const;

export function getAction(id: string): ActionMeta | undefined {
  return ACTIONS.find((a) => a.id === id);
}

export function isActionId(id: string): id is ActionId {
  return (ACTION_IDS as readonly string[]).includes(id);
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
  const flow: AccountFlowOptions = {
    skipAccountSwitch: opts.skipAccountSwitch,
    skipRestoreHome: opts.skipRestoreHome,
  };

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
