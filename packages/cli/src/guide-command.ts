import {
  formatRelayTaskGuide,
  relayTaskGuide,
  relayTaskGuideCatalog,
} from "@relay/workflows/task-guides";
import { tokenize } from "./cli-argv.js";
import { UsageError } from "./errors.js";
import { CliOutput, type OutputStreams } from "./output.js";

/** Local help must remain usable when server credentials or setup are broken. */
export function runGuideCommand(argv: readonly string[], streams: OutputStreams): number {
  const tokens = tokenize(argv);
  const [command, topic, ...extra] = tokens.positionals;
  if (
    command !== "guide" ||
    extra.length ||
    tokens.values.size ||
    [...tokens.switches].some(
      (flag) => !["--json", "--ndjson", "--quiet", "--help", "-h"].includes(flag),
    )
  ) {
    throw new UsageError("Expected: relay guide [topic] [--json | --ndjson]");
  }
  if (tokens.switches.has("--json") && tokens.switches.has("--ndjson")) {
    throw new UsageError("Use only one of --json or --ndjson");
  }
  const showIndex = !topic || tokens.switches.has("--help") || tokens.switches.has("-h");
  const guide = relayTaskGuide(showIndex ? "start" : topic);
  if (!guide)
    throw new UsageError(
      `Unknown guide: ${topic}. Topics: ${relayTaskGuideCatalog.map((item) => item.topic).join(", ")}`,
    );
  const topics = relayTaskGuideCatalog.map(({ topic, title, summary }) => ({
    topic,
    title,
    summary,
    uri: `relay://guides/${topic}`,
  }));
  const markdown = formatRelayTaskGuide(guide);
  if (tokens.switches.has("--json") || tokens.switches.has("--ndjson")) {
    new CliOutput(
      tokens.switches.has("--json") ? "json" : "ndjson",
      tokens.switches.has("--quiet"),
      streams,
    ).result("local.guide", {
      topic: guide.topic,
      title: guide.title,
      markdown,
      ...(showIndex ? { topics } : {}),
    });
  } else {
    streams.stdout.write(markdown);
    if (showIndex)
      streams.stdout.write(
        `\nTask guides:\n${topics.map((item) => `  relay guide ${item.topic.padEnd(9)} ${item.summary}`).join("\n")}\n`,
      );
  }
  return 0;
}
