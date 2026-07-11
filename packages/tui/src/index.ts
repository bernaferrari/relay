import { runApp, type TuiOptions } from "./app.js";

export type { TuiOptions };
export { runApp as run };

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  let serverUrl: string | undefined;
  const urlIdx = argv.indexOf("--server");
  if (urlIdx >= 0) serverUrl = argv[urlIdx + 1];
  const eq = argv.find((a) => a.startsWith("--server="));
  if (eq) serverUrl = eq.slice("--server=".length);
  await runApp({ serverUrl });
}

const invoked =
  process.argv[1]?.includes("/tui/src/index.ts") ||
  process.argv[1]?.includes("\\tui\\src\\index.ts") ||
  process.argv[1]?.includes("@relay/tui");

if (invoked) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

export default runApp;
