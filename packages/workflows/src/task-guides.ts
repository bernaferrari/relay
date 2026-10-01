/** Task guidance ships with the same artifact as its operation contracts.
 * CLI and MCP read this catalog without a server, target, or model. */
export type RelayTaskGuide = {
  topic: string;
  title: string;
  summary: string;
  markdown: string;
  /** Argument vectors keep examples checkable against the real CLI parser. */
  examples: readonly (readonly string[])[];
};

const guides: readonly RelayTaskGuide[] = [
  {
    topic: "start",
    title: "Capture your first screen",
    summary: "Get useful evidence before configuring a model.",
    markdown: `Relay records a journey, repeats it, and keeps evidence you can review.
Start with one screen on a connected device or an existing Browser.

1. Open Relay desktop and choose your App and Device. If your phone is locked,
   unlock it. Use Reconnect when Relay reports that control is unavailable.
2. Open the app you want to test. Inspect its live screen before recording.
3. Choose New Test, record a short action, and capture a named screenshot.
4. Stop and save the Test. Run it once, then open the result and its screenshot.

Recording, saved Test replay, screenshots, and human review require no model.
Assisted exploration needs a configured provider only when you request it.

From a checkout, use ./bin/relay for the commands below. The MCP distribution
is a connector to a Relay server; installing it does not install the desktop
or native device prerequisites. Check the distribution README for setup.

For an existing server, list its available devices, then replace <serial> with
the device you chose and save its current screen. This captures evidence;
it does not assert that the app works.`,
    examples: [
      ["doctor"],
      ["device", "list", "--json"],
      ["device", "screenshot", "<serial>", "--file", "first-screen.png"],
    ],
  },
  {
    topic: "record",
    title: "Record a reusable Test",
    summary: "Keep setup, actions, and checks understandable.",
    markdown: `Open your App and select the intended Device or Browser/account.
Navigate to the starting screen before pressing Record. Record one journey
with a clear outcome, such as "Member opens billing".

Use the hover inspector to identify a control before clicking it. Give useful
screenshots names. Remove accidental actions during review. Before and After
show the evidence around the selected action.

An unchanged recording that reached its observed destination can be saved.
Edited actions need a successful Run before saving. A Run failure keeps the
recording available for repair. Set the Test's origin application when startup
must reopen the app; approved mapped paths prepare nested starting screens.

Save, then run the saved Test from its normal starting state. Saving alone
does not prove future runs. Keep the returned Test and App IDs for automation.`,
    examples: [["record", "<title>", "--device", "<serial>", "--map", "<app-id>", "--confirm"]],
  },
  {
    topic: "run",
    title: "Run saved coverage",
    summary: "Repeat the exact Test and configuration you selected.",
    markdown: `Run a saved Test directly. Choose its App and the intended device,
or a saved Lane for a browser/account configuration. Keep that configuration
through observation, execution, and review.

Use Run Across for explicitly selected data values and Browser/Account pairs.
An unavailable pair blocks the request; choosing a different device is a
separate decision. Do not infer that cookies isolate shared backend data.

Saved actions replay through Relay's existing runner. They do not silently
change into an assisted repair when a control disappears. Inspect a failure,
repair the Test deliberately, and rerun with fresh evidence.

Exit 0 means successful completion; 9 means the operation ran and failed;
10 means verification is incomplete and captures still need review. Other
nonzero exits describe setup, connection, authorization, or conflicts.`,
    examples: [
      ["run", "<test-id>", "--map", "<app-id>", "--device", "<serial>", "--json"],
      ["run", "<test-id>", "--map", "<app-id>", "--lane", "<lane-id>", "--json"],
    ],
  },
  {
    topic: "targets",
    title: "Choose a control safely",
    summary: "Preview a selector before it sends input.",
    markdown: `Capture the current screen and accessibility tree on the same
Device or Lane you will control. Prefer a stable identifier, then a unique
label, then text. A point belongs to the current image and viewport.

Use interact --preview to inspect the target without tapping. Remove --preview
only after its marked control is the one you intended. Two matching controls
need a narrower selector; never choose the first merely because it is first.

An unavailable tree does not mean the control is absent. Use the screenshot
and a previewed point when semantic inspection is unavailable. A snapshot ref
is local to an observation; it is not a portable saved selector. Refresh after
navigation or switching devices. Do not reuse another device's coordinates.`,
    examples: [
      ["device", "snapshot", "<serial>", "--json", "--full"],
      [
        "device",
        "interact",
        "<serial>",
        "--preview",
        "--file",
        "target-preview.png",
        "--input",
        '{"kind":"label","label":"Continue"}',
      ],
    ],
  },
  {
    topic: "waits",
    title: "Wait for an outcome",
    summary: "Use observable completion instead of a fixed pause.",
    markdown: `A screenshot staying unchanged proves neither completion nor
success. A stalled spinner can stay unchanged, and a finished video can move.

Wait for a result control or state that identifies completion. For a new Grok
reply, the Stop message control should disappear and a new Copy message control
should become available. An old result already on screen is insufficient.

Recording can infer a bounded completion wait when it observes an unambiguous
busy-to-ready transition in the same app. When that evidence is unavailable,
add a Wait or check manually with the required control and a timeout.
This uses the same runner and works without an agent or model.

A timeout is the maximum wait, not a sleep. Reaching it fails the condition.
Check the meaningful result after readiness; a ready button alone cannot prove
an image's quality, a video's resolution, or a download's persistence.`,
    examples: [],
  },
  {
    topic: "debug",
    title: "Diagnose a failed Run",
    summary: "Find the failed action, observed state, and permitted recovery.",
    markdown: `Open the Run result. Compare the expected outcome with the actual
screen at the failed step. Check startup, device/account identity, the target
control, and the required check before changing the Test.

Setup errors are not app defects. Missing screenshots stay missing. If Relay
reports an unknown mutation outcome, inspect its continuation before sending
more input; replaying blindly can repeat a payment, message, or deletion.

When another actor owns the device or an active Run reserves it, wait or use
the authorized cancellation path. Reconnect a degraded target rather than
restarting the server during an active recording or Run.

Export the existing result for another person or agent. Keep its Run ID, App,
Test revision, configuration, screenshots, and failed check together. A repair
creates a new attempt; the original failure remains available.`,
    examples: [
      ["inspect", "<run-or-workflow-id>", "--json"],
      ["export", "<run-id>", "--out", "./review", "--json"],
    ],
  },
  {
    topic: "review",
    title: "Review and share evidence",
    summary: "Keep captured, checked, and human-reviewed outcomes distinct.",
    markdown: `Open a result's screenshots and choose Looks correct, Report
issue, or Need more evidence for the exact image. Captures awaiting review
remain incomplete even if every interaction succeeded.

A human review decision is separate from accepting a visual baseline. Agents
may collect and summarize evidence; they cannot manufacture human approval.
Missing or blocked captures stay in the result so the reviewer sees the gap.

Export the result to hand it off. A screenshot proves visible state; saving,
sending, downloading, and other external effects need their relevant receipts.
The captured-app walkthrough is passive: it opens retained evidence, never
controls the connected phone.`,
    examples: [
      ["review", "--app", "<app-id>"],
      ["export", "<run-id>", "--out", "./review", "--json"],
    ],
  },
  {
    topic: "maps",
    title: "Understand the App Map",
    summary: "Use generated topology without authoring a second test library.",
    markdown: `The Test is the journey you want to repeat. The Map shows its
observed screens and connections. Both use the same canonical App Map state.

Reuse a logical screen across keyboard and focus states. Home with a keyboard
and Home without one usually belong to the same screen; captures preserve the
different moments. Shared titles alone do not establish that identity.

Consolidating duplicate screens rewires their connections and Tests. Compare
the captures and preview consolidation first, then replay the affected Test.
An unchanged screen after tapping a menu can be a toggle or an ineffective
tap; it must not automatically create a new navigation destination.

Use the map to inspect reachability and approved routes. Do not invent a path
from labels or a screenshot when the app's navigation has not been recorded.`,
    examples: [
      ["map", "list", "--json"],
      ["map", "get", "<app-id>", "--json"],
    ],
  },
  {
    topic: "agents",
    title: "Complete a task with an agent",
    summary: "Discover local contracts, act on one target, and return evidence.",
    markdown: `Read the relevant task guide before composing operation input.
CLI: relay guide <topic>. MCP: read relay://guides, then the listed guide URI.
These documents ship with this version and can be read without Relay running.

Discover the tools in the configured MCP profile. Use ordinary outcome tools
for record/run/inspect, or operator verbs for preview/tap/type. The operation
resource describes additional contracts; do not guess hidden schemas or switch
profiles as an ordinary task step.

For a saved Test, run it directly on the selected App and target. For discovery,
observe, preview the action, act, then inspect the fresh state. Keep actor and
target identity consistent. Bound assisted exploration and preserve failures.

Finish with the saved Test or Run identity, result, evidence, and concrete
remaining blocker. Unit tests and accepted requests do not prove that the
actual user journey worked. Human-only approvals remain with the human.`,
    examples: [],
  },
];

export const relayTaskGuideCatalog: readonly RelayTaskGuide[] = Object.freeze(guides);

export function relayTaskGuide(topic = "start"): RelayTaskGuide | undefined {
  return relayTaskGuideCatalog.find((guide) => guide.topic === topic);
}

export function formatRelayTaskGuide(guide: RelayTaskGuide): string {
  const examples = guide.examples.length
    ? `\n\nCommands (replace angle-bracket values):\n\n\`\`\`bash\n${guide.examples.map((argv) => `relay ${argv.map((arg) => (arg.startsWith("{") ? `'${arg}'` : arg)).join(" ")}`).join("\n")}\n\`\`\``
    : "";
  return `# ${guide.title}\n\n${guide.markdown}${examples}\n\nMore tasks: relay guide\n`;
}
