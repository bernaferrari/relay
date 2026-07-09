/**
 * Recipe step executor — thin glue over the device.ts helpers.
 *
 * One function, one switch per step kind. Cancel propagates as
 * JobCancelledError (rethrown, not swallowed by strategy fallbacks or retries).
 * The pause step drives the same cooperative pause/resume mechanics the job
 * engine uses: it sets job.status="paused" so `POST /jobs/:id/resume`
 * (resumeJob) unblocks the checkpoint.
 */
import type { Device } from "./device.js";
import {
  pressRef,
  pressLabel,
  findClick,
  pressPoint,
  typeText,
  pressKey,
  scrollDown,
  sleep,
  swipeGesture,
  waitFor,
  exists,
  base,
} from "./device.js";
import { cooperativeCheckpoint, raceCancel, throwIfCancelled, requestPause } from "./control.js";
import { publish, now } from "./events.js";
import { runAction, isActionId } from "./actions.js";
import { captureScreenshot } from "./workspace.js";
import { describeTarget, type RecipeStep, type StepTarget } from "./recipes.js";
import type { TestJob } from "./session.js";

export type RecipeStepContext = {
  log: (line: string) => void;
  /**
   * Owning job. Required for `pause` steps (drives job.status + resume
   * checkpoint) and used to attach `screenshot` frames to a run. Standalone
   * single-step execution (no job, e.g. server's POST /step/run) omits it —
   * `pause` throws in that case (rejected upstream) and `screenshot` simply
   * captures without attaching to a job.
   */
  job?: TestJob;
};

function isCancel(err: unknown): boolean {
  return err instanceof Error && err.name === "JobCancelledError";
}

/**
 * Try each present target strategy in robustness order; log + continue on
 * failure, rethrow cancel immediately, throw when none succeed.
 */
async function tapTarget(
  device: Device,
  target: StepTarget,
  log: (line: string) => void,
): Promise<void> {
  const attempts: { strategy: string; run: () => Promise<void> }[] = [];
  if (target.ref) attempts.push({ strategy: "ref", run: () => pressRef(device, target.ref!) });
  if (target.label)
    attempts.push({ strategy: "label", run: () => pressLabel(device, target.label!) });
  if (target.text) attempts.push({ strategy: "text", run: () => findClick(device, target.text!) });
  if (target.point) {
    const p = target.point;
    attempts.push({ strategy: "point", run: () => pressPoint(device, p.x, p.y) });
  }
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i]!;
    try {
      await a.run();
      return;
    } catch (err) {
      if (isCancel(err)) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (i === attempts.length - 1) {
        throw new Error(`tap failed: no strategy matched (${describeTarget(target)})`);
      }
      log(`tap: ${a.strategy} failed (${msg}) — trying next`);
    }
  }
}

/** Scroll up — mirrors scrollDown but via the SDK's direction field. */
async function scrollUp(device: Device, amount = 0.5): Promise<void> {
  await cooperativeCheckpoint();
  throwIfCancelled();
  await raceCancel(device.interactions.scroll({ ...base(), direction: "up", amount }));
}

const MAX_WAIT_MS = 15 * 60 * 1000;
const DEFAULT_EXPECT_TIMEOUT_MS = 5000;

/**
 * True when the error signals a genuine "element not there / condition unmet"
 * outcome — the SDK's find throws "No match", the wait command and our own
 * poll loops throw timeout-phrased errors. Anything else (no device, adb,
 * session binding, connection failures) is infrastructure and must keep its
 * original message instead of being converted into an assertion failure.
 */
function isNotFoundOrTimeout(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\bno match\b|timed out|timeout/i.test(msg);
}

/**
 * True if the target's ref/label/text strategy currently resolves. Unlike the
 * `exists` helper (which swallows every non-cancel error as `false`),
 * infrastructure failures propagate with their original message — only a
 * genuine "No match" reads as absent, so `expect ... gone` cannot pass just
 * because the device went away.
 */
async function targetPresent(device: Device, target: StepTarget): Promise<boolean> {
  const query = target.ref
    ? target.ref.startsWith("@")
      ? target.ref
      : `@${target.ref}`
    : (target.label ?? target.text);
  if (!query) return false;
  try {
    await cooperativeCheckpoint();
    throwIfCancelled();
    await raceCancel(device.interactions.find({ ...base(), query, action: "exists", first: true }));
    return true;
  } catch (err) {
    if (isCancel(err)) throw err;
    if (isNotFoundOrTimeout(err)) return false;
    throw err;
  }
}

