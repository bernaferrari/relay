import { UsageError } from "./errors.js";

/**
 * Old command spellings and the one path that replaced each. Nothing here
 * still runs: an old spelling fails with a pointer to its current path. The
 * longest matching prefix wins, and any remaining words carry over, so
 * `relay combine run shop daily` points at `relay plan run shop daily`.
 * A current value with " | " lists choices and carries nothing over.
 */
export const renamedCommands: readonly (readonly [old: string, current: string])[] = [
  ["session batch", "recording interact"],
  ["session wait", "recording interact"],
  ["session", "recording"],
  ["take", "recording"],
  ["combine analyze", "plan findings"],
  ["combine campaign get", "plan status"],
  ["combine campaign", "plan"],
  ["combine", "plan"],
  ["job get", "run watch"],
  ["job active cancel", "run cancel-all"],
  ["job combine start", "plan run"],
  ["job compatibility-matrix start", "plan matrix run"],
  ["job matrix start", "run matrix"],
  ["job soak start", "run soak"],
  ["job", "run"],
  ["matrix", "plan matrix"],
  ["schedule", "plan schedule"],
  ["variable", "test var"],
  ["data variables", "test data"],
  ["case-stack", "test case-stack"],
  ["browser capture-plan", "test capture-plan"],
  ["repair", "run repair"],
  ["run approve", "run visual approve"],
  ["run visual-baseline update", "run visual approve"],
  ["run visual-policy", "run visual policy"],
  ["run walkthrough-pack get", "run walkthrough"],
  ["run trace-pack get", "run trace-pack"],
  ["map list", "apps"],
  ["screen list", "map get"],
  ["screen", "map screen"],
  ["connect list", "map get"],
  ["connect get", "map connection get"],
  ["connect create", "map connection create"],
  ["connect update", "map connection update"],
  ["connect remove", "map connection remove"],
  ["connect run", "map connection run"],
  ["flow list", "map get"],
  ["flow", "map flow"],
  ["routine list", "map get"],
  ["routine", "map routine"],
  ["group", "map group"],
  ["proposal list", "map get"],
  ["proposal", "map proposal"],
  ["action", "map action"],
  ["discovery status update", "map explore set-status"],
  ["discovery", "map explore"],
  ["device list", "devices"],
  ["device observe", "device snapshot"],
  ["browser auth", "device account"],
  ["browser open", "device target open"],
  ["browser snapshot", "device snapshot"],
  ["browser click", "device interact"],
  ["target worker list", "device workers"],
  ["target", "device target"],
  ["lease history", "device lease list"],
  ["lease create-in-pool", "device lease create-in-pool"],
  ["lease", "device lease"],
  ["device-pool", "device pool"],
  ["lane", "device lane"],
  ["workspace apple-device update", "device apple update"],
  ["policy", "proof"],
  ["change inspect", "proof change"],
  ["prove", "proof verify --base <ref> | proof run <proof-id> | proof prepare"],
  ["report emit", "proof report"],
  ["report", "proof report"],
  ["system doctor", "doctor"],
  ["system health", "doctor"],
  ["activity", "system activity"],
  ["project", "system project"],
  ["db", "system db"],
];

const byLength = [...renamedCommands]
  .map(([old, current]) => ({ old: old.split(" "), current }))
  .sort((left, right) => right.old.length - left.old.length);

function matchOld(positionals: readonly string[]) {
  return byLength.find(({ old }) => old.every((token, index) => positionals[index] === token));
}

/** The current spelling for an old command line, or undefined if it is not old. */
export function renamedCommand(positionals: readonly string[]): string | undefined {
  const match = matchOld(positionals);
  if (!match) return undefined;
  if (match.current.includes(" | ")) return match.current;
  return [match.current, ...positionals.slice(match.old.length)].join(" ");
}

/** The "did you mean" error for an old spelling, or undefined. */
export function renamedCommandError(positionals: readonly string[]): UsageError | undefined {
  const current = renamedCommand(positionals);
  if (!current) return undefined;
  const choices = current.split(" | ").map((choice) => `'relay ${choice}'`);
  const typed = matchOld(positionals)!.old.join(" ");
  return new UsageError(
    `'relay ${typed}' moved. ` +
      (choices.length > 1 ? `Use one of: ${choices.join(", ")}.` : `Use ${choices[0]}.`),
  );
}

/** Where an old family's commands went, for `relay help <old-family>`. */
export function renamedFamily(family: string): string[] {
  return [
    ...new Set(
      byLength
        .filter(({ old }) => old[0] === family)
        .flatMap(({ current }) => current.split(" | ").map((choice) => choice.split(" ")[0]!)),
    ),
  ];
}
