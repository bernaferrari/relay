/**
 * Parse platform/device controls and observability steps. Keeping this family
 * separate makes the recipe parser's product-flow cases easier to review.
 */
import type { RecipeStep } from "@relay/protocol";
import { MAX_WAIT_MS, isNumber, isString, stepErr } from "./recipe-validation-primitives.js";

export function parseDeviceRecipeStep(
  raw: Record<string, unknown>,
  kind: string,
  index: number,
  note?: string,
): RecipeStep | undefined {
  switch (kind) {
    case "app": {
      const actions = [
        "open",
        "close",
        "switcher",
        "inspect",
        "assert-installed",
        "assert-not-installed",
        "set-locale",
        "install",
        "update",
        "uninstall",
      ] as const;
      if (!actions.includes(raw.action as (typeof actions)[number]))
        throw stepErr(index, "app has an invalid action");
      if (raw.app !== undefined && !isString(raw.app))
        throw stepErr(index, "app.app must be a string");
      if (raw.locale !== undefined && !isString(raw.locale))
        throw stepErr(index, "app.locale must be a string");
      if (raw.url !== undefined && !isString(raw.url))
        throw stepErr(index, "app.url must be a string");
      if (raw.artifact !== undefined && !isString(raw.artifact))
        throw stepErr(index, "app.artifact must be a string");
      if (raw.as !== undefined && (!isString(raw.as) || !/^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(raw.as)))
        throw stepErr(index, "app.as must be a valid variable name");
      if (raw.version !== undefined && !isString(raw.version))
        throw stepErr(index, "app.version must be a string");
      if (
        raw.versionMatch !== undefined &&
        raw.versionMatch !== "exact" &&
        raw.versionMatch !== "contains"
      )
        throw stepErr(index, 'app.versionMatch must be "exact" | "contains"');
      if (raw.action === "open" && !isString(raw.app) && !isString(raw.url))
        throw stepErr(index, "app open requires app or url");
      if (raw.relaunch !== undefined && typeof raw.relaunch !== "boolean")
        throw stepErr(index, "app relaunch must be a boolean");
      if (
        raw.action !== "open" &&
        raw.action !== "switcher" &&
        (!isString(raw.app) || !raw.app.trim())
      ) {
        throw stepErr(index, `${raw.action} requires app package or bundle identifier`);
      }
      if (raw.action === "set-locale" && (!isString(raw.locale) || !raw.locale.trim())) {
        throw stepErr(index, "set-locale requires a BCP-47 locale");
      }
      if (
        (raw.action === "install" || raw.action === "update") &&
        (!isString(raw.artifact) || !raw.artifact.trim())
      ) {
        throw stepErr(index, `${raw.action} requires a local APK artifact path`);
      }
      if (raw.action === "assert-not-installed" && raw.version !== undefined) {
        throw stepErr(index, "assert-not-installed cannot include a version");
      }
      return {
        kind: "app",
        action: raw.action as Extract<RecipeStep, { kind: "app" }>["action"],
        ...(isString(raw.app) ? { app: raw.app } : {}),
        ...(isString(raw.locale) ? { locale: raw.locale } : {}),
        ...(isString(raw.url) ? { url: raw.url } : {}),
        ...(typeof raw.relaunch === "boolean" ? { relaunch: raw.relaunch } : {}),
        ...(isString(raw.artifact) ? { artifact: raw.artifact } : {}),
        ...(isString(raw.as) ? { as: raw.as } : {}),
        ...(isString(raw.version) ? { version: raw.version } : {}),
        ...(raw.versionMatch === "exact" || raw.versionMatch === "contains"
          ? { versionMatch: raw.versionMatch }
          : {}),
        ...(note ? { note } : {}),
      };
    }
    case "device": {
      if (!["lock", "unlock", "keyboard-dismiss", "keyboard-enter"].includes(String(raw.action)))
        throw stepErr(index, "device has an unknown action");
      return {
        kind: "device",
        action: raw.action as "lock" | "unlock" | "keyboard-dismiss" | "keyboard-enter",
        ...(note ? { note } : {}),
      };
    }
    case "rotate": {
      if (
        !["portrait", "portrait-upside-down", "landscape-left", "landscape-right"].includes(
          String(raw.orientation),
        )
      )
        throw stepErr(index, "rotate has an invalid orientation");
      return {
        kind: "rotate",
        orientation: raw.orientation as
          | "portrait"
          | "portrait-upside-down"
          | "landscape-left"
          | "landscape-right",
        ...(note ? { note } : {}),
      };
    }
    case "settings": {
      if (
        !["wifi", "airplane", "location", "animations", "appearance"].includes(String(raw.setting))
      )
        throw stepErr(index, "settings has an invalid setting");
      if (!["on", "off", "light", "dark", "toggle"].includes(String(raw.state)))
        throw stepErr(index, "settings has an invalid state");
      if (
        raw.setting === "appearance"
          ? !["light", "dark", "toggle"].includes(String(raw.state))
          : !["on", "off"].includes(String(raw.state))
      )
        throw stepErr(index, "settings state is not valid for this setting");
      return {
        kind: "settings",
        setting: raw.setting as "wifi" | "airplane" | "location" | "animations" | "appearance",
        state: raw.state as "on" | "off" | "light" | "dark" | "toggle",
        ...(note ? { note } : {}),
      };
    }
    case "location": {
      if (!isNumber(raw.latitude) || !isNumber(raw.longitude))
        throw stepErr(index, "location requires latitude and longitude numbers");
      if (raw.latitude < -90 || raw.latitude > 90 || raw.longitude < -180 || raw.longitude > 180)
        throw stepErr(index, "location coordinates are out of range");
      return {
        kind: "location",
        latitude: raw.latitude,
        longitude: raw.longitude,
        ...(note ? { note } : {}),
      };
    }
    case "permission": {
      const permissions = [
        "camera",
        "microphone",
        "photos",
        "contacts",
        "notifications",
        "calendar",
        "location",
        "location-always",
        "media-library",
        "motion",
        "reminders",
        "siri",
      ] as const;
      if (!["grant", "deny", "reset"].includes(String(raw.action)))
        throw stepErr(index, "permission has an invalid action");
      if (!permissions.includes(raw.permission as (typeof permissions)[number]))
        throw stepErr(index, "permission has an invalid target");
      return {
        kind: "permission",
        action: raw.action as "grant" | "deny" | "reset",
        permission: raw.permission as (typeof permissions)[number],
        ...(note ? { note } : {}),
      };
    }
    case "alert": {
      if (!["get", "accept", "dismiss", "wait"].includes(String(raw.action)))
        throw stepErr(index, "alert has an invalid action");
      if (
        raw.timeoutMs !== undefined &&
        (!isNumber(raw.timeoutMs) || raw.timeoutMs < 0 || raw.timeoutMs > MAX_WAIT_MS)
      )
        throw stepErr(index, "alert.timeoutMs is invalid");
      return {
        kind: "alert",
        action: raw.action as "get" | "accept" | "dismiss" | "wait",
        ...(isNumber(raw.timeoutMs) ? { timeoutMs: raw.timeoutMs } : {}),
        ...(note ? { note } : {}),
      };
    }
    case "network": {
      if (raw.action !== "dump" && raw.action !== "log")
        throw stepErr(index, 'network requires action: "dump" | "log"');
      if (
        raw.include !== undefined &&
        !["summary", "headers", "body", "all"].includes(String(raw.include))
      )
        throw stepErr(index, "network.include is invalid");
      if (raw.limit !== undefined && (!isNumber(raw.limit) || raw.limit < 1 || raw.limit > 1000))
        throw stepErr(index, "network.limit must be between 1 and 1000");
      return {
        kind: "network",
        action: raw.action,
        ...(raw.include ? { include: raw.include as "summary" | "headers" | "body" | "all" } : {}),
        ...(isNumber(raw.limit) ? { limit: raw.limit } : {}),
        ...(note ? { note } : {}),
      };
    }
    case "logs": {
      if (!["start", "stop", "mark", "clear"].includes(String(raw.action)))
        throw stepErr(index, "logs has an invalid action");
      if (raw.message !== undefined && !isString(raw.message))
        throw stepErr(index, "logs.message must be a string");
      return {
        kind: "logs",
        action: raw.action as "start" | "stop" | "mark" | "clear",
        ...(isString(raw.message) ? { message: raw.message } : {}),
        ...(note ? { note } : {}),
      };
    }
    default:
      return undefined;
  }
}
