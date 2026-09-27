import { RecordingInputNotSentError } from "./recording-input-outcome";

/** Only typed pre-dispatch failures may tell the user an input was not sent. */
export function liveInputRecovery(error: unknown): { message: string; reconnect: boolean } {
  const body = error && typeof error === "object" && "body" in error ? error.body : undefined;
  const code = body && typeof body === "object" && "code" in body ? body.code : undefined;
  if (code === "BROWSER_STALE_INPUT") {
    return {
      message: "The page changed before the input was sent. Try again on the updated view.",
      reconnect: false,
    };
  }
  if (code === "BROWSER_SEMANTIC_TARGET_REQUIRED") {
    return {
      message:
        "Relay couldn’t identify a unique control there. Inspect the page and select a control.",
      reconnect: false,
    };
  }
  if (code === "BROWSER_PAGE_STALE" || code === "BROWSER_SESSION_STALE") {
    return { message: "The browser session changed. Reconnect to continue.", reconnect: true };
  }
  if (error instanceof RecordingInputNotSentError) {
    return { message: error.message, reconnect: true };
  }
  return {
    message: "Relay couldn’t confirm that input. Check the app before repeating it.",
    reconnect: true,
  };
}
