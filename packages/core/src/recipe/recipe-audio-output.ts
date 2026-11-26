import { mkdir, open, realpath, unlink } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import type { RecipeStep } from "../recipes.js";
import type { Device } from "../device/device.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import { browserSessionForDevice } from "../browser/browser-live-handles.js";
import { activePage } from "../browser/browser-target.js";
import { browserAccountSchedulingKey } from "../browser/browser-account-lane.js";
import { runBrowserMutationAdmission } from "../browser/browser-mutation-admission.js";
import { getEvidenceCollectionPolicy } from "../evidence/evidence-policy.js";
import { assertAudioOutputConsent, recordHtmlMediaAudio } from "../browser/browser-audio-output.js";
import { measureAudioOutput } from "../audio-output-level.js";
import { inspectMedia } from "../media/media-check.js";

/** This check proves sound in a selected HTML media stream, not speech correctness or speaker hardware. */
export async function runAudioRecordStep(
  device: Device,
  step: Extract<RecipeStep, { kind: "audio-record" }>,
  ctx: RecipeStepContext,
): Promise<void> {
  const job = ctx.job;
  if (!job) throw new Error("audio-record requires a Run with frozen audio consent");
  const assertConsent = () =>
    assertAudioOutputConsent(job.evidencePolicy, getEvidenceCollectionPolicy());
  assertConsent();
  const session = browserSessionForDevice(device);
  if (!session)
    throw new Error(
      "audio-record supports browser HTML audio/video only; native, WebAudio and speech synthesis output are unsupported",
    );
  if (!/^[A-Za-z0-9_-]+$/.test(job.id)) throw new Error("audio-record invalid Run identity");
  const name = basename(step.file);
  if (!name || name === "." || name === ".." || step.file.startsWith("fixture:"))
    throw new Error("audio-record requires an output filename");
  if (!job.runDir) throw new Error("audio-record requires a Run evidence directory");
  const root = await realpath(job.runDir);
  const directory = resolve(root, "artifacts", "audio");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const actual = await realpath(directory);
  const local = relative(root, actual);
  if (isAbsolute(local) || local === ".." || local.startsWith("../"))
    throw new Error("audio-record output must stay inside its Run");
  const file = resolve(actual, name);
  // Reserve the exact artifact without clobbering prior proof or following a symlink.
  const handle = await open(file, "wx", 0o600);
  try {
    const bytes = await runBrowserMutationAdmission(
      browserAccountSchedulingKey(
        session.targetId,
        session.profile.authenticationFixtureId,
        session.unsignedLaneId,
      ),
      async () => recordHtmlMediaAudio(await activePage(session), step.target, step.durationMs),
    );
    assertConsent();
    await handle.writeFile(bytes);
    await handle.sync();
    assertConsent();
  } catch (error) {
    await handle.close();
    await unlink(file);
    throw error;
  }
  await handle.close();
  const artifact = {
    kind: "audio-record",
    capturedAt: Date.now(),
    data: {
      stepId: step.id,
      file: step.file,
      path: relative(root, file),
      scope: "html-media-element",
      observationWindowMs: step.durationMs,
      limitation:
        "Does not capture WebAudio, speech synthesis, other elements, or verify speaker hardware.",
    },
  };
  job.artifacts.push(artifact);
  ctx.artifacts?.push(artifact);
  const download = {
    kind: "download",
    capturedAt: Date.now(),
    data: { file: step.file, path: relative(root, file), stepId: step.id },
  };
  job.artifacts.push(download);
  ctx.artifacts?.push(download);
  const facts = await inspectMedia(file, job.projectId, job.runDir);
  const levels = await measureAudioOutput(file);
  const analysis = {
    kind: "audio-output-analysis",
    capturedAt: Date.now(),
    data: { file: step.file, ...facts, ...levels },
  };
  job.artifacts.push(analysis);
  ctx.artifacts?.push(analysis);
  if (!facts.hasAudio || levels.durationMs < 100 || levels.rms < 0.001)
    throw new Error(
      "audio-record detected silence or insufficient accessible audio; this is not a passing voice-output check",
    );
  ctx.log(
    `Recorded audible HTML media output (${Math.round(levels.durationMs)} ms decoded). WebAudio and speech synthesis are not covered.`,
  );
}
