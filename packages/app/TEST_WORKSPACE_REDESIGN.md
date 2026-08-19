# Test workspace redesign

Binding context: [DESIGN_SYSTEM.md](../../DESIGN_SYSTEM.md) (tokens, 4pt rhythm, quiet selection,
progressive disclosure, motion, a11y gates) and [ARCHITECTURE.md](../../ARCHITECTURE.md) (App Map,
Screens, Connections, Tests, Variables, Combine).

## 1. What this screen is actually for

A Test is a rehearsal script for a real device. The only reason all of this sits on one screen is
that three questions must be answerable **at the same time**: _where am I in the sequence_, _what
does this one step mean_, and _what does the device actually show right now (or show from the last
run)_. Everything else — creating, duplicating, importing, provenance, compiled revisions — is
setup or forensics and belongs behind a disclosure.

Two consequences drive the whole redesign:

1. **The device is the subject, not a panel.** You cannot rehearse against a target that moves. The
   live device is a persistent right rail that only ever changes _width_ — it never reflows to the
   bottom, never trades places with anything, and never disappears without the user asking.
2. **"Results" is not a sibling of "Device". It is the past tense of the same thing.** Evidence is
   per-step and per-target, so it belongs in the same rail as the device, switched by _tense_
   (`Live` / `Last run`) and always captioned with the step it belongs to.

## 2. Layout

Three regions. Two of them are collapsible rails; the center is the step editor and always keeps
the largest share of the width.

Widths are chosen from the **container** width (`ResizeObserver` on the workspace element), not the
viewport, because the shell's map library can open and steal ~280px without the viewport changing.

| Mode      | container   | Steps rail       | Step editor     | Device rail          |
| --------- | ----------- | ---------------- | --------------- | -------------------- |
| `wide`    | ≥ 1280px    | docked **288px** | `minmax(0,1fr)` | docked **360px**     |
| `medium`  | 1024–1279px | docked **248px** | `minmax(0,1fr)` | docked **304px**     |
| `narrow`  | 768–1023px  | overlay (toggle) | `minmax(0,1fr)` | docked **272px**     |
| `compact` | < 768px     | overlay (toggle) | `minmax(0,1fr)` | overlay + 36px strip |

A collapsed rail is never absent: it becomes a **36px strip** on its own edge with a vertical label
and a chevron, so the affordance stays where the content was. That is the whole responsive story —
no breakpoint anywhere makes the device a row.

### Wide (≥1440 viewport / ≥1280 container)

```
┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▤  Grok Settings ▾   39 steps        ● Ready to run   ✦ 1 proposed   [ ▶ Run test ]   ⋯   ▮       │ 44
├────────────────────┬──────────────────────────────────────────────────┬───────────────────────────┤
│ STEPS  ⌕ Find    + │  Step 12 of 39                          ● Ready  │ DEVICE            ⟳  ⋯  › │ 36
│                    │  Instruction                                     │ SM S931B · Observed 21:04 │
│  1  Launch home    │                                                  ├───────────────────────────┤
│     Module · Laun… │  Intent                                          │ [ Live ][ Last run ]      │ 32
│  2  Screen is Home │  ┌────────────────────────────────────────────┐  │ Step 12 · Open Birth Year │ 20
│     Validation     │  │ Open the Birth Year picker                 │  ├───────────────────────────┤
│  3  Open Settings  │  └────────────────────────────────────────────┘  │  ┌─────────────────────┐  │
│     …tion → Settin │                                                  │  │                     │  │
│ ▌4  Open profile   │  Replays which navigation                        │  │    live pixels      │  │
│ ▌   …ings → Edit p │  Saved flow      [ Settings → Profile        ▾ ]  │  │   (tap to aim)      │  │
│  5  Open Birth Yr  │  Connections            2 in order               │  │                     │  │
│     …profile → Bir │   ┌────────────────────────────────────────────┐  │  │                     │  │
│  ⋮                 │   │ 1  Navigation → Settings                   │  │  └─────────────────────┘  │
│                    │   │ 2  Settings → Edit profile                 │  │  View only · no control   │
│                    │   │ ·  Edit profile → Birth Year · Needs review │  │  ▸ Capture this screen    │
│                    │   └────────────────────────────────────────────┘  │                           │
│                    │  After this step                                 │                           │
│                    │  Save a result frame                    ◯──      │                           │
│                    │  ▸ Add a note                                    │                           │
│                    │                                                  │                           │
│  [ + Add step  ▾ ] │                                                  │                           │
└────────────────────┴──────────────────────────────────────────────────┴───────────────────────────┘
    288px               minmax(0,1fr)  ·  content column max-w 640px        360px
```

