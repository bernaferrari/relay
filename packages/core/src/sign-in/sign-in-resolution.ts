import {
  savedSignInSecretSchema,
  type SavedSignInMetadata,
  type SavedSignInResolution,
} from "@relay/protocol";
import {
  inspectSavedSignInEnvironmentOverlay,
  savedSignInEnvironmentVariableNames,
  type SavedSignInEnvironment,
} from "./environment-overlays.js";
import {
  latestNonRevokedSavedSignIn,
  listSavedSignIns,
  loadSavedSignInSecret,
  normalizeSavedSignInKey,
  SavedSignInStoreError,
} from "./saved-sign-ins.js";

export type SavedSignInResolutionErrorCode =
  | "missing"
  | "revoked"
  | "expired"
  | "partial-environment"
  | "unavailable";

export class SavedSignInResolutionError extends Error {
  constructor(
    readonly code: SavedSignInResolutionErrorCode,
    readonly key: string,
    message: string,
    readonly recovery: string,
    readonly metadata?: SavedSignInMetadata,
  ) {
    super(message);
    this.name = "SavedSignInResolutionError";
  }
}

export type ResolvedSavedSignIn = Readonly<{
  key: string;
  username: string;
  password: string;
  source: "environment" | "local";
  reference?: string;
  metadata?: SavedSignInMetadata;
}>;

function environmentRecovery(key: string): string {
  const names = savedSignInEnvironmentVariableNames(key);
  return `Set both ${names.usernameVariable} and ${names.passwordVariable}, unset both, or save and rotate the local saved sign-in as a person.`;
}

function resolutionError(
  code: SavedSignInResolutionErrorCode,
  key: string,
  detail: string,
  recovery: string,
  metadata?: SavedSignInMetadata,
): SavedSignInResolutionError {
  return new SavedSignInResolutionError(code, key, detail, recovery, metadata);
}

/** Resolve the active credential for one logical key. A complete environment
 * pair wins; a partial pair is terminal and never falls back to local state. */
export async function resolveSavedSignIn(input: {
  projectId: string;
  key?: string;
  env?: SavedSignInEnvironment;
  now?: number;
  workspaceRoot?: string;
}): Promise<ResolvedSavedSignIn> {
  const key = normalizeSavedSignInKey(input.key);
  const overlay = inspectSavedSignInEnvironmentOverlay(key, input.env ?? process.env);
  const names = savedSignInEnvironmentVariableNames(key);
  if (overlay.status === "partial") {
    const missingVariable =
      overlay.missing === "username" ? names.usernameVariable : names.passwordVariable;
    throw resolutionError(
      "partial-environment",
      key,
      `Saved sign-in "${key}" has an incomplete environment overlay: ${missingVariable} is missing. Relay will not use the local saved sign-in as a fallback.`,
      environmentRecovery(key),
    );
  }
  if (overlay.status === "complete") {
    const parsed = savedSignInSecretSchema.safeParse({
      username: overlay.username,
      password: overlay.password,
    });
    if (!parsed.success) {
      throw resolutionError(
        "unavailable",
        key,
        `Saved sign-in "${key}" environment overlay is invalid.`,
        environmentRecovery(key),
      );
    }
    return Object.freeze({
      key,
      username: parsed.data.username,
      password: parsed.data.password,
      source: "environment",
    });
  }

  let records: SavedSignInMetadata[];
  try {
    records = await listSavedSignIns({
      projectId: input.projectId,
      key,
      ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
    });
  } catch (error) {
    if (error instanceof SavedSignInStoreError) {
      throw resolutionError(
        "unavailable",
        key,
        `Saved sign-in "${key}" cannot be read safely.`,
        "Inspect the local .relay/sign-ins store permissions and integrity, then rotate the saved sign-in as a person.",
      );
    }
    throw error;
  }
  if (!records.length) {
    throw resolutionError(
      "missing",
      key,
      `Saved sign-in "${key}" was not found.`,
      `Save it with relay sign-in save, or set both ${names.usernameVariable} and ${names.passwordVariable}.`,
    );
  }
  const latest = latestNonRevokedSavedSignIn(records, key);
  if (!latest) {
    throw resolutionError(
      "revoked",
      key,
      `Saved sign-in "${key}" is revoked.`,
      `Rotate it with relay sign-in rotate as a person, or set both ${names.usernameVariable} and ${names.passwordVariable}.`,
      records.at(-1),
    );
  }
  try {
    const loaded = await loadSavedSignInSecret({
      projectId: input.projectId,
      reference: latest.reference,
      ...(input.now === undefined ? {} : { now: input.now }),
      ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
    });
    return Object.freeze({
      key,
      username: loaded.secret.username,
      password: loaded.secret.password,
      source: "local",
      reference: loaded.metadata.reference,
      metadata: loaded.metadata,
    });
  } catch (error) {
    if (error instanceof SavedSignInStoreError) {
      if (error.code === "expired") {
        throw resolutionError(
          "expired",
          key,
          `Saved sign-in "${key}" is expired.`,
          `Rotate it with relay sign-in rotate as a person, or set both ${names.usernameVariable} and ${names.passwordVariable}.`,
          latest,
        );
      }
      if (error.code === "revoked") {
        throw resolutionError(
          "revoked",
          key,
          `Saved sign-in "${key}" is revoked.`,
          `Rotate it with relay sign-in rotate as a person, or set both ${names.usernameVariable} and ${names.passwordVariable}.`,
          latest,
        );
      }
      throw resolutionError(
        "unavailable",
        key,
        `Saved sign-in "${key}" cannot be decrypted safely.`,
        "Rotate the saved sign-in as a person; do not edit encrypted vault files by hand.",
        latest,
      );
    }
    throw error;
  }
}

/** Metadata-only resolution probe for the operation boundary. The returned
 * shape deliberately carries no username or password, even when ready. */
export async function checkSavedSignInResolution(input: {
  projectId: string;
  key?: string;
  env?: SavedSignInEnvironment;
  now?: number;
  workspaceRoot?: string;
}): Promise<SavedSignInResolution> {
  const key = normalizeSavedSignInKey(input.key);
  const names = savedSignInEnvironmentVariableNames(key);
  const overlay = inspectSavedSignInEnvironmentOverlay(key, input.env ?? process.env);
  try {
    const resolved = await resolveSavedSignIn(input);
    return {
      schemaVersion: 1,
      key,
      status: "ready",
      source: resolved.source,
      ...(resolved.reference ? { reference: resolved.reference } : {}),
      ...(resolved.metadata ? { signIn: resolved.metadata } : {}),
      detail:
        resolved.source === "environment"
          ? `Saved sign-in "${key}" is available from the environment overlay.`
          : `Saved sign-in "${key}" is available from local encrypted storage.`,
      recovery: "No action is needed.",
      ...(resolved.source === "environment" ? { environment: names } : {}),
    };
  } catch (error) {
    if (!(error instanceof SavedSignInResolutionError)) throw error;
    return {
      schemaVersion: 1,
      key,
      status: error.code,
      source: "none",
      ...(error.metadata ? { signIn: error.metadata } : {}),
      detail: error.message,
      recovery: error.recovery,
      ...(error.code === "partial-environment" && overlay.status === "partial"
        ? { environment: { ...names, missing: overlay.missing } }
        : {}),
    };
  }
}
