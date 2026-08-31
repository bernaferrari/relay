# Relay 40 post-fix implementation plans

Generated with the Improve audit discipline on 2026-08-15 at commit `0f6f8841`. These plans are
deliberately separate from the historical `plans/` program, which documents an older product phase.
Execute in order unless the dependency table says otherwise.

## Execution order and status

| Plan | Title                                                      | Priority | Effort | Depends on | Status                                   |
| ---- | ---------------------------------------------------------- | -------- | ------ | ---------- | ---------------------------------------- |
| 001  | Coalesce destination accessibility and screenshot evidence | P1       | M      | —          | BLOCKED                                  |
| 002  | Make failed-check repair evidence exact and readable       | P1       | M      | —          | DONE                                     |
| 003  | Close the live Android and browser Change Proof loop       | P1       | L      | —          | BLOCKED — no reviewed shared Test exists |

Status values: TODO | IN PROGRESS | DONE | BLOCKED | REJECTED.

Plan 001's implementation is independently approved at `87610653`; its only unmet done criterion is
the physical before/after benchmark. The connected Android target failed before Test execution with
`Failed to start daemon`, so no performance claim is recorded. Plan 002 is independently approved at
`5d3b5a8` after core/app tests, workspace typecheck, app build/UI boundary, scoped Vite+ checks, and
the repository Vite+ test gate passed.

## Dependency notes

- The plans are independent and may execute in either order. Plan 001 is first because it directly
  advances the sub-two-minute campaign objective; Plan 002 improves failure repair without changing
  successful-run latency.
- Plan 003 is independent of the older Relay 40 plans. It is the current product priority because
  the device-free Change Proof fixture is already complete while the live harness cannot currently
  produce a canonical cross-platform Proof even when its prerequisites are supplied. Main contains
  three reviewed commits: a truthful seeded Android source head, a distinct repaired head, and
  canonical TracePack identity verification. Focused tests pass 10/10. Execution stopped correctly because the live
  Relay store has no human-reviewed Settings → Language → Arabic Test with Android and browser
  routes; creating that durable authoring input is the next prerequisite, not something a benchmark
  may fabricate.

## Vetted audit findings

### [PERF-01] Coalesce destination semantic proof and visual evidence

- **Evidence**: `packages/core/src/recipe-runner-screen.ts:70-106` awaits the accessibility snapshot
  and accepts the destination before a later screenshot step captures pixels.
- **Evidence**: `packages/core/src/recipe-runner-screen.ts:23-37` always starts a new screenshot even
  when the just-verified destination could already own a synchronized raster.
- **Evidence**: the passing Relay 40 run `ed2d3445-84f5-4da8-a71e-6f318237a8a8` spent 41.659 seconds
  between the final target-resolution artifact and check completion across 36 checks. Thirty-one of
  37 checks completed by 118.908 seconds; the 34th completed at 128.684 seconds. Five direct Android
  screencap samples measured 0.31–0.52 seconds each.
- **Impact**: Relay pays serial tree+raster latency on every destination. It misses the “90% under two
  minutes” goal despite preserving exactly the evidence that could be collected concurrently.
- **Effort**: M. **Risk**: MED — stale or mismatched rasters must never be attached to a semantic
  match. **Confidence**: HIGH.

### [DX-01] Project a stable repair summary instead of raw evidence JSON

- **Evidence**: `packages/core/src/recipe-runner-extended-steps.ts:42-84` now records the exact error,
  attempts, current chrome, identity, full nodes, and a screenshot, but captions screenshots with the
  human title rather than the stable check ID.
- **Evidence**: `packages/app/src/lib/campaign-check-results.ts:91-99` joins screenshots by title or
  ID; title matching can associate one screenshot with multiple checks that share a title.
- **Evidence**: `packages/app/src/components/campaign-check-results.tsx:110-125` exposes each artifact
  only as a generic “Structured evidence” JSON dump.
- **Impact**: agents can inspect the raw run, but a person must reverse-engineer nested JSON, and
  duplicate titles can show the wrong failure frame. This falls short of an intuitive repair loop.
- **Effort**: M. **Risk**: LOW — the underlying immutable artifacts stay unchanged. **Confidence**:
  HIGH.

### [CORRECTNESS-02] Make the live Change Proof harness execute and verify its declared scope

- **Evidence**: `scripts/change-proof-golden-live.mjs:347-393` explicitly states that Android is not
  executed and unconditionally adds `android.execution.not-run` to every report.
- **Evidence**: `scripts/change-proof-golden-live-prerequisites.mjs:237-272` parses supplied
  TracePack JSON but always returns `status: "unverified"`; `:296-323` then turns every supplied pack
  into a blocker. There is no input combination that can make exact Proof evidence ready.
- **Evidence**: `fixtures/android-proof-app/app/src/main/res/layout/activity_main.xml` and
  `MainActivity.java` implement Ready → Prove interaction → Checkpoint passed, while the declared
  golden journey in `scripts/change-proof-golden-live.mjs:36-44` is Settings → Language → Arabic.
- **Impact**: the strongest public demonstration can prove managed Chromium interaction but can
  never prove the same journey on Android, validate canonical TracePacks, or close an immutable old
  head → repair → new-head Proof lifecycle. Relay therefore has a trustworthy kernel without the
  retained live evidence needed to substantiate its product claim.
- **Effort**: L. **Risk**: HIGH — a shortcut could create a false-green benchmark or bind evidence to
  the wrong source/build/target identity. **Confidence**: HIGH.

## Findings considered and rejected

- **Reorder Settings again**: rejected. The passing run is already depth-first by product grouping,
  performs only three indexed scrolls, puts Open Source Licenses/Terms/Privacy/Help last, and reaches
  Edit Profile/Birth Year near the beginning. More reordering would churn a now-proven itinerary.
- **Drop destination screenshots**: rejected. The user explicitly needs reviewable evidence for all
  mapped screens; the correct optimization is concurrent collection, not weaker evidence.
- **Generalized cleanup or another visual redesign**: rejected for this tranche. Neither advances the
  measured execution or repair loop.
