import { DEFAULT_SAVED_SIGN_IN_KEY } from "@relay/protocol";
import { normalizeSavedSignInKey } from "./saved-sign-ins.js";

export type SavedSignInEnvironment = Readonly<Record<string, string | undefined>>;

export type SavedSignInEnvironmentOverlay =
  | Readonly<{
      status: "complete";
      key: string;
      username: string;
      password: string;
      usernameVariable: string;
      passwordVariable: string;
    }>
  | Readonly<{
      status: "partial";
      key: string;
      missing: "username" | "password";
      usernameVariable: string;
      passwordVariable: string;
    }>
  | Readonly<{
      status: "absent";
      key: string;
      usernameVariable: string;
      passwordVariable: string;
    }>;

export function savedSignInEnvironmentSuffix(keyInput?: string): string {
  const key = normalizeSavedSignInKey(keyInput ?? DEFAULT_SAVED_SIGN_IN_KEY);
  return key.toUpperCase().replace(/[^A-Z0-9]+/gu, "_");
}

export function savedSignInEnvironmentVariableNames(key?: string): {
  usernameVariable: string;
  passwordVariable: string;
} {
  const suffix = savedSignInEnvironmentSuffix(key);
  return {
    usernameVariable: `RELAY_SIGN_IN_${suffix}_USERNAME`,
    passwordVariable: `RELAY_SIGN_IN_${suffix}_PASSWORD`,
  };
}

/** CI overlay inspection. Presence means a non-empty value; a partial pair is
 * explicit and must fail closed rather than silently falling back to disk. */
export function inspectSavedSignInEnvironmentOverlay(
  keyInput?: string,
  env: SavedSignInEnvironment = process.env,
): SavedSignInEnvironmentOverlay {
  const key = normalizeSavedSignInKey(keyInput ?? DEFAULT_SAVED_SIGN_IN_KEY);
  const { usernameVariable, passwordVariable } = savedSignInEnvironmentVariableNames(key);
  const username = env[usernameVariable];
  const password = env[passwordVariable];
  const hasUsername = typeof username === "string" && username.length > 0;
  const hasPassword = typeof password === "string" && password.length > 0;
  if (hasUsername && hasPassword) {
    return Object.freeze({
      status: "complete",
      key,
      username: username!,
      password: password!,
      usernameVariable,
      passwordVariable,
    });
  }
  if (hasUsername !== hasPassword) {
    return Object.freeze({
      status: "partial",
      key,
      missing: hasUsername ? "password" : "username",
      usernameVariable,
      passwordVariable,
    });
  }
  return Object.freeze({ status: "absent", key, usernameVariable, passwordVariable });
}
