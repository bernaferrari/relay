import { timingSafeEqual } from "node:crypto";

const MIN_TOKEN_LENGTH = 24;

export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1"
  );
}

export function assertSafeBinding(host: string, token?: string): void {
  if (isLoopbackHost(host)) return;
  if (!token) {
    throw new Error(
      `Refusing to bind ${host} without authentication. Pass --token or set RELAY_AUTH_TOKEN.`,
    );
  }
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      `Server authentication tokens must be at least ${MIN_TOKEN_LENGTH} characters.`,
    );
  }
}

export function authorizationMatches(
  header: string | undefined,
  token: string | undefined,
): boolean {
  if (!token) return true;
  const prefix = "Bearer ";
  if (!header?.startsWith(prefix)) return false;
  const supplied = Buffer.from(header.slice(prefix.length), "utf8");
  const expected = Buffer.from(token, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