### Medium (~1100)

Identical structure; the rails give up width first, the editor never drops below the remaining
`1fr`. The device rail is still docked on the right.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ ▤  Grok Settings ▾  39 steps      ● Ready to run   [ ▶ Run test ]   ⋯   ▮       │
├──────────────────┬──────────────────────────────────────┬───────────────────────┤
│ STEPS  ⌕      +  │  Step 12 of 39               ● Ready │ DEVICE       ⟳  ⋯  ›  │
│                  │  Instruction                         │ SM S931B              │
│  3  Open Settngs │                                      │ [ Live ][ Last run ]  │
│     …n → Setting │  Intent                              │ Step 12 · Open Birth… │
│ ▌4  Open profile │  ┌──────────────────────────────┐    │  ┌─────────────────┐  │
│ ▌   …gs → Edit p │  │ Open the Birth Year picker   │    │  │  live pixels    │  │
│  5  Open Birth Y │  └──────────────────────────────┘    │  │                 │  │
│     …file → Birt │                                      │  └─────────────────┘  │
│  ⋮               │  Replays which navigation  …          │  ▸ Capture this screen│
│  [ + Add step ▾] │                                      │                       │
└──────────────────┴──────────────────────────────────────┴───────────────────────┘
     248px                    1fr                                  304px
