import { presentDeviceIssue } from "./device-readiness";
import { friendlyError } from "./run-failure-presentation";

/**
 * Single funnel for person-facing error text. Driver, lease, session, and
 * signing details never leave this helper as the primary message.
 */
export function humanError(
  error: unknown,
  fallback = "Something went wrong. Try again.",
  deviceName = "the device",
): string {
  const raw =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : error == null
          ? ""
          : String(error);
  const message = raw.trim();
  if (!message) return fallback;

  const deviceFacing = presentDeviceIssue(message, deviceName);
  const stripped = firstLine(message)
    .replace(/\s*Run\s+open\s+first.*$/i, "")
    .replace(/\s*\(for example:.*$/i, "")
    .replace(/\s+owned by human:[0-9a-f-]+/gi, "")
    .replace(/\b(session|lease)\s+[A-Za-z0-9._:-]+/gi, "")
    .replace(/\bhuman:[0-9a-f-]+\b/gi, "")
    .replace(/\bRQ[A-Z0-9]+\b/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (deviceFacing && deviceFacing !== stripped && deviceFacing !== message) {
    return deviceFacing;
  }

  const friendly = friendlyError(message);
  if (friendly !== message) return friendly;

  if (looksTechnical(message)) {
    return presentDeviceIssue(message, deviceName) || fallback;
  }

  return stripped || fallback;
}

function firstLine(message: string): string {
  return message.split("\n", 1)[0]?.trim() ?? "";
}

function looksTechnical(message: string): boolean {
  return (
    /session|lease|xctest|scrcpy|devicectl|bundle id|team id|human:[0-9a-f-]+|RQ[A-Z0-9]+|@e\d+|emulator-\d+|0000[0-9A-F-]+/i.test(
      message,
    ) || /[/\\].+\.(ts|js|m|swift|kt)\b/.test(message)
  );
}

/** Soft-truncate on a word boundary for captions and list titles. */
export function softTruncate(text: string, max = 96): string {
  const value = text.trim();
  if (value.length <= max) return value;
  const slice = value.slice(0, Math.max(0, max - 1));
  const boundary = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("·"), slice.lastIndexOf("-"));
  const kept = (boundary > max * 0.55 ? slice.slice(0, boundary) : slice).trimEnd();
  return `${kept}…`;
}
