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
For the executable record, check, save, and repeat sequence, read relay guide
record (MCP: relay://guides/record). The first recording can create its App Map.

From a checkout, use ./bin/relay for the commands below. The MCP distribution
is a connector to a Relay server; installing it does not install the desktop
or native device prerequisites. For an agent's first recording or saved Test,
configure relay-mcp --profile qa and the intended service or workspace. Check
relay-mcp doctor --profile qa with those same connection options. Then call
relay_health and relay_panel to find an App and its saved Tests. The panel
returns text when the host cannot render it. Check the distribution README
for installation and prerequisites.

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
    summary: "Record actions, check the outcome, save, and repeat with evidence.",
    markdown: `Record one short journey with an observable result. The mobile
example below starts on Home, opens Sidebar, then opens Settings. Replace the
menu and Settings-only labels with unique controls observed on your own phone;
these are selector examples, not a prebuilt Test or known screen identity.

1. Choose the intended Device and app, navigate to Home, and inspect its screen.
   Preview the menu target before sending input. In desktop, use the inspector.
2. Start Record. With no App Maps, Relay creates one; with one, it reuses it.
   With several, choose the intended App using --map <app-id>. Keep the returned
   result.authoring.sessionId and result.frozen.appMapId; replace the matching
   placeholders below. Wait for stage: recording before adding actions.
3. Record the menu tap. Inspect the fresh Sidebar and preview its Settings
   target, then record that tap. Add the bounded wait-for check for a control
   unique to the intended Settings screen, followed by a named screenshot.
   A check passes when its control is found; timeoutMs is the maximum wait.
   Choose a result state that proves your task finished. A fixed pause or an
   unchanged screenshot cannot establish completion.
4. Stop, then inspect the full session and its Before/After evidence. Continue
   when state: reviewing and the recorded actions/checks show the intended
   journey. An unchanged recording that reached its observed destination may
   be committed directly. After edits, return to the source screen and replay
   that exact revision before saving:

   \`\`\`bash
   relay session replay <session-id> --json
   relay session get <session-id> --json
   \`\`\`

   Inspect the replay result in the session. Commit only when the replay passed;
   if it failed or is incomplete, fix the recording and replay the new revision.
   Commit with createTest: true to save a reusable Test. Successful save returns
   state: committed, session.committedTestId and session.committedConnectionId.
5. Confirm that Test ID in test list and inspect its saved connection. Return
   the same device to Home, then run the exact saved Test. The result includes
   \`workflow.workflowId\` and \`execution.runId\`: inspect with the workflow ID
   until it has completed or reports a concrete blocker, and export with the
   Run ID. Run the same command again from Home when a second repeat is
   requested. Saving alone proves no repeat.

Commands below are the CLI sequence for an unchanged recording. Read each
result before continuing; IDs come from Relay, and selectors come from the
current screen. Keep the same server, workspace, actor, and device throughout.
The saved Test needs an executable startup: set the origin application in
desktop (MCP: originApplication) when it must reopen the app; approved mapped
paths prepare nested starting screens. A blocker needs deliberate repair.

MCP with profile qa follows the same sequence: relay_connect_target with
targetKind: device, relay_observe_target, then relay_record_test with title and
the chosen targetId (appMapId is optional under the same selection rules).
Record sends control only with transport confirm: true. Copy workflowId and
numeric expectedVersion from the returned workflow into each following call,
and refresh them after every mutation. relay_record_action accepts the same
interaction objects shown in session interact --input below. Use relay_preview
with serial and the observed label to preview a selector; relay_add_checkpoint
names a screenshot.

Call relay_stop_recording and inspect through relay_inspect_workflow. For an
edited revision, replay only when \`replay\` is in \`allowedNextActions\`, using the
latest workflow version returned by the preceding mutation. For example:

\`\`\`json
{"workflowId":"recording-workflow-id","expectedVersion":3}
\`\`\`

Call relay_replay_recording with that payload, replacing the workflow ID and
numeric version with the latest values from Relay. Then call
relay_inspect_workflow with \`{"workflowId":"recording-workflow-id"}\` to inspect
the replay result. Call relay_approve_recording with transport confirm: true
only after the replay passed and \`approve\` is in \`allowedNextActions\`. For an
unchanged recording, follow the allowed next action without an extra replay.
Read the saved Test resource returned by relay_panel for the App, run it with
relay_run_test, and inspect its workflow. In the result, pass
\`workflow.workflowId\` to relay_inspect_workflow and \`execution.runId\` to
relay_export_evidence. These IDs serve different calls. Follow the evidence
references for handoff. Human review of an image remains a human decision. An
uncertain mutation outcome requires inspection before more input.`,
    examples: [
      ["connect", "<serial>", "--json"],
      ["device", "snapshot", "<serial>", "--json", "--full"],
      [
        "device",
        "interact",
        "<serial>",
        "--preview",
        "--file",
        "menu-preview.png",
        "--input",
        '{"kind":"label","label":"<menu-label>"}',
      ],
      ["record", "home-settings", "--device", "<serial>", "--confirm", "--json"],
      [
        "session",
        "interact",
        "<session-id>",
        "--input",
        '{"interaction":{"kind":"tap","target":{"label":"<menu-label>"}}}',
        "--json",
      ],
      ["device", "snapshot", "<serial>", "--json", "--full"],
      [
        "device",
        "interact",
        "<serial>",
        "--preview",
        "--file",
        "settings-preview.png",
        "--input",
        '{"kind":"label","label":"Settings"}',
      ],
      [
        "session",
        "interact",
        "<session-id>",
        "--input",
        '{"interaction":{"kind":"tap","target":{"label":"Settings"}}}',
        "--json",
      ],
      [
        "session",
        "interact",
        "<session-id>",
        "--input",
        '{"interaction":{"kind":"steps","label":"Settings ready","steps":[{"kind":"wait-for","target":{"label":"<settings-only-label>"},"timeoutMs":10000}]}}',
        "--json",
      ],
      [
        "session",
        "screenshot",
        "<session-id>",
        "--input",
        '{"interaction":{"label":"Settings result"}}',
        "--json",
      ],
      ["session", "stop", "<session-id>", "--json"],
      ["session", "get", "<session-id>", "--json"],
      [
        "session",
        "commit",
        "<session-id>",
        "--input",
        '{"createTest":true}',
        "--confirm",
        "--json",
      ],
      ["test", "list", "<app-id>", "--json"],
      ["connect", "get", "<app-id>", "<connection-id>", "--json"],
      ["run", "<test-id>", "--map", "<app-id>", "--device", "<serial>", "--json"],
      ["inspect", "<workflow-id>", "--json"],
      ["export", "<run-id>", "--out", "./review", "--json"],
      ["review", "--app", "<app-id>"],
    ],
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
an image's quality, a video's resolution, or a download's persistence.

While recording, use the session interact command below (MCP:
relay_record_action with the same interaction). Replace both labels from the
current operation: the result label must identify its new result. Read relay
guide record for obtaining the session ID and for stop, save, repeat, and review.`,
    examples: [
      [
        "session",
        "interact",
        "<session-id>",
        "--input",
        '{"interaction":{"kind":"steps","label":"Result ready","steps":[{"kind":"expect","target":{"label":"<busy-label>"},"condition":"gone","timeoutMs":30000},{"kind":"wait-for","target":{"label":"<new-result-label>"},"timeoutMs":30000}]}}',
        "--json",
      ],
    ],
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

For a new MCP connection, configure relay-mcp --profile qa and the intended
service or workspace. Run relay-mcp doctor --profile qa with the same connection
options. Discover the tools in that configured profile. Existing operator or
specialist connections keep their own contracts; use their exposed tools.

With QA, call relay_health and relay_panel to choose an App, then call the panel
with its appMapId to find saved Tests. Read the returned Test's resource URI for
its steps. Select the ready target through relay_connect_target, then run the
exact saved Test with relay_run_test. Keep the returned workflow identity and
inspect it through relay_inspect_workflow until completion or a concrete blocker.
The panel returns text when the host cannot render it.

When coverage is missing, read relay://guides/record for the complete action,
check, stop, save, and repeat sequence. The first relay_record_test can create
its App Map. Each following mutation uses workflowId and numeric
expectedVersion from the latest returned workflow, subject to allowedNextActions.
The configured tools describe their input contracts; read those schemas before
acting. Use relay_connect_target with targetKind: device to select only phones;
phase: android or ios further narrows that choice.

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
