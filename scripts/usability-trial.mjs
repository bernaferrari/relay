/** Facilitator setup only. The participant records and reviews through Relay. */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { listenSeededMemberApp } from "../packages/core/src/seeded-member-app.ts";

export async function prepareUsabilityTrial({
  port = 8793,
  webUrl = process.env.RELAY_APP_URL ?? "http://localhost:3001",
  outputDirectory,
} = {}) {
  const trialId = `trial-${randomUUID()}`;
  const output = resolve(outputDirectory ?? ".relay/usability-trials", trialId);
  const web = new URL(webUrl);
  if (!/^https?:$/u.test(web.protocol))
    throw new Error("Use the Relay web URL, including http:// or https://.");
  const page = await fetch(web, { signal: AbortSignal.timeout(5_000) }).catch(() => undefined);
  if (!page?.ok || !/<title>\s*Relay\s*<\/title>/iu.test(await page.text()))
    throw new Error(
      `Relay web app is unavailable at ${web}. Set RELAY_APP_URL or --web-url to its actual address.`,
    );
  const fixture = await listenSeededMemberApp({ port, defect: true, secret: randomUUID() });
  const entry = new URL(web);
  // An explicit empty account selects a fresh Guest context rather than a
  // remembered login from another local fixture on the same hostname.
  entry.hash = `/tests/new?site=${encodeURIComponent(fixture.url)}&account=`;
  let sourceRevision;
  let sourceWorkingTreeDirty;
  try {
    sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    sourceWorkingTreeDirty =
      execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() !== "";
  } catch {
    /* Installed host may not contain Git. */
  }
  const manifest = {
    schemaVersion: 1,
    trialId,
    status: "awaiting-participant",
    ...(sourceRevision ? { sourceRevision } : {}),
    ...(sourceWorkingTreeDirty !== undefined ? { sourceWorkingTreeDirty } : {}),
    preparedAt: new Date().toISOString(),
    websiteUrl: fixture.url,
    entryUrl: entry.toString(),
    facilitatorControlUrl: new URL("/control/defect", fixture.url).toString(),
    expectedSeats: { member: 4, admin: 99, "signed-out": null },
    initialDefect: "Member Settings shows 5 team seats instead of 4",
    firstUsefulTestGoalSeconds: 120,
    participantObserved: false,
    observations: [],
    testIds: [],
    runIds: [],
    visualDecisions: [],
  };
  try {
    await mkdir(output, { recursive: true });
    await writeFile(resolve(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(
      resolve(output, "participant.md"),
      `# Relay exercise\n\nWebsite: ${fixture.url}\n\n1. Open the website as Member and navigate around before recording. Create a reusable test that opens Member settings. Save a screenshot with a useful name, then run your test again.\n2. Remove one accidental step and save the correction. Leave your work, return to it, and find its screenshots.\n3. Member should have 4 team seats; Admin should have 99. Signed out should show Sign in. Report any mismatch you find.\n4. After the facilitator repairs the website, rerun and review it. Explain which account produced each screenshot and what has been approved.\n5. Reopen Relay and find the saved test and report. Export the evidence you would send a teammate.\n\nUse Relay's interface. Ask for help whenever you need it; help is recorded as an observation, not a failure hidden from the results.\n`,
    );
    await writeFile(
      resolve(output, "facilitator.md"),
      `# Facilitator notes\n\nThis setup is ready for an actual participant; it is not a usability result. Give participant.md to a QA person who has not built Relay. Open ${entry} with the website prefilled. Confirm the Relay connection before starting the timer.\n\nRecord connectionReadyAt, firstSavedTestAt and firstRepeatFinishedAt in observations.json. The declared first useful Test goal is 120 seconds after connection. Record every intervention, wrong turn and misunderstood label. Do not teach App Map, workflow IDs, or internal vocabulary. Keep Test, Run, account, device and screenshot identities with each observation.\n\n## Defect and repair\n\nMember Settings intentionally shows 5 seats instead of the required 4; Admin should show 99. Let the participant find and report the issue before repair. Repair only this fixture with POST ${manifest.facilitatorControlUrl} and JSON {"on":false}. Rerun through Relay and retain the original defect evidence and pending decisions. The repair endpoint does not approve screenshots or alter Tests.\n\n## Full acceptance remains separate\n\nBefore bulk review, collect a fresh declared 30-slot set across Admin, Member and Signed out using the canonical Tests/Accounts/Run Across workflow. Preserve missing and blocked slots. This launcher does not pre-record those Tests, silently substitute accounts or create approvals.\n\nObserve recovery from an actual expired-account or missing-screenshot interruption using a disposable prepared case; do not delete retained evidence to manufacture failure. If the case cannot be prepared, record that stage as blocked. Reopen Relay and export the same retained result after other active jobs finish; never restart a server under an unrelated live Plan.\n\nFinish by recording which tasks were completed unassisted and which needed help. The human acceptance gate stays open until these observations exist. Agent tests and synthetic human actors are not participant evidence.\n`,
    );
    await writeFile(
      resolve(output, "observations.json"),
      `${JSON.stringify(
        {
          trialId,
          participantObserved: false,
          connectionReadyAt: null,
          firstSavedTestAt: null,
          firstRepeatFinishedAt: null,
          interruptedAt: null,
          recoveredAt: null,
          tasks: [],
          assistance: [],
          misunderstoodLabels: [],
          evidenceIds: [],
          exportPaths: [],
          notes: [],
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    fixture.server.closeAllConnections();
    await new Promise((done) => fixture.server.close(done));
    throw error;
  }
  return {
    manifest,
    output,
    close: () =>
      new Promise((done) => {
        fixture.server.closeAllConnections();
        fixture.server.close(done);
      }),
  };
}

async function main() {
  const options = {};
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--help") {
      console.log(
        "Usage: node --import tsx scripts/usability-trial.mjs [--port 8793] [--web-url http://localhost:3001] [--output .relay/usability-trials]. RELAY_APP_URL overrides the default web URL.",
      );
      return;
    }
    const value = args[++index];
    if (!value) throw new Error(`Missing value for ${flag}`);
    if (flag === "--port" && /^\d+$/u.test(value) && Number(value) > 0 && Number(value) <= 65_535)
      options.port = Number(value);
    else if (flag === "--web-url") options.webUrl = value;
    else if (flag === "--output") options.outputDirectory = value;
    else throw new Error(`Unknown or invalid option ${flag}`);
  }
  const trial = await prepareUsabilityTrial(options);
  console.log(
    `Participant entry: ${trial.manifest.entryUrl}\nWebsite: ${trial.manifest.websiteUrl}\nHandout and observation files: ${trial.output}\n\nFacilitator repair: POST ${trial.manifest.facilitatorControlUrl} with {"on":false}\n\nThe fixture stays running. Press Ctrl+C after the trial. No participant result or visual approval has been recorded.`,
  );
  await new Promise((done) => {
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
  await trial.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
