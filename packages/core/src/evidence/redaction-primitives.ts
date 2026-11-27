import { createHash } from "node:crypto";
import { REDACTED, type RedactionPolicy } from "@relay/protocol";

const SENSITIVE_KEY =
  /(?:authorization|cookie|password|passwd|secret|token|api[-_]?key|clipboard)/i;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const COOKIE = /\b(cookie|set-cookie)\s*[:=]\s*[^\s,;]+/gi;

export { REDACTED } from "@relay/protocol";

export function redactionKeyIsSensitive(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

export function digestValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function redactUrlContent(value: string): string {
  return value.replace(/(https?:\/\/[^\s?#]+)\?[^\s#]*/gi, "$1?[REDACTED]");
}

export function redactTextContent(value: string): string {
  return redactUrlContent(value).replace(BEARER, "$1 [REDACTED]").replace(COOKIE, "$1: [REDACTED]");
}

export function redactValueForEnabledPolicy(
  value: unknown,
  key: string,
  enabled: boolean,
): unknown {
  if (!enabled) return value;
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (typeof value === "string") return redactTextContent(value);
  if (Array.isArray(value)) return value.map((item) => redactValueForEnabledPolicy(item, "", true));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const secretBearingCommand = record.kind === "type" || record.kind === "clipboard";
    return Object.fromEntries(
      Object.entries(record).map(([childKey, child]) => [
        childKey,
        secretBearingCommand && (childKey === "text" || childKey === "expect")
          ? REDACTED
          : redactValueForEnabledPolicy(child, childKey, true),
      ]),
    );
  }
  return value;
}

export function redactValueForPolicy(value: unknown, policy: RedactionPolicy): unknown {
  return redactValueForEnabledPolicy(value, "", policy.enabled);
}

export function redactSensitiveEvidenceValue(value: unknown, key = ""): unknown {
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (typeof value === "string") return redactTextContent(value);
  if (Array.isArray(value)) return value.map((item) => redactSensitiveEvidenceValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [
        childKey,
        redactSensitiveEvidenceValue(child, childKey),
      ]),
    );
  }
  return value;
}
