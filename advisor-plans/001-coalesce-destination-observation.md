# Plan 001: Coalesce destination accessibility and screenshot evidence

> **Executor instructions**: Follow this plan step by step. Run every verification command and
> confirm the expected result before moving on. Do not weaken destination assertions, remove target
> screenshots, or reuse pixels across a mutation. If a STOP condition occurs, report it rather than
> improvising. Update `advisor-plans/README.md` when finished.
>
> **Drift check (run first)**:
> `git diff --stat 0f6f8841..HEAD -- packages/core/src/recipe-runner-screen.ts packages/core/src/recipe-runner-context.ts packages/core/src/workspace-capture.ts packages/core/src/recipe-runner.test.ts packages/core/src/session.test.ts`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `0f6f8841`, 2026-08-15

## Why this matters

The verified Relay 40 run completed successfully in 144.624 seconds, but only 31 of 37 checks were
done inside two minutes. Across 36 checks with a target-resolution artifact, 41.659 seconds elapsed
between the resolved input and terminal check result. The destination tree and required screenshot
are currently collected serially even though Android's raw screencap and accessibility helper are
independent transports. Collecting one synchronized observation per destination should save about
10–15 seconds while keeping every semantic assertion and every screenshot.

## Current state

- `packages/core/src/recipe-runner-screen.ts:70-106` awaits `snapshot(device)` before determining a
  semantic match.
- `packages/core/src/recipe-runner-screen.ts:23-37` later calls `captureScreenshot` again for the
  explicit screenshot step.
- `packages/core/src/recipe-runner-context.ts` owns the run-local observation and verified-screen
  checkpoint. This is the only allowed cache lifetime; never add a process-global cache.
- `packages/core/src/workspace-capture.ts:432-520` captures pixels and can accept caller-supplied
  `semanticNodes`, but it currently has no helper for attaching an already-captured ephemeral payload
  to the run with the later canonical caption.
- Compiler-generated source expectations are identified by `relay-source-*` or `*:warm`; see
  `packages/core/src/session.ts:600-612`. They do not own product evidence and must not start a raster.
- The product invariant in `ARCHITECTURE.md` is unchanged: destination mismatch is a failure, and
  every consequential run keeps attributable evidence.

## Commands

| Purpose       | Command                                                     | Expected                    |
| ------------- | ----------------------------------------------------------- | --------------------------- |
| Install       | `vp install`                                                | exit 0                      |
| Focused tests | `pnpm --filter @relay/core test`                            | all core tests pass         |
| Typecheck     | `pnpm typecheck`                                            | all workspace projects pass |
| Toolchain     | `vp check && vp test`                                       | exit 0                      |
| Architecture  | `pnpm run check:architecture && pnpm run test:architecture` | both pass                   |

## Scope

**In scope**:

- `packages/core/src/recipe-runner-screen.ts`
- `packages/core/src/recipe-runner-context.ts` only if the observation type needs an in-flight or
  captured destination raster field
- `packages/core/src/workspace-capture.ts` and its focused tests only for a helper that commits an
  existing screenshot payload exactly once
- `packages/core/src/recipe-runner.test.ts`
- `packages/core/src/session.test.ts` or a new focused core test file

**Out of scope**:

- Screenshot policy changes, frame-count reductions, or removal of accessibility assertions
- iOS concurrency changes; preserve current iOS behavior unless an existing shared abstraction can
  retain it byte-for-byte
- Full-surface scrolling/composition, map data, Test ordering, and app UI
- Any cache outside one `RecipeRuntimeState`

## Git workflow

- Branch: `codex/relay40-coalesced-observation`
- Commit message: `perf(core): coalesce destination evidence`
- Do not push or mutate live App Map data.

## Steps

### Step 1: Characterize one synchronized destination observation

Add tests proving that a non-source `expect-screen` can start Android raster capture concurrently
with its fresh semantic snapshot. Use deferred test promises rather than wall-clock assertions:

