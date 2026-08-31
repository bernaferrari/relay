# Plan 003: Close the live Android and browser Change Proof loop

> **Executor instructions**: Follow this plan step by step. Run every verification command and
> confirm the expected result before moving to the next step. Touch only the files listed as in
> scope. If anything in the STOP conditions occurs, stop and report; do not improvise. When done,
> do not update `advisor-plans/README.md`; the reviewer maintains the index.
>
> **Drift check (run first)**:
> `git diff --stat 683fe1f78..HEAD -- scripts/change-proof-golden-live.mjs scripts/change-proof-golden-live-prerequisites.mjs scripts/change-proof-golden-live.test.mjs fixtures/android-proof-app scripts/android-proof-fixture.mjs docs/CHANGE_PROOF_GOLDEN.md`
> If an in-scope file changed, compare the Current state below against live code. A semantic
> mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: none
- **Category**: correctness / tests / direction
- **Planned at**: commit `683fe1f78`, 2026-08-30
- **Execution status**: BLOCKED after Step 3. Main contains commits `aa980cb4b`, `5ecb9f075`, and
  `b45114ab0`; focused fixture/TracePack tests pass 10/10. The live Relay store has no reviewed shared
  Settings → Language → Arabic Test with Android and browser routes, so Steps 4–6 cannot proceed
  without fabricating canonical authoring state.

## Why this matters

Relay's device-free golden Proof already demonstrates immutable old/new heads, explicit cells,
bounded repair evidence, selective rerun, canonical decisions, and content-addressed TracePacks. The
live harness does not: it drives only managed Chromium, never invokes the Android Test, and rejects
every supplied TracePack as unverified by construction. This plan makes one retained demonstration
honestly execute the same Settings → Language → Arabic journey on Android and Chromium through the
normal Proof coordinator, with exact source/build/target identities and canonically verified
TracePacks. Missing hardware or evidence must remain `insufficient-evidence`; no fixture shortcut may
produce green.

## Current state

- `scripts/change-proof-golden-live.mjs:347-393` documents that Android execution is absent and
  unconditionally appends `android.execution.not-run`.
- `scripts/change-proof-golden-live-prerequisites.mjs:237-323` JSON-parses and preserves supplied
  TracePacks but always marks them `unverified`, so exact inputs can never become ready.
- `fixtures/android-proof-app` is reproducible and has exact APK provenance, but its business journey
  is Ready → Prove interaction → Checkpoint passed rather than Settings → Language → Arabic.
- `packages/core/src/change-proof-golden-demo.ts` is the semantic exemplar for the expected lifecycle,
  but its persisted Runs are fixtures. Do not call them live evidence.
- Normal live authority already exists: `proof.prepare`, human `proof.plan.approve`, `proof.run`,
  `proof.inspect`, `proof.rerun-affected`, `app-map.test.run`, and `export-evidence`. Reuse these
  boundaries; do not create a parallel verdict or TracePack implementation.
- `docs/QUALITY_9.md` requires exact Test, target, build, environment, policy, evidence, and honest
  missing-channel reporting. It explicitly says device-free conformance cannot promote physical
  reliability.

## Commands you will need

| Purpose           | Command                                                                                        | Expected on success                     |
| ----------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------- |
| Install           | `vp install`                                                                                   | exit 0                                  |
| Fixture           | `pnpm android-proof:verify`                                                                    | reproducible manifest and APK pass      |
| Focused tests     | `node --test scripts/change-proof-golden-live.test.mjs scripts/android-proof-fixture.test.mjs` | all tests pass                          |
| Architecture      | `pnpm run test:architecture`                                                                   | all tests pass                          |
| Full verification | `pnpm verify`                                                                                  | exit 0                                  |
| Live server       | `pnpm ensure:serve`                                                                            | healthy Relay service on 127.0.0.1:8787 |

## Scope

**In scope**:

- `fixtures/android-proof-app/**` except generated Gradle caches/reports
- `scripts/android-proof-fixture.mjs`
- `scripts/android-proof-fixture.test.mjs`
- `scripts/change-proof-golden-live.mjs`
- `scripts/change-proof-golden-live-prerequisites.mjs`
- `scripts/change-proof-golden-live.test.mjs`
- `docs/CHANGE_PROOF_GOLDEN.md` (create)
- `package.json` only if one explicit golden-demo command is needed

