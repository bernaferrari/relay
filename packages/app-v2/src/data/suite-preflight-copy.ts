/** Plan preview blockers must name the missing profile or target. Do not hide
 * a two-profile grok.com ambiguity behind a generic saved-profile sentence. */
export function friendlySuiteIssue(message: string): string {
  if (/ERR_CONNECTION_REFUSED|connection refused/iu.test(message)) {
    return "The selected browser could not reach the app. Check its URL or start the app, then try again.";
  }
  return message;
}
