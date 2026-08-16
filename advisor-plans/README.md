# Relay 40 post-fix implementation plans

Generated with the Improve audit discipline on 2026-08-15 at commit `0f6f8841`. These plans are
deliberately separate from the historical `plans/` program, which documents an older product phase.
Execute in order unless the dependency table says otherwise.

## Execution order and status

| Plan | Title                                                      | Priority | Effort | Depends on | Status |
| ---- | ---------------------------------------------------------- | -------- | ------ | ---------- | ------ |
| 001  | Coalesce destination accessibility and screenshot evidence | P1       | M      | —          | BLOCKED |
| 002  | Make failed-check repair evidence exact and readable       | P1       | M      | —          | DONE    |

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

## Findings considered and rejected

- **Reorder Settings again**: rejected. The passing run is already depth-first by product grouping,
  performs only three indexed scrolls, puts Open Source Licenses/Terms/Privacy/Help last, and reaches
  Edit Profile/Birth Year near the beginning. More reordering would churn a now-proven itinerary.
- **Drop destination screenshots**: rejected. The user explicitly needs reviewable evidence for all
  mapped screens; the correct optimization is concurrent collection, not weaker evidence.
- **Generalized cleanup or another visual redesign**: rejected for this tranche. Neither advances the
  measured execution or repair loop.