export async function runRecipeStep(
  device: Device,
  step: RecipeStep,
  ctx: RecipeStepContext,
): Promise<void> {
  const { log, job } = ctx;
  switch (step.kind) {
    case "tap":
      await tapTarget(device, step.target, log);
      break;

    case "type": {
      if (step.target) await tapTarget(device, step.target, log);
      await typeText(device, step.text);
      break;
    }

    case "scroll":
      if (step.direction === "down") {
        await scrollDown(device, step.amount);
      } else {
        await scrollUp(device, step.amount);
      }
      break;

    case "swipe": {
      const { from, to, durationMs } = step;
      await swipeGesture(device, from, to, durationMs ?? 250);
      break;
    }

    case "key":
      await pressKey(device, step.key);
      break;

    case "sleep":
      await sleep(step.ms, device);
      break;

    case "screenshot":
      await captureScreenshot({ jobId: job?.id, caption: step.caption, device });
      break;

    case "wait-for": {
      const target = step.target;
      const timeout = Math.min(step.timeoutMs ?? 30_000, MAX_WAIT_MS);
      if (target.label) {
        await waitFor(device, { text: target.label }, timeout);
      } else if (target.text) {
        await waitFor(device, { query: target.text }, timeout);
      } else if (target.ref) {
        const ref = target.ref.startsWith("@") ? target.ref : `@${target.ref}`;
        const end = Date.now() + timeout;
        while (Date.now() < end) {
          await cooperativeCheckpoint();
          if (await exists(device, ref)) break;
          await sleep(400, device);
        }
        if (Date.now() >= end) {
          throw new Error(`wait-for: timed out waiting for ref ${ref} (${timeout}ms)`);
        }
      } else {
        // Validation rejects point-only / empty targets, but guard defensively.
        throw new Error(`wait-for: target has no ref/label/text`);
      }
      break;
    }

    case "expect": {
      const target = step.target;
      const timeout = Math.min(step.timeoutMs ?? DEFAULT_EXPECT_TIMEOUT_MS, MAX_WAIT_MS);
      const timeoutSec = Math.round(timeout / 1000);
      const label = describeTarget(target);

      if (step.condition === "visible") {
        try {
          if (target.label) {
            await waitFor(device, { text: target.label }, timeout);
          } else if (target.text) {
            await waitFor(device, { query: target.text }, timeout);
          } else if (target.ref) {
            const ref = target.ref.startsWith("@") ? target.ref : `@${target.ref}`;
            const end = Date.now() + timeout;
            let found = false;
            while (Date.now() < end) {
              await cooperativeCheckpoint();
              // targetPresent propagates infra errors (unlike `exists`).
              if (await targetPresent(device, target)) {
                found = true;
                break;
              }
              await sleep(400, device);
            }
            if (!found) throw new Error(`timed out waiting for ref ${ref}`);
          } else {
            // Validation rejects point-only / empty targets, but guard defensively.
            throw new Error(`expect: target has no ref/label/text`);
          }
        } catch (err) {
          if (isCancel(err)) throw err;
          // Infrastructure failures (no device / adb / session / connection)
          // keep their original message — only a real not-found/timeout
          // becomes the assertion failure.
          if (!isNotFoundOrTimeout(err)) throw err;
          throw new Error(`expect: "${label}" not visible after ${timeoutSec}s`);
        }
      } else {
        // condition === "gone": poll until the target no longer resolves.
        const end = Date.now() + timeout;
        let gone = false;
        while (Date.now() < end) {
          await cooperativeCheckpoint();
          if (!(await targetPresent(device, target))) {
            gone = true;
            break;
          }
          await sleep(400, device);
        }
        if (!gone) {
          throw new Error(`expect: "${label}" still visible after ${timeoutSec}s`);
        }
      }
      break;
    }

    case "pause": {
      if (!job) throw new Error("pause: no job to pause (standalone step execution)");
      log(`⏸ ${step.message}`);
      job.status = "paused";
      requestPause(job.id);
      publish({ type: "job.paused", at: now(), jobId: job.id, action: job.action });
      publish({
        type: "job.log",
        at: now(),
        jobId: job.id,
        line: `==> paused: ${step.message}`,
        level: "info",
      });
      // Blocks until resumeJob (POST /jobs/:id/resume) calls requestResume.
      // On cancel, throws JobCancelledError and propagates up — never sets running.
      await cooperativeCheckpoint(job.id);
      // resumeJob already set status="running" + published job.resumed; ensure it.
      job.status = "running";
      break;
    }

    case "flow": {
      // validateRecipeSteps guarantees step.flow is a known ActionId; narrow to satisfy types.
      if (!isActionId(step.flow)) {
        throw new Error(`flow step references unknown action: ${step.flow}`);
      }
      const result = await runAction(device, step.flow, { onLog: log });
      if (!result.ok) throw new Error(result.error);
      break;
    }
  }
}