**Out of scope**:

- Proof protocol/store/decision/execution changes; the production lifecycle already exists.
- GitHub Actions and provider publication.
- Automatic production-build ingestion.
- iOS, fleet scheduling, or multi-night hardware claims.
- Synthetic `PersistedRun` construction in the live harness.
- Committing runtime state, device serials, generated TracePacks, screenshots, Gradle caches, or
  local `.relay` databases.

## Git workflow

- Resume on a `codex/` worktree branch from the current main revision.
- Use conventional commits matching the repository (`feat(android): ...`, `test(proof): ...`).
- The old regression and repaired source identities must be two real commits if the retained live
  run is produced during execution. Do not label two build modes from one commit as two source heads.
- Do not push or merge unless the operator instructs it.

## Steps

### Step 1: Make the Android fixture express the canonical business journey

Replace the current generic checkpoint screens with three deterministic, semantics-first screens:
Settings, Language, and Arabic. The transition labels and accessibility descriptions must be stable
and unambiguous. The final Arabic screen must contain the same primary action and translated
description named by the browser fixture, expose build identity, and have a deterministic reset.

Create the seeded-regression source as one real commit: the final compact layout must deterministically
overlap the primary action and description by the declared amount or another machine-measurable,
documented fixture invariant. Do not infer overlap from a title string. Update the reproducible APK
manifest and tests.

**Verify**: `pnpm android-proof:build && pnpm android-proof:verify` → exit 0 and one exact artifact
digest for the regression commit.

### Step 2: Add the repaired fixture as a distinct exact source head

Fix only the seeded layout regression while preserving the same App ID, semantic labels, journey,
and checkpoint identity. Commit this as the next source head and rebuild the reproducible APK.
Record the old commit SHA, repaired commit SHA, and both exact artifact digests in the live report,
not in tracked configuration.

**Verify**: `pnpm android-proof:build && pnpm android-proof:verify` → exit 0, the repaired APK is
reproducible, and its digest differs from the regression artifact.

### Step 3: Verify supplied TracePacks canonically

Replace `inspectTracePack()`'s JSON-only `unverified` result with the canonical Relay parser,
`verifyTracePack`, and `analyzeTracePack`. Keep the existing file and aggregate size bounds. Verify
that each pack contains exactly one frozen Run and bind it to the declared phase's exact source SHA,
canonical App Map/Test identity, target profile, build artifact digest, and Proof/run reference.

Because this script currently runs as plain Node while `@relay/core` exports TypeScript sources,
prefer one of these existing-boundary options in order:

1. invoke the normal `export-evidence`/server route and consume its already verified envelope;
2. move only the live harness to the repository's `tsx` runtime and update its tests/command;
3. add a tiny TypeScript verifier executable that imports `@relay/core/trace-pack`.

Do not duplicate digest or schema validation in JavaScript. Any mismatch remains a named blocker.

**Verify**: focused tests prove a valid pack becomes `verified`; tampered object bytes, wrong source
SHA, wrong App Map/Test, wrong build digest, wrong target, duplicate frozen Runs, and oversized packs
all remain blockers.

### Step 4: Execute Android through the normal reviewed Test and Proof coordinator

Remove the unconditional `android.execution.not-run` blocker only when the harness has:

- one explicitly authorized serial;
- the exact installed/registered APK for the phase;
- a persisted App Map and Test for Settings → Language → Arabic;
- a full observed Android target profile;
- a human-approved Verification Plan;
- a terminal persisted Run produced by `proof.run` (or `app-map.test.run` only when preparing the
  canonical Proof cell through the existing coordinator requires it).

Drive regression and repaired phases separately. Never choose a random connected Device, install a
different artifact, fabricate App Map state, or convert transport success into Test success. Capture
the returned Proof IDs, versions, cell IDs, Run IDs, decisions, and exported TracePack digests.

**Verify**: injected-operation tests assert call ordering and prove that target control is never
attempted before exact build/profile/plan admission. Missing human approval, package mismatch,
target drift, unknown input, or incomplete evidence returns `insufficient-evidence`/`needs-review`.

