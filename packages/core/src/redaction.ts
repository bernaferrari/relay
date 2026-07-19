import { createHash } from "node:crypto";

const SENSITIVE_KEY =
  /(?:authorization|cookie|password|passwd|secret|token|api[-_]?key|clipboard)/i;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const COOKIE = /\b(cookie|set-cookie)\s*[:=]\s*[^\s,;]+/gi;

export const REDACTED = "[REDACTED]";

export function digestValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function redactUrl(value: string): string {
  return value.replace(/(https?:\/\/[^\s?#]+)\?[^\s#]*/gi, "$1?[REDACTED]");
}

export function redactText(value: string): string {
  return redactUrl(value).replace(BEARER, "$1 [REDACTED]").replace(COOKIE, "$1: [REDACTED]");
}

export function redactValue(value: unknown, key = ""): unknown {
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const secretBearingCommand = record.kind === "type" || record.kind === "clipboard";
    return Object.fromEntries(
      Object.entries(record).map(([childKey, child]) => [
        childKey,
        secretBearingCommand && (childKey === "text" || childKey === "expect")
          ? REDACTED
          : redactValue(child, childKey),
      ]),
    );
  }
  return value;
}

export function redactResolvedInputs(inputs: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(inputs).map(([key, value]) => [
      key,
      SENSITIVE_KEY.test(key) ? `${REDACTED}:${digestValue(value)}` : redactText(value),
    ]),
  );
}