```

### Narrow (~860)

The **steps** rail is what yields — it becomes an overlay opened by `▤` (or `[`). The device rail is
still docked right at 272px. Nothing moves to the bottom.

```
┌───────────────────────────────────────────────────────────────────┐
│ ▤  Grok Settings ▾   ● Ready to run    [ ▶ Run ]   ⋯   ▮          │
├─────────────────────────────────────────┬─────────────────────────┤
│  Step 12 of 39                 ● Ready  │ DEVICE       ⟳  ⋯  ›    │
│  Instruction                            │ SM S931B                │
│                                         │ [ Live ][ Last run ]    │
│  Intent                                 │ Step 12 · Open Birth…   │
│  ┌───────────────────────────────────┐  │  ┌───────────────────┐  │
│  │ Open the Birth Year picker        │  │  │   live pixels     │  │
│  └───────────────────────────────────┘  │  │                   │  │
│                                         │  └───────────────────┘  │
│  Replays which navigation  …            │  View only · no control │
│  Save a result frame           ◯──      │  ▸ Capture this screen  │
│  ▸ Add a note                           │                         │
└─────────────────────────────────────────┴─────────────────────────┘
        1fr                                        272px

  ▤ pressed  →  ┌──────────────────┐ overlay, slides from the left, scrim behind,
                │ STEPS  ⌕      +  │ Escape / outside click closes, focus returns
                │ … 39 rows …      │ to the toggle. Selecting a step closes it.
                │ [ + Add step ▾ ] │
                └──────────────────┘
```

### Compact (< 768)

Both rails are overlays. The device keeps a **36px right-edge strip** so it is still literally on
the right at the smallest size; tapping it opens the rail over the editor from the right edge.

```
┌───────────────────────────────────────────────┐
│ ▤  Grok Settings ▾   ●   [ ▶ ]   ⋯            │
├─────────────────────────────────────────────┬─┤
│  Step 12 of 39                     ● Ready  │D│
│  Instruction                                │E│ ← 36px strip, vertical label,
│                                             │V│    aria-expanded=false
│  Intent                                     │I│
│  ┌───────────────────────────────────────┐  │C│
│  │ Open the Birth Year picker            │  │E│
│  └───────────────────────────────────────┘  │ │
│  Replays which navigation …                 │›│
└─────────────────────────────────────────────┴─┘
```

## 3. Responsive strategy

- One `ResizeObserver` on the workspace root writes `data-layout-mode` (`wide|medium|narrow|compact`).
  Pure functions in `lib/app-map-test-layout.ts` map width → mode and (mode, open) → rail
  presentation, so the whole responsive contract is unit-tested instead of living in an
  unreadable class string.
- `grid-template-columns` is one computed inline value: `<steps> minmax(0,1fr) <device>`. A docked
  rail contributes its docked width; a collapsed **or** overlaid rail contributes the 36px strip, so
  the edge affordance is always in the grid and an overlay only floats the expanded panel above the
  editor. There is no second grid regime and no `grid-template-rows`, so no breakpoint can put the
  device under the editor.
- Rail open state is user intent (`railOverride`), seeded lazily from the mode: an untouched rail
  follows the layout default, and an explicit collapse survives a resize.
- Motion: only colour and `transform` transitions, all wrapped in `motion-reduce:transition-none`.

## 4. Component decomposition

Every component is under the 700-line architecture budget. The orchestrator lands at 477 rather
than the 400 I aimed for, because the grid composition and the rail wiring genuinely belong
together; the two things that did not belong — step mutations and the run lifecycle — moved to
`lib/` hooks.

| File                                    | Role                                                            | lines |
| --------------------------------------- | --------------------------------------------------------------- | ----- |
| `components/app-map-test-workspace.tsx` | State wiring, rails/grid composition, shortcuts                 | 477   |
| `app-map-test-workspace-chrome.tsx`     | `TestWorkspaceBar`, `TestSwitcher` popover, `RailStrip`, empty  | 400   |
| `app-map-test-outline.tsx`              | Steps rail: search, keyboard list, drag arbitration, add footer | 202   |
| `app-map-test-step-row.tsx`             | One row (leaf-first label, drag, row menu) + `StepKindMenu`     | 371   |
| `app-map-test-inspector.tsx`            | Step editor: header, intent, binding, after-step, diagnostics   | 217   |
| `app-map-test-binding-editor.tsx`       | Per-kind section title, instruction/module, scalar dispatch     | 321   |
| `app-map-test-binding-fields.tsx`       | `EditorField`, advanced target, validation/extraction/decision  | 363   |
| `app-map-test-device-evidence.tsx`      | Right rail: `Live`/`Last run` tense switch, step anchor caption | 379   |
| `app-map-test-device-panel.tsx`         | Live pixels, tap targeting, capture disclosure                  | 388   |
| `app-map-test-evidence-panel.tsx`       | `Last run`: this step first, then run, failure, provenance      | 381   |
| `app-map-test-run-control.tsx`          | One-row primary action + run status                             | 92    |
| `lib/app-map-test-layout.ts`            | Pure width → mode → rail presentation → grid template           | 91    |
| `lib/app-map-test-step-path.ts`         | Pure leaf/ancestor split of a step's binding path + row title   | 51    |
| `lib/app-map-test-editor-styles.ts`     | `testEditorInput` / `Label` / `Section` / row recipes           | 39    |
| `lib/use-element-width.ts`              | Guarded `ResizeObserver` accessor                               | 34    |
| `lib/use-app-map-test-step-actions.ts`  | Add / move / reorder / duplicate / delete / undo + focus moves  | 147   |
| `lib/use-app-map-test-run.ts`           | Compile, launch, cancel, attribute, invalidate on edit          | 143   |

## 5. Interaction model

**Selection.** A row click selects and shows the step in the editor. Selection is one quiet cue:
`bg-[var(--product-accent-soft)]` fill plus `--text-interactive-base` on the index. No border, no
left rail, no ring. Hover is the weaker `--surface-base-hover`. `focus-visible` is a 2px
`--border-strong-focus` outline and appears only for keyboard users.

**Keyboard.**

| Key                     | Action                                                   |
| ----------------------- | -------------------------------------------------------- |
| `↑` / `↓`               | Move step selection (roving tabindex, wraps at the ends) |
| `Home` / `End`          | First / last step                                        |
| `Enter`                 | Jump focus from the row to the step's Intent field       |
| `⌥↑` / `⌥↓`             | Reorder the step within its branch                       |
| `⌘Z`                    | Undo the last step delete                                |
| `⌘Enter` in a text area | Commit and blur                                          |
| `/`                     | Focus "Find a step"                                      |
| `[` / `]`               | Toggle the Steps rail / the Device rail                  |
| `Escape`                | Close the open menu, overlay rail, or proposal review    |

**Focus.** Overlay rails trap nothing; `Escape` closes the floating rail and returns focus to the
toggle that opened it. Deleting a step moves focus to the sibling that took its place. Adding a step
focuses the new step's Intent. `/` focuses the step search, opening the Steps rail first if it is
currently a strip.

**Drag reorder.** Rows are `draggable`. A drop is only accepted on a row with the same parent and
branch, and the target edge (`before` / `after`) is drawn as a 2px inset line rather than a moving
placeholder. The index delta commits through `reorderScenarioStepTree`, which reuses the same
sibling-list rewrite as the existing move/duplicate/delete primitives, so no new server operation is
involved. `⌥↑/↓` is the accessible equivalent and keeps the row focused so it can repeat.

## 6. How each diagnosed defect is resolved

**1 — Device reflows to the bottom below 1120px.** Deleted. One grid, one row, three columns; the
device column is present in every mode and only changes width (360 → 304 → 272 → 36px strip +
overlay). Mode comes from the measured container, so an opening library panel narrows the rails
instead of triggering an unrelated viewport breakpoint. `lib/app-map-test-layout.test.ts` asserts
across widths 320–2400 that the template is always three columns, that the editor is always the
middle track, and that an opened device rail always resolves to `docked` or `overlay` — never to
nothing. The browser test drives a real 860px container and additionally asserts
`grid-template-rows` stays empty, which is the exact mechanism that used to push the device below
the editor.

**2 — Four stacked chrome layers.** Collapsed to **one** 44px workspace bar:
`[▤ steps] [Test switcher ▾] [N steps] … [status] [✦ proposals] [▶ Run test] [⋯] [▮ device]`.
The status bar's dot+label moves inline next to the run button; the test picker becomes the
switcher popover (with its own search, `New test`, and per-row overflow); the step search moves
into the Steps rail header where it belongs. Exactly one primary action — `Run test` — and it is
the only filled button on the screen.

**3 — Truncation destroys the distinguishing suffix.** Two changes. (a) A row's **primary** line is
the step's own intent, which is what a human wrote and what actually distinguishes steps. (b) The
binding path renders leaf-first-safe: the ancestors are a `min-w-0 truncate` span and the leaf is a
`shrink-0` span, so `Navigation → Settings → Edit profile → Birth Year` degrades to
`Navigation → Sett… → Birth Year`, never to `Navigation → Settings → Edit p…`. Nesting uses real
indentation with a hairline branch guide plus a `Then`/`Else`/`Loop` chip, so depth is structural
instead of encoded into a flattened string. Full path is in `title` and in the editor.

**4 — Three overlapping names.** The Test name is now editable **only where it is displayed**: the
switcher label turns into an inline input via `⋯ → Rename test`. The `Test name` field is deleted
from the step editor, so the screen shows the map name (window title) and the Test name (switcher)
once each, and never a third copy.

**5 — Dead space and inverted density.** The editor is the `1fr` column with a 640px measure and
20px section rhythm, and it now carries the content that used to be spread across a near-empty
right column: the ordered connections of the selected path, the evidence policy, diagnostics. The
steps rail keeps 44px two-line rows (`min-h-11`, 4px gaps) instead of cramming 39 bordered cards
into 180px. `Capture full page` and its two lines of help move into a closed
`▸ Capture this screen` disclosure at the foot of the device rail, so the rail leads with pixels.

**6 — Device and Results look unrelated to the step.** They are one rail with a tense switch, and
the rail carries a persistent caption `Step 12 · <intent>` directly under the switch. In
`Last run`, the selected step's outcome, frame, and metrics are the **first** card, above the
run-level summary; the compiled revision and provenance sink into a closed disclosure.

**7 — Two switchers both containing "Map", "Results" in both.** Vocabulary is now disjoint at every
level: the shell switches **Test | Map** (which document surface), the map switches
**Canvas | Screens | Coverage** (which view of the map), and the device rail switches
**Live | Last run** (which tense of the target). No label appears in two switchers.

**8 — Weak craft signals.** Bordered boxes-as-decoration are gone: sections are separated by rhythm
and a single hairline, not by nested `fieldset` frames. `Bound` becomes a plain-language state with
a tooltip that says what binding means — `Ready` / `Needs attention` / `Not connected yet` — and the
binding section is titled by what the step will do (`Replays which navigation`, `Runs which module`,
`Checks what`, `Reads which value`, `Branches on what`, `Repeats how often`,
`Asks the person for what`, `Transforms with what`), which removes both `Execution binding` and the
redundant inner `Reusable module` label. Connections become an ordered list where a selected row
shows its **position**, not a tick, because order is the whole point. The capture checkbox becomes a
`@relay/ui` `Switch` row with one helper line under `After this step`. `Note  Optional` becomes
`▸ Add a note`, which reads as an action and expands in place when a note exists.

## 7. Before / after

| Aspect                  | Before                                                        | After                                                                |
| ----------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------- |
| Layout source of truth  | one 5-part arbitrary grid class, 3 viewport regimes           | `data-layout-mode` from a measured container + pure layout functions |
| Device below 1120px     | second grid **row** under the other columns                   | right rail at 272px; at <768px a 36px right strip + right overlay    |
| Chrome rows             | 4 (title bar, status bar, picker, search)                     | 1 (44px workspace bar) + one 36px rail header each                   |
| Primary actions visible | `New`, `Add step`, `Run test`, `Capture full page`, `Refresh` | `Run test` (filled); the rest are secondary or in overflow           |
| Step row primary text   | step **kind** ("Instruction")                                 | the step's **intent**                                                |
| Step row secondary text | flattened path, tail truncated                                | leaf-preserving path with truncating ancestors + real indentation    |
| Test name shown         | 3× (title bar, picker, editor field)                          | 1× (switcher, rename in place)                                       |
| Evidence ↔ step link    | none; two unrelated column headers                            | one rail, tense switch, persistent `Step N · intent` caption         |
| Binding UI              | `fieldset "Execution binding"` → `label "Reusable module"`    | one section titled by intent, e.g. `Runs which module`               |
| Binding status badge    | `Bound`, unexplained                                          | `Ready` / `Needs attention` / `Not connected yet`, with a tooltip    |
| Evidence policy control | checkbox + 2-line helper                                      | `Switch` + 1 helper line                                             |
| Note                    | `Note   Optional` bordered box                                | `▸ Add a note` disclosure                                            |
| Step reorder            | overflow menu only                                            | drag, `⌥↑/↓`, and overflow menu                                      |
| Step navigation         | tab through 39 buttons                                        | roving `↑/↓`, `Home`/`End`, `Enter` to edit                          |
| Mobile                  | 4-tab pane switcher, device in a bottom row                   | two overlay rails with edge affordances; device always on the right  |
| Control text size       | 16px inputs everywhere                                        | 13px control / 11px caption per the type scale                       |

## 8. Deliberately behind progressive disclosure

Nothing is removed. These move out of the default view: duplicate/delete/rename Test, full-page
capture and its policy explanation, the compiled revision + root recipe id, step provenance, the
advanced stable-identifier fields, the step-kind list (behind `+ Add step ▾`), and per-step
move/duplicate/delete (row overflow, with keyboard equivalents).
