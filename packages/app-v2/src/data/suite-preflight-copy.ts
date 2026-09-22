/** Plan preview blockers must name the missing profile or target. Do not hide
 * a two-profile grok.com ambiguity behind a generic saved-profile sentence. */
export function friendlySuiteIssue(
  message: string,
  targets: readonly { id: string; name: string }[] = [],
): string {
  const missing =
    /^No saved runtime profile for target (.+?) — capture a screen on this target first\.$/u.exec(
      message,
    );
  if (missing) {
    const name =
      targets.find(
        (target) =>
          target.id === missing[1] ||
          missing[1] === `browser:${target.id}` ||
          missing[1] === `android:${target.id}` ||
          missing[1] === `ios:${target.id}`,
      )?.name ?? missing[1];
    return `“${name}” has no saved screen capture to use for setup. Open this browser or device and capture a screen first, or choose another target in Where to run.`;
  }
  if (/ERR_CONNECTION_REFUSED|connection refused/iu.test(message)) {
    return "The selected browser could not reach the app. Check its URL or start the app, then try again.";
  }
  return message;
}