### Step 5: Make Chromium evidence part of the same canonical Proof

Keep the server-owned managed Chromium page and semantic inspect path, but stop treating JPEGs and
page titles as a Proof result. Register the browser build identity and run the same saved Test's
reviewed browser route as an explicit Verification Cell. The seeded failure must come from a normal
check artifact/evidence policy and make the old Proof `rejected`; the repaired head must run every
required cell and become `proved` only from server-owned decision projection.

**Verify**: tests assert the old Proof is immutable after rejection, repaired Proof has a new exact
head/build identity, no cross-head evidence is silently reused, and terminal status is obtained from
`proof.inspect` rather than synthesized by the script.

### Step 6: Retain one honest demonstration report

Write `docs/CHANGE_PROOF_GOLDEN.md` with the command, prerequisites, exact fixture journey, expected
terminal states, artifact directory, and interpretation of `rejected`, `proved`, and
`insufficient-evidence`. The JSON report must name selected journeys and reasons, cells, exact
source/build/target/policy identities, first causal failure, bounded repair packet, TracePack
digests, rerun set, residual risk, and every unmeasured claim.

Run the demonstration on the connected emulator if it is still explicitly available. Preserve
generated evidence under ignored `proof-out/`; do not commit it. If a real old/repaired run cannot be
completed in the executor environment, leave the code/tests complete and report the live acceptance
as BLOCKED, not passed.

**Verify**: the live command exits with the documented status; a successful report contains no
`*.not-run`, `*.unverified`, or `finalProof.status: "not-claimed"` entries. A missing prerequisite
still produces exit code 8 and a complete blocker list.

## Test plan

- Extend `scripts/change-proof-golden-live.test.mjs` with:
  - canonical valid/tampered/wrong-identity TracePacks;
  - Android operation ordering and no-control-before-admission;
  - regression Proof rejection and immutable old Proof;
  - repaired-head rerun/decision from `proof.inspect`;
  - missing hardware/approval/evidence remains insufficient;
  - cleanup failures remain visible.
- Extend `scripts/android-proof-fixture.test.mjs` to inspect the APK for the stable App ID, three
  journey labels, Arabic/RTL support, deterministic seeded regression marker at the old commit, and
  repaired marker at the new commit.
- Use `packages/core/src/change-proof-golden-demo.test.ts` only as the lifecycle assertion pattern;
  do not copy its synthetic Run factory into the live harness.

## Done criteria

- [ ] `pnpm android-proof:verify` exits 0 for the repaired head.
- [ ] Focused script tests pass, including all negative identity/tamper cases.
- [ ] `pnpm verify` exits 0.
- [ ] The live harness invokes Android and Chromium through production operations.
- [ ] Canonical Relay code verifies every retained TracePack and exact identity.
- [ ] The old Proof is rejected and immutable; the repaired exact head is a separate Proof.
- [ ] The final Proof is server-owned and `proved` only with complete required evidence.
- [ ] Missing hardware or evidence cannot exit 0.
- [ ] No runtime evidence, serial, credential, or local database is tracked.
- [ ] `git diff --check` passes and only in-scope files changed.

## STOP conditions

Stop and report rather than improvising if:

- production `proof.run` cannot execute an Android and browser cell in one Proof without protocol or
  store changes;
- the exact old/repaired APKs cannot truthfully be bound to distinct source commits;
- the saved Test cannot express one shared business intent with reviewed Android/browser routes;
- canonical TracePack verification requires copying private core logic into the harness;
- the available Android target is unauthorized, locked, drifted, or returns an unknown mutation;
- a verification step fails twice after one reasonable correction;
- completing the demonstration would require committing generated evidence or secrets.

## Maintenance notes

- Keep this demonstration deliberately small. It is evidence for one cross-platform loop, not a
  fleet benchmark or a substitute for 14-night physical-device acceptance.
- Future automatic build ingestion should feed the same registered build/cell contracts; it must not
  replace this exact-identity demonstration with provider metadata alone.
- Reviewers should scrutinize every place the harness converts an observed result into a status.
  Only the canonical Proof decision may clear the merge.
