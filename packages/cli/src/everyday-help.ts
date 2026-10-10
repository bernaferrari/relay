/** Help for the everyday verbs, and the exit-code table every surface shares. */

export const everydayExitCodes = `Exit codes:
  0  passed / success
  1  a Test failed: the product did not do what the Test expects (relay run, relay ci)
  2  usage: bad arguments or unknown command
  3  could not run: Relay was blocked (device, sign-in, harness), had no ready Test,
     or the server was unreachable
  4  auth (401/403)
  5  validation: malformed input
  6  conflict: the device is in use, or the app changed underneath the command
  7  cancelled (Ctrl-C)
  8  server error
  9  another command ran and reported failure
  10 the Test passed but screenshots are awaiting review
  11 not found: no App, Test, Run, or device with that name`;

export const projectConfigHelp = `Project defaults (relay.json in the directory you run relay from):
  {"app": "Shop", "device": "ios", "url": "https://shop.example.com"}
  app and device apply to run, ci, tests, and record; url applies to new.`;

const usage: Record<string, string> = {
  new: `relay new "<what should work>" [--url <website>] [--app <name>] [--name <test name>]
relay new --file <test.yaml>

Describe what should work in plain English; Relay writes the steps and saves
the Test. Give --url for a website (the app is created on first use) or --app
for an existing app. --file saves a test file as written. Also spelled: relay test new.

Examples:
  relay new "Add a shirt to the cart and check the total" --url https://shop.example.com
  relay new "Sign in and open settings" --app Shop`,
  ci: `relay ci [<app> | <folder of test files>] [--test <name>]... [--device ios|android|browser|<name>]
         [--output result.json] [--junit junit.xml] [--json]

Runs every ready Test of the app one after another (or only the --test ones),
waits for each, and prints one table. Tests that are not ready yet are listed
as skipped and do not fail the build.

--output writes {totals, verdicts, skipped}; each verdict has status, summary,
and every step's expected and saw. --junit writes JUnit XML for CI dashboards.
Paths are relative to the directory you run relay from.

Exit codes: 0 every Test passed, 1 at least one failed, 3 none failed but
something could not run (blocked, cancelled, or no ready Test).

Given a folder (or one .yaml file), Relay saves those test files first and
runs exactly those Tests.

Examples:
  relay ci relay/tests --output result.json --junit junit.xml
  relay ci shop --output result.json --junit junit.xml
  relay ci shop --test "Checkout works" --device android`,
  apply: `relay apply <test.yaml | folder>

Saves test files (and every .yaml under a folder). A file looks like:

  name: Create an API key
  url: https://shop.example/settings
  steps:
    - Open the API keys page
    - Create a new API key
    - check: The new key is listed

Plain text is an Action, check: is a Check. The same name (or id:) updates the
Test in place and keeps recorded steps whose words did not change.`,
  show: `relay show "<test name>" [--app <name>]

Prints a Test as its file, ready to save in your repo.`,
  apps: `relay apps

Lists your apps with their number of Tests. Also spelled: relay app list.`,
  tests: `relay tests [<app>]

Lists the app's Tests and whether each is ready to run.`,
  runs: `relay runs [<app>]

Lists the 20 most recent runs (newest first), optionally for one app.`,
  devices: `relay devices

Lists connected phones, simulators, emulators, and browsers. Pass the name,
id, or just ios / android / browser to --device.`,
  version: `relay --version

Prints the CLI version.`,
};

export function everydayHelpTopics(): string[] {
  return Object.keys(usage);
}

export function renderEverydayHelp(verb: string): string {
  return `Usage:\n  ${usage[verb] ?? ""}\n\n${projectConfigHelp}\n\n${everydayExitCodes}\n`;
}
