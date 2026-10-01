import {
  formatRelayTaskGuide,
  relayTaskGuide,
  relayTaskGuideCatalog,
} from "@relay/workflows/task-guides";

/** Installed MCP users can discover tasks before configuring a connection. */
export function runRelayMcpGuide(
  argv: readonly string[],
  stdout: { write(text: string): unknown },
): void {
  const options = new Set(["--json", "--help", "-h"]);
  if (argv.some((arg) => arg.startsWith("-") && !options.has(arg)))
    throw new Error("Expected: relay-mcp guide [topic] [--json]");
  const topics = argv.filter((arg) => !options.has(arg));
  if (topics.length > 1) throw new Error("Expected: relay-mcp guide [topic] [--json]");
  const showIndex = !topics.length || argv.includes("--help") || argv.includes("-h");
  const guide = relayTaskGuide(showIndex ? "start" : topics[0]);
  if (!guide)
    throw new Error(
      `Unknown guide: ${topics[0]}. Topics: ${relayTaskGuideCatalog.map((item) => item.topic).join(", ")}`,
    );
  const catalog = relayTaskGuideCatalog.map(({ topic, title, summary }) => ({
    topic,
    title,
    summary,
    uri: `relay://guides/${topic}`,
  }));
  const markdown = formatRelayTaskGuide(guide);
  if (argv.includes("--json"))
    stdout.write(
      `${JSON.stringify({ topic: guide.topic, title: guide.title, markdown, ...(showIndex ? { topics: catalog } : {}) })}\n`,
    );
  else {
    stdout.write(markdown);
    if (showIndex)
      stdout.write(
        `\nTask guides:\n${catalog.map((item) => `  relay-mcp guide ${item.topic.padEnd(9)} ${item.summary}`).join("\n")}\n`,
      );
  }
}
