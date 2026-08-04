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
  if (/already bound|already in use|session .* bound/i.test(message)) {
    return "This target is already in use by another session. Stop that session or choose a different target.";
  }
  if (/server.*offline|connection refused|failed to fetch|network request failed/i.test(message)) {
    return "Relay could not reach the target service. Start it, then try again.";
  }
  if (/device missing|unknown target|target.*not found|no such device/i.test(message)) {
    return "This device is no longer connected. Reconnect it or choose another target, then retry.";
  }
  if (/timed out|timeout/i.test(message)) {
    return "The target did not respond in time. Check the app state and try again.";
  }
  return message;
}
