/**
 * Plain sentences from runner messages, shared by verdicts, the CLI, agents,
 * and the run report: no prefixes, no cleanup chatter, no runner phrasing.
 */
const RUNNER_PREFIX =
  /^(?:✗\s*)?(?:judge uncertain: )?(?:visual assertion|semantic assertion|content assertion|expect): /iu;

function seconds(ms: string): string {
  const value = Number(ms) / 1000;
  return value >= 60 ? `${Math.round(value / 60)} min` : `${Math.round(value)} s`;
}

/** Runner phrasings people should never have to decode. */
function humanize(line: string): string {
  const screen = /expect-screen: on “(.+?)”, not “(.+?)”(?: after (\d+)ms)?/u.exec(line);
  if (screen) {
    const [, observed, expected, ms] = screen;
    const where =
      observed === "unknown"
        ? "Relay didn’t recognize the screen it was on"
        : `it was on “${observed}”`;
    return `Expected the “${expected}” screen${ms ? ` within ${seconds(ms)}` : ""}, but ${where}.`;
  }
  const waited = /^(?:wait-for|expect): timed out waiting for (.+?) \((\d+)ms\)/u.exec(line);
  if (waited) {
    const what = waited[1]!.replace(/^(?:text|label|identifier) "(.+)"$/u, "“$1”");
    return `${what[0]!.toUpperCase()}${what.slice(1)} didn’t appear within ${seconds(waited[2]!)}.`;
  }
  return line;
}

/** Plain words from a runner message: drop prefixes and the cleanup chatter. */
export function plainRunReason(message: string | undefined): string | undefined {
  if (!message?.trim()) return undefined;
  const lines = message
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !/^check cleanup skipped|^Run saved Test/iu.test(line));
  const best = lines.find((line) => line.startsWith("✗")) ?? lines.at(-1) ?? message.trim();
  const cleaned = best
    .replace(/^\d+ campaign checks? failed: [^:]+: /u, "")
    .replace(RUNNER_PREFIX, "")
    .replace(/^✗\s*/u, "")
    .trim();
  return humanize(cleaned);
}
