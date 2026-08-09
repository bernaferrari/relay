import { titleize } from "./job";

const TEST_FIXABLE_FAILURES = new Set([
  "target-state",
  "locator",
  "action",
  "completion",
  "extraction",
  "deterministic-assertion",
  "semantic-assertion",
  "visual-assertion",
]);

export function canFixFailureInTest(value?: string): boolean {
  return Boolean(value && TEST_FIXABLE_FAILURES.has(value));
}

export function readableFailure(value: string, error?: string): string {
  if (
    value === "environment" &&
    error &&
    /device missing|unknown target|target.*not found|no such device/i.test(error)
  ) {
    return "Device unavailable";
  }
  const labels: Record<string, string> = {
    environment: "Setup",
    "target-state": "App state",
    locator: "Target not found",
    action: "Action",
    completion: "Response timeout",
    extraction: "Could not read response",
    "deterministic-assertion": "Expected check",
    "semantic-assertion": "Answer check",
    "visual-assertion": "Visual check",
    "judge-uncertainty": "Needs review",
    "harness-defect": "Test system",
  };
  return labels[value] ?? titleize(value);
}

export function friendlyError(value: string): string {
  const message = value.trim();
  if (
    /already bound|already in use|session .* bound|lease acquisition failed|bound by session/i.test(
      message,
    )
  ) {
    return "Someone else is using this device. Press Reconnect, or choose a different device.";
  }
  if (/server.*offline|connection refused|failed to fetch|network request failed/i.test(message)) {
    return "Relay could not reach the server. Start it, then try again.";
  }
  if (/device missing|unknown target|target.*not found|no such device/i.test(message)) {
    return "This device is no longer connected. Reconnect it or choose another, then try again.";
  }
  if (/timed out|timeout/i.test(message)) {
    return "The device did not respond in time. Check the app is open, then try again.";
  }
  if (
    /signing certificate|provision|team id|code sign|xcode|developer mode|scrcpy|devicectl/i.test(
      message,
    )
  ) {
    return "This device is not ready yet. Finish setup, then try again.";
  }
  if (/no active session|run open first/i.test(message)) {
    return "The app is open, but the tap session is not attached. Retry the tap once.";
  }
  if (/session|lease|human:[0-9a-f-]+|@e\d+|bundle id/i.test(message)) {
    return "Relay could not use this device right now. Try again in a moment.";
  }
  return message;
}
