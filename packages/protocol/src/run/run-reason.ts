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

const QUOTED_TARGET = /\((?:label|text|identifier|id) "(.+?)"\)/u;

/** Exact runner phrasings seen in persisted runs, as sentences a person can repeat. */
const PHRASES: readonly [RegExp, (match: RegExpExecArray, line: string) => string][] = [
  [
    /Text entry verification failed: the field readback does not match/iu,
    () => "Relay typed the text, but the field showed something different.",
  ],
  [
    /Text entry (?:verification failed|readback unavailable)|native input unverified/iu,
    () => "Relay typed the text, but couldn’t confirm the field received it.",
  ],
  [
    /screen-inspection-unavailable:/iu,
    (_match, line) => {
      const expected = /expected “(.+?)”/u.exec(line)?.[1];
      return expected
        ? `Relay couldn’t read the screen’s controls, so it couldn’t confirm it was on “${expected}”.`
        : "Relay couldn’t read the screen’s controls.";
    },
  ],
  [
    /could not read the current accessibility tree/iu,
    () => "Relay couldn’t read the screen’s controls.",
  ],
  [
    /named target absent from current \w+ accessibility tree/iu,
    (_match, line) => {
      const target = QUOTED_TARGET.exec(line)?.[1];
      return target
        ? `Relay couldn’t find “${target}” on the screen.`
        : "Relay couldn’t find that control on the screen.";
    },
  ],
  [
    /named target ambiguous.*?matches (\d+) different control locations/iu,
    (match, line) => {
      const target = QUOTED_TARGET.exec(line)?.[1];
      return `Relay found ${match[1]} ${target ? `“${target}” controls` : "matching controls"} and couldn’t tell which one to use.`;
    },
  ],
  [
    /Blocked before mutation:.*cursor is unknown/iu,
    () => "Relay stopped before acting because it couldn’t confirm which screen it was on.",
  ],
  [
    /iOS runner was already restarted during this request/iu,
    () => "The iOS device stopped responding, even after Relay reconnected to it.",
  ],
  [
    /^response completion: timed out after (\d+)s/iu,
    (match) => `No reply appeared within ${seconds(String(Number(match[1]) * 1000))}.`,
  ],
  [
    /Target page, context or browser has been closed/iu,
    () => "The browser closed before the test finished.",
  ],
  [/net::ERR_CONNECTION_REFUSED at (\S+)/u, (match) => `Nothing answered at ${match[1]}.`],
  [
    /navigating to "(.+?)", waiting until/u,
    (match) => `The page at ${match[1]} didn’t finish loading.`,
  ],
  [
    /Job control lease is no longer valid/iu,
    () => "Relay lost track of this run before it finished.",
  ],
  [
    /recovery-required fence/iu,
    () => "The device needs to be recovered before Relay can use it again.",
  ],
  [
    /^Stuck at “(.+?)” and nobody resumed it within (\d+)s/u,
    (match) =>
      `Relay paused at “${match[1]}” and nobody continued it within ${seconds(String(Number(match[2]) * 1000))}.`,
  ],
];

/** Runner phrasings people should never have to decode. */
function humanize(line: string): string {
  for (const [pattern, sentence] of PHRASES) {
    const match = pattern.exec(line);
    if (match) return sentence(match, line);
  }
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
  const flagged = lines.find((line) => line.startsWith("✗"));
  if (flagged) return humanize(cleanLine(flagged));
  // Driver call logs end with chatter ("- navigating to…"); the line Relay can
  // explain (a refused connection, a closed browser) is the real reason.
  for (const line of lines) {
    const cleaned = cleanLine(line);
    const sentence = humanize(cleaned);
    if (sentence !== cleaned) return sentence;
  }
  return humanize(cleanLine(lines.at(-1) ?? message.trim()));
}

function cleanLine(line: string): string {
  return (
    line
      // Terminal colour codes from browser drivers are not words.
      // eslint-disable-next-line no-control-regex -- Strip ANSI escape sequences from driver messages.
      .replace(/\u001b\[[0-9;]*m|\[\d+m/gu, "")
      .replace(/^-\s+/u, "")
      .replace(/^\d+ campaign checks? failed: [^:]+: /u, "")
      .replace(RUNNER_PREFIX, "")
      .replace(/^✗\s*/u, "")
      .trim()
  );
}
