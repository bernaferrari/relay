# Relay Product V2 contract

This is the authoritative product-facing contract for Relay V2. It governs names, routes, and
interaction behavior for the application UI. Protocol, workflow, CLI, and audit APIs may retain
their richer implementation vocabulary; those terms must not leak into ordinary UI copy.

## Promise and public model

Relay proves that software written by humans or agents works on real apps, browsers, and devices.

The five primary objects are **App** (the product being verified), **Test** (one reviewed,
repeatable journey), **Run** (one execution of a Test), **Change** (code claiming to alter product
behavior), and **Device** (where the product executes).

Supporting public terms are **Checkpoint**, **Report**, **Proof**, **Recording**, **Data set**, and
**Map**. Record, Repeat, Explore, and Verify are actions. Map is derived, optional App intelligence;
creating a Map is never an opening toll.

The normal user-facing flow is:

```text
Coverage: App → Record → Review → Replay → Test → Run → Report
Verification: Change → Verification plan → Runs → Evidence → merge decision
```

## Canonical routes

```text
/home
/apps
/apps/:appId
/apps/:appId/versions
/apps/:appId/accounts
/apps/:appId/map
/tests
/tests/new
/tests/:testId
/tests/:testId/edit
/tests/:testId/record
/tests/:testId/run-across
/recordings/:recordingId/review
/runs
/runs/:runId
/batches/:batchId
/changes
/changes/:changeId
/devices
/devices/:deviceId
/settings/general
/settings/evidence
/settings/integrations
/settings/appearance
/settings/advanced
/settings/about
```

Selected entities and useful substate belong in the URL. Query state may include `status`, `app`,
`view`, `step`, `screen`, and `section`. Every route has one parent, title, primary object, primary
action, sidebar selection, Back behavior, restorable view state, and explicit loading/error rules.

## Interaction laws

1. The router is the navigation authority. Back and Forward (including Electron and mouse Back)
   use router history; feature-specific return memories are not allowed.
2. Escape closes exactly one topmost transient layer, in this order: menu, popover, inline editor,
   dialog, sheet, temporary inspector, canvas selection. Escape never cancels a Run or navigates.
3. Each page has one dominant action: contextual Home (Prove current change, Add missing Test,
   Record first Test, Review failure, Continue recording, or Add an App), Tests/New Test, Test/Run,
   Recording/Stop, Review/Replay, passing Replay/Save Test, failed Run/Fix Test, Change/Verify
   Change, and Map/Explore App.
4. Only one contextual side surface is open at a time.
5. Save state is always visible: Saved, Saving, Offline — saved locally, Could not save, or
   Unsaved changes. Route changes preserve or flush recoverable drafts.
6. Recording, Runs, Repeat, and Change verification persist in the Activity Center across routes.
   UI state may project server state but cannot decide completion, mutation, pass, or approval.

## Responsive and accessibility contract

The minimum supported desktop window is 800×560 CSS pixels. At narrow widths, side surfaces become
toggleable overlays, the primary content remains usable without horizontal scrolling, and the
dominant action stays reachable. At 200% zoom and with keyboard navigation, focus order and focus
restoration remain intact. Empty, loading, blocked, offline, success, and failure states explain
the next useful action inline.

## Public vocabulary boundary

Ordinary UI copy may use the public model above. The following implementation/audit terms are
advanced-only and must be disclosed only in Developer, Audit, diagnostics, or advanced authoring:

```text
App Map, Take, Variable, Combine, Cell, World, Lease, Lens, digest, binding,
runtime profile, plan digest, publication receipt, Campaign, Connection
```

Use “Repeat”, “Data set”, “Device”, “Report”, and “Proof” in ordinary flows instead. **Proof** is
the successful evidence-backed result of verifying a Change, not an object users must create.

## Legacy expansion freeze and deletion targets

Until V2 replaces a route, legacy work is limited to correctness, trust, evidence, device
reliability, security, and blocking fixes. Do not add Map modes, report tabs, Settings categories,
rails, top-level nouns, visual themes, or public Combine/Variable surfaces to the legacy shell.

V2 will delete StudioShell, MapModeSwitch, feature-specific Run return navigation, custom focus
trapping, custom tooltip layers, the old Settings modal, legacy Results mode, public Combine UI,
duplicate Variable surfaces, and the old onboarding as each replacement route reaches parity.
