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
    title: "Write and run your first Test",
    summary: "Describe what should work, run it, read the verdict.",
    markdown: `Relay turns a sentence into a Test, runs it on a browser or device,
and tells you whether it passed — with the failing step, what it expected,
what it saw, and a screenshot.

1. Describe what should work, e.g. "Sign in and see the dashboard", with the
   website address or the App. Relay writes Action and Check steps and saves
   the Test (read relay guide describe; MCP: relay_get_guide describe).
2. Run it. The result is one verdict: passed, failed, blocked or cancelled.
3. When a step must be exact, or must run without a model, record it (relay
   guide record). Recorded steps, saved replay, screenshots and human review
   need no model; steps written from words need a model key (OPENROUTER_API_KEY
   or one saved in Settings).

From a checkout, use ./bin/relay for the commands below: describe a Test,
run it on a browser (or ios, android, a device name), then run every ready
Test of the app the way CI does. relay ci writes result.json for your pipeline.

The MCP distribution is a connector to a Relay server; installing it does not
install the desktop or native device prerequisites. For an agent, configure
relay-mcp (qa is the default profile) with the intended service or workspace,
and check it with relay-mcp doctor --profile qa. Then call relay_health,
relay_create_test, and relay_run_test, which waits for the verdict.
relay_list_apps and relay_list_tests show existing Apps and Tests.`,
    examples: [
      ["new", "Sign in and see the dashboard", "--url", "http://localhost:3000"],
      ["run", "Sign in and see the dashboard", "--device", "browser"],
      ["ci", "--output", "result.json"],
    ],
  },
  {
    topic: "describe",
    title: "Write a Test from a description",
    summary: "One sentence becomes saved Action and Check steps you can run.",
    markdown: `Say what should work in plain English: one sentence, or one step per
line. Give the website address for a web app, or the App's id or name when it
already exists. Relay drafts Action steps (what to do) and Check steps (what
must be true), finds or creates the App, and saves the Test.

Run it right away. Actions are carried out by a model reading the screen, and
Checks are judged against what Relay sees, so running needs a model key
(OPENROUTER_API_KEY or one saved in Settings). Without a model, Relay splits
your lines into steps but cannot run them until you record them.

Read the verdict: passed, failed, blocked or cancelled, a one-line reason, and
for a failed step what it expected, what it saw, and a screenshot. A failed
Check is a finding about the app or the description — fix the code, or edit
the step's words, then run again.

A Test is also a small file you can keep in your repo and edit by hand:

  name: Create an API key
  url: https://shop.example/settings
  steps:
    - Open the API keys page
    - Create a new API key
    - check: The new key is listed

Plain text is an Action, check: is a Check. Applying the file again with the
same name (or id:) updates the Test in place and keeps any recorded step whose
words did not change. Copy any Test as its file from the app's test menu.

When a step must be exact, fast, or model-free, record it (relay guide record).
Recording replaces guessing with the taps you made and the checks you added.

MCP (qa): relay_create_test {goal, url | app} or {yaml} returns the Test and the exact
relay_run_test call. relay_run_test waits for the verdict by default; pass
wait:false to return at once and read it later with relay_get_verdict {runId}.
After a code change, relay_check_change runs the App's relevant ready Tests and
returns their verdicts. It is a quick signal; merge decisions use the gated
Proof flow.`,
    examples: [],
  },
  {
    topic: "record",
    title: "Record a reusable Test",
    summary: "Record actions, check the outcome, save, and repeat with evidence.",
    markdown: `Recording makes a Test exact and model-free; to start from a sentence,
read relay guide describe. Record one short journey with an observable result. The mobile
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
   relay recording replay <session-id> --json
   relay recording get <session-id> --json
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

MCP with profile device follows the same sequence: relay_list_devices with
targetKind: device, relay_observe_target, then relay_record_test with title and
the chosen targetId (appMapId is optional under the same selection rules).
Record sends control only with transport confirm: true. Copy workflowId and
numeric expectedVersion from the returned workflow into each following call,
and refresh them after every mutation. relay_record_action accepts the same
interaction objects shown in recording interact --input below. Use relay_preview
with targetId and the observed label to preview a selector; relay_add_checkpoint
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
Find the saved Test with relay_list_tests for the App, then run it
with relay_run_test, which waits and returns its verdict with \`runId\` and
\`workflow\`. Pass \`workflow.workflowId\` to relay_inspect_workflow and the
\`runId\` to relay_get_verdict or relay_export_evidence. These IDs serve
different calls. Follow the evidence
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
        "recording",
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
        "recording",
        "interact",
        "<session-id>",
        "--input",
        '{"interaction":{"kind":"tap","target":{"label":"Settings"}}}',
        "--json",
      ],
      [
        "recording",
        "interact",
        "<session-id>",
        "--input",
        '{"interaction":{"kind":"steps","label":"Settings ready","steps":[{"kind":"wait-for","target":{"label":"<settings-only-label>"},"timeoutMs":10000}]}}',
        "--json",
      ],
      [
        "recording",
        "screenshot",
        "<session-id>",
        "--input",
        '{"interaction":{"label":"Settings result"}}',
        "--json",
      ],
      ["recording", "stop", "<session-id>", "--json"],
      ["recording", "get", "<session-id>", "--json"],
      [
        "recording",
        "commit",
        "<session-id>",
        "--input",
        '{"createTest":true}',
        "--confirm",
        "--json",
      ],
      ["test", "list", "<app-id>", "--json"],
      ["map", "connection", "get", "<app-id>", "<connection-id>", "--json"],
      ["run", "<test-id>", "--app", "<app-id>", "--device", "<serial>", "--json"],
      ["inspect", "<workflow-id>", "--json"],
      ["export", "<run-id>", "--out", "./review", "--json"],
      ["review", "--app", "<app-id>"],
    ],
  },
  {
    topic: "run",
    title: "Run saved Tests",
    summary: "Run a Test by name on the device you choose and read its verdict.",
    markdown: `Run a saved Test by its name. Say which app when the name is not
unique, and which device: ios, android, browser, a device name, or an id. A
relay.json in your project can supply both defaults.

Relay prints each step's result and one verdict: passed, failed, or blocked.
A failed step shows what it expected, what Relay saw, and a screenshot. Keep
the same device while you run and review; trying another device is a separate
run, not a retry.

To run every ready Test of an app, after a change or in CI, use relay ci. It
prints one verdict per Test and writes --output result.json (and --junit) for
your pipeline.

Recorded steps replay exactly; steps written in words are carried out by a
model reading the screen. A missing control never silently turns into a
guess: inspect the failure, fix the app or the Test deliberately, and run
again with fresh evidence.

Exit codes: 0 passed; 1 a Test failed (the app did not do what the Test
expects); 3 Relay could not run it (device, sign-in, or setup, not an app
defect); 10 passed, with screenshots waiting for review. Other nonzero codes
describe usage, authorization, or conflicts; relay help lists them.

Data values, several devices or accounts, and schedules are Plan options; see
relay help advanced.`,
    examples: [
      ["run", "<test>", "--app", "<app>", "--device", "<device>"],
      ["run", "<test>", "--app", "<app>", "--device", "<device>", "--out", "./evidence"],
      ["ci", "<app>", "--output", "result.json"],
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

Wait for a result control or state that identifies completion. For a new chat
reply, the Stop control should disappear and a new Copy control should become
available. An old result already on screen is insufficient.

Recording can infer a bounded completion wait when it observes an unambiguous
busy-to-ready transition in the same app. When that evidence is unavailable,
add a Wait or check manually with the required control and a timeout.
This uses the same runner and works without an agent or model.

A timeout is the maximum wait, not a sleep. Reaching it fails the condition.
Check the meaningful result after readiness; a ready button alone cannot prove
an image's quality, a video's resolution, or a download's persistence.

While recording, use the recording interact command below (MCP:
relay_record_action with the same interaction). Replace both labels from the
current operation: the result label must identify its new result. Read relay
guide record for obtaining the session ID and for stop, save, repeat, and review.`,
    examples: [
      [
        "recording",
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
      ["apps", "--json"],
      ["map", "get", "<app-id>", "--json"],
    ],
  },
  {
    topic: "agents",
    title: "Complete a task with an agent",
    summary: "Discover local contracts, act on one target, and return evidence.",
    markdown: `Read the relevant task guide before composing operation input.
CLI: relay guide <topic>. MCP: call relay_get_guide, then with the topic.
These documents ship with this version and can be read without Relay running.

For a new MCP connection, configure relay-mcp (qa is the default profile) and
the intended service or workspace. Run relay-mcp doctor --profile qa with the
same connection options. The device profile adds live device control and
recording; full adds every raw operation.

Describe first. Call relay_health, then relay_list_apps and relay_list_tests
to see existing Apps and Tests so you do not write a duplicate. To cover
something new, call relay_create_test with a sentence and the url or app; it
saves the Test and returns the exact relay_run_test call. relay_run_test waits
and returns one verdict: passed or failed, the failing step's expected vs. saw,
a screenshot. Use relay_list_devices first when several targets are ready, and
pass its targetId. A wait that runs out returns status running; read it later
with relay_get_verdict. On a failure, relay_inspect_failure adds evidence.

After changing code, call relay_check_change with the App (and the changed
areas or Test ids when you know them). It runs the relevant ready Tests and
returns their verdicts — a quick signal for you, not a merge decision; gated,
human-approved merge checks use the Proof flow in the full profile.

Steps written from words need a model key. When a step must be exact or
model-free, record it with the device profile: relay_get_guide record covers
the action, check, stop, save, and repeat sequence. Each recording mutation
uses workflowId and numeric expectedVersion from the latest returned workflow,
subject to allowedNextActions. Use relay_list_devices with targetKind: device
to select only phones; phase: android or ios further narrows that choice.

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