1. both operations start before either resolves;
2. a semantic match retains the paired screenshot in the run-local verified checkpoint;
3. a semantic mismatch discards that raster and never attaches it to a frame;
4. a recovery mutation invalidates both tree and raster before the next attempt;
5. source and `:warm` expectations do not capture a raster;
6. cancellation is propagated and leaves no unhandled capture promise.

Model the checkpoint lifetime after the existing observation-reuse tests in
`packages/core/src/recipe-runner.test.ts`.

**Verify**: run the new focused test pattern twice; both runs pass deterministically.

### Step 2: Add an exactly-once attachment boundary

In `workspace-capture.ts`, add the smallest internal helper that takes an already-captured
`ScreenshotPayload`, a job ID, and the canonical caption, and attaches it exactly once. It must reuse
an existing `framePath`, must not recapture pixels, and must not attach an ephemeral raster that was
discarded after a mismatch. Keep frame persistence inside the existing workspace/session boundary;
do not import session internals into the runner and create a new cycle.

Add tests for first attachment, repeated attachment, and rejected/discarded payloads.

**Verify**: focused workspace/session tests pass with exactly one screenshot adapter call and one
frame.

### Step 3: Coalesce only evidence-owning expectations

Update `runExpectScreenStep` so Android expectations that own destination evidence begin one raw
screenshot concurrently with the semantic snapshot. Reuse the semantic nodes for screenshot
screen-match metadata. On match, store the synchronized payload in the verified checkpoint. On
mismatch, recovery, or timeout, discard it. Preserve the existing visual-fingerprint fallback; if
the semantic tree is unavailable, the synchronized raster may still participate in the existing
visual match but may not bypass the current identity rules.

Update `captureRecipeScreenshot` to attach the retained payload with the explicit screenshot step's
caption. Fall back to the current fresh capture when no valid retained payload exists.

**Verify**: core tests prove one destination tree read, one raster read, one attached frame, unchanged
screen-match semantics, and fresh failure evidence after mismatch.

### Step 4: Benchmark on hardware without changing the map

Run the same frozen `grok-android-manual-v2` / `relay-40-fresh-v2` revision on the connected Android.
Do not edit the map or reorder checks. Compare:

- total duration against 144.624 seconds;
- the timestamp of the 34th terminal check against 128.684 seconds;
- passed/failed/deferred counts;
- frame count and campaign-check-result count;
- Terms → Privacy → Help authored order.

The change is accepted only if all enabled checks still pass, every expected target frame exists,
and either the 34th check is below 120 seconds or the measured destination phase improves by at least
8 seconds without a correctness regression.

**Verify**: persist the benchmark run and record its job ID and metrics in the commit or bead notes.

## Test plan

- Semantic match + synchronized raster success.
- Mismatch discards raster; retry captures a fresh pair.
- Back/scroll/app/key mutation invalidates the pair.
- Source/warm expectations take no raster.
- Visual-only fallback remains bounded and truthful.
- Explicit screenshot attaches cached payload once; no duplicate frame.
- Android behavior improves; iOS/browser behavior is unchanged.

## Done criteria

- [ ] No destination assertion or screenshot was removed.
- [ ] One successful destination produces one AX read, one raster read, and one frame.
- [ ] A mismatched observation can never attach its raster to a later successful check.
- [ ] Core tests, workspace typecheck, Vite+ checks, and architecture gates pass.
- [ ] Hardware benchmark passes every enabled check and records the comparison above.
- [ ] Only in-scope files plus this plan's status row changed.

## STOP conditions

- The Android screenshot path and accessibility helper prove mutually exclusive on the physical
  device.
- Correct pairing requires a process-global cache or weakening screen identity.
- A destination frame no longer corresponds to the semantic tree that passed.
- Two attempts fail the same deterministic gate.

## Maintenance notes

The observation is run-local proof, not a general screenshot cache. Any future mutation step must
continue invalidating both nodes and pixels. Reviewers should focus on mismatch/discard behavior and
exactly-once frame attachment more than the happy path.
