import { For, type JSX } from "solid-js";

type JsonEvidenceProps = {
  value: unknown;
};

/** Read-only JSON with restrained syntax color and no unsafe HTML rendering. */
export function JsonEvidence(props: JsonEvidenceProps): JSX.Element {
  const lines = () => JSON.stringify(props.value, null, 2).split("\n");
  return (
    <pre class="m-0 max-h-64 overflow-auto bg-background-deep p-3 font-mono text-micro/[1.55] text-text-weak">
      <For each={lines()}>
        {(line) => (
          <>
            <For each={tokenizeJson(line)}>
              {(token) => <span class={token.class}>{token.value}</span>}
            </For>
            {"\n"}
          </>
        )}
      </For>
    </pre>
  );
}

type JsonToken = { value: string; class: string };

function tokenizeJson(line: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  const pattern =
    /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g;
  let cursor = 0;
  for (const match of line.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) tokens.push({ value: line.slice(cursor, index), class: "" });
    if (match[1]) {
      tokens.push({
        value: match[1],
        class: match[2] ? "text-text-brand-base" : "text-text-success-base",
      });
      if (match[2]) tokens.push({ value: match[2], class: "text-text-weak" });
    } else if (match[3]) {
      tokens.push({ value: match[3], class: "text-text-warning-base" });
    } else {
      tokens.push({ value: match[4] ?? "", class: "text-text-brand-base" });
    }
    cursor = index + match[0].length;
  }
  if (cursor < line.length) tokens.push({ value: line.slice(cursor), class: "" });
  return tokens;
}
