export const SIGN_IN_USERNAME_REFERENCE = "secret:signin.username";
export const SIGN_IN_PASSWORD_REFERENCE = "secret:signin.password";

const SECRET_REFERENCE = /^secret:[A-Za-z0-9_.:-]{1,120}$/u;

/** Ephemeral plaintext for the active sign-in. It lives only in the run-local
 * recipe runtime and is mirrored into sensitive inputs so persistence and
 * transport redaction scrub accidental copies. */
export type ActiveSignInSecrets = Readonly<{
  accountKey: string;
  username: string;
  password: string;
  source: "environment" | "local";
  reference?: string;
}>;

export class SecretReferenceError extends Error {
  constructor(
    readonly code: "unknown-reference" | "out-of-context",
    readonly reference: string,
    message: string,
  ) {
    super(message);
    this.name = "SecretReferenceError";
  }
}

export function isSecretReferenceText(value: string): boolean {
  return SECRET_REFERENCE.test(value);
}

export function isSignInSecretReference(value: string): boolean {
  return value === SIGN_IN_USERNAME_REFERENCE || value === SIGN_IN_PASSWORD_REFERENCE;
}

/** Resolve an exact secret reference without mutating the recipe step. This
 * is deliberately fail-closed: secret-looking text is never typed literally. */
export function resolveSecretReference(
  value: string,
  activeSignIn: ActiveSignInSecrets | undefined,
): string {
  if (!isSecretReferenceText(value)) return value;
  if (value === SIGN_IN_USERNAME_REFERENCE || value === SIGN_IN_PASSWORD_REFERENCE) {
    if (!activeSignIn) {
      throw new SecretReferenceError(
        "out-of-context",
        value,
        `${value} requires an active saved sign-in step`,
      );
    }
    return value === SIGN_IN_USERNAME_REFERENCE ? activeSignIn.username : activeSignIn.password;
  }
  throw new SecretReferenceError(
    "unknown-reference",
    value,
    `Unknown secret reference ${value}; Relay stopped before typing it`,
  );
}
