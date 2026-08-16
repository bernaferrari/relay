# Plan 002: Make failed-check repair evidence exact and readable

> **Executor instructions**: Follow this plan step by step and run every verification gate. Preserve
> immutable raw evidence for agents; add a typed projection for people rather than deleting detail.
> Update `advisor-plans/README.md` when finished.
>
> **Drift check (run first)**:
> `git diff --stat 0f6f8841..HEAD -- packages/core/src/recipe-runner-extended-steps.ts packages/app/src/lib/campaign-check-results.ts packages/app/src/components/campaign-check-results.tsx packages/app/src/lib/campaign-check-results.test.ts packages/app/src/components/campaign-check-results.browser.test.tsx`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `0f6f8841`, 2026-08-15

## Why this matters

Failed and deferred checks now persist the screenshot, full accessibility tree, attempted locators,
current chrome, screen identity, and exact error. That is sufficient raw data, but the human UI
still renders a generic JSON dump, and frames are captioned with mutable/non-unique titles. The
repair surface should immediately answer: where Relay was, what it tried, why it rejected or used a
target, what happened, and what the next safe manual action is—while retaining raw JSON for agents.

## Current state

- `packages/core/src/recipe-runner-extended-steps.ts:42-84` captures a
  `campaign-check-evidence` artifact keyed by stable `checkId`, but captions the frame as
  `failed:<check.title>`.
- `packages/app/src/lib/campaign-check-results.ts:91-99` accepts both title and stable-ID captions;
  duplicate titles can therefore claim the same frame.
- `packages/app/src/components/campaign-check-results.tsx:50-131` shows the error and screenshot but
  renders every evidence payload as an undifferentiated “Structured evidence” `<pre>`.
- Existing UI conventions use pure projection helpers plus rendered happy-dom coverage; follow
  `packages/app/src/lib/campaign-check-results.test.ts` and
  `packages/app/src/components/campaign-check-results.browser.test.tsx`.
- Keep `@relay/ui` host-neutral and keep evidence parsing in the app's pure library layer.

## Commands

| Purpose     | Command                             | Expected                    |
| ----------- | ----------------------------------- | --------------------------- |
| Core        | `pnpm --filter @relay/core test`    | all pass                    |
| App         | `pnpm --filter @relay/app test`     | unit and browser tests pass |
| Typecheck   | `pnpm typecheck`                    | all projects pass           |
| UI boundary | `pnpm --filter @relay/app check:ui` | pass                        |
| Build       | `pnpm --filter @relay/app build`    | pass                        |
| Toolchain   | `vp check && vp test`               | pass                        |

## Scope

**In scope**:

- `packages/core/src/recipe-runner-extended-steps.ts`
- `packages/core/src/recipe-runner.test.ts`
- `packages/app/src/lib/campaign-check-results.ts`
- `packages/app/src/lib/campaign-check-results.test.ts`
- `packages/app/src/components/campaign-check-results.tsx`
- `packages/app/src/components/campaign-check-results.browser.test.tsx`
- One new small app presentation helper if needed to keep the component below its source budget

**Out of scope**:

- New retry APIs, map mutation, auto-healing, or agent-written changes
- Removing raw nodes/artifacts or changing public run-detail transport
- Generic Results redesign, new dialogs, or changes outside campaign checks

## Git workflow

- Branch: `codex/readable-campaign-repair`
- Commit message: `feat(app): explain campaign check failures`
- Do not push or mutate live runs.

## Steps

### Step 1: Make frame attribution stable

Caption new failure screenshots with `failed:<check.id>`, not the title. Retain the title in the
artifact and visible UI. Update the app projection so newly captured frames join only by stable ID.
Keep legacy title matching only behind an explicit compatibility branch for old persisted runs; when
duplicate authored titles exist, legacy title frames must be treated as ambiguous and shown on no
check rather than on multiple checks.

**Verify**: tests with two checks sharing one title prove the ID frame attaches once and an ambiguous
legacy title frame attaches zero times.

### Step 2: Derive a bounded typed repair summary

Add a pure projection that recognizes `campaign-check-evidence` and returns:

- observed app/header and identity summary;
- ordered locator attempts with method/target, rejection reason, bounds/point when present;
- whether a semantic tree was available and its node count;
- exact failure reason;
- a short recommended next action chosen from truthful states only: inspect screenshot/tree, manually
  locate the missing control, or repair the mapped locator. Do not claim a one-click retry target.

Bound display strings and attempt count so a malformed artifact cannot create an unbounded card. Keep
the complete artifact in the raw disclosure.

**Verify**: pure tests cover off-screen geometry, missing label, ambiguous selector, no AX tree,
fallback success followed by destination mismatch, and malformed artifact input.

### Step 3: Render the repair packet before raw data

In `CheckDetail`, render a compact “What Relay saw / What Relay tried / What happened / Next step”
section for failed and blocked checks. The screenshot remains the primary clickable evidence. Put
full raw evidence under one collapsed “Raw evidence” disclosure after the summary; do not render one
generic disclosure per artifact. Keep 44px targets, keyboard focus, semantic headings, wrapping, and
the current calm visual hierarchy.

**Verify**: rendered tests assert heading order, exact attempt text, screenshot activation, raw
disclosure collapsed by default, keyboard reachability, and no invented retry action.

### Step 4: Verify agent readability

Confirm the stable `checkId` artifact, attempts, nodes, and screenshot frame remain available through
the existing run-detail operation used by CLI/MCP. Do not add a new endpoint. Add or update a contract
test only if the existing projection could drop these fields.

**Verify**: a fixture passed through the real run-detail projection retains the stable ID and complete
raw packet while the UI projection remains bounded.

## Test plan

- Stable ID frame matching and duplicate-title ambiguity.
- Exact off-screen locator attempt summary.
- Missing AX and screenshot-only failure.
- Multiple fallback attempts in original order.
- Malformed/oversized evidence is bounded.
- Rendered keyboard/screenshot/raw disclosure interaction.
- Existing passed/skipped/blocked ordering remains unchanged.

## Done criteria

- [ ] New failure frames use stable check IDs.
- [ ] Duplicate titles cannot cross-associate failure frames.
- [ ] A failed row answers what was seen, tried, happened, and what to do next without opening JSON.
- [ ] Raw tree and attempts remain available to agents.
- [ ] No fake per-check retry is shown.
- [ ] Core/app tests, typechecks, UI boundary, build, Vite+, and architecture gates pass.

## STOP conditions

- Stable `checkId` is absent at the capture boundary.
- Implementing the summary requires changing the public run schema rather than projecting existing
  artifacts.
- The proposed action would mutate a map or control a device without an explicit user action.
- Two attempts fail the same deterministic gate.

## Maintenance notes

Treat raw evidence as the durable contract and the repair summary as a version-tolerant projection.
Future artifact fields should enrich the projection without making old runs unreadable. Reviewers
should test duplicate titles and malformed evidence explicitly.
