# Relay product contract

This is the authoritative product-facing contract for Relay V2. It governs names, routes, and
interaction behavior for the application UI. Protocol, workflow, CLI, and audit APIs may retain
their richer implementation vocabulary; those terms must not leak into ordinary UI copy.

## Promise and public model

Relay proves that software written by humans or agents works on real apps, browsers, and devices.

The six primary objects are **App** (the product being verified), **Test** (one reviewed,
repeatable journey), **Run** (one execution of a Test), **Change** (code claiming to alter product
behavior), **Device** (where the product executes), and **Session** (a durable live browser or
device workspace used for recording and debugging).

Supporting public terms are **Step** (an **Action** or a **Check**, written in plain English),
**Plan** (saved Tests and Data sets run together), **Environment** (a reusable execution setup),
**Report**, **Proof**, **Recording**, **Data set**, and **Map**. Describe, Record, Repeat, Explore,
and Verify are actions.

A Test starts from what should work, in a sentence. Relay writes Action and Check steps; Actions
run with a model choosing each tap, and Checks are decided from the screenshot. Recording is an
optional way to make a step exact and faster, never the opening toll. A failed Check states what
was expected and what Relay saw.

The Map grows from every Run on its own: screens a Run reaches are added, and the moves between
them are added as draft paths that Tests never replay. People correct the Map (rename, merge);
they do not approve each screen. Creating a Map is never an opening toll.

The normal user-facing flow is:

```text
Describe (or Record) → Test → Run → Verdict → Map grows
Change → relay ci / relay_check_change → Verdicts
```

## Canonical routes

```text
/apps
/apps/:appId
/versions
/accounts
/apps/:appId/map
/tests
/tests/new
/tests/:testId
/apps/:appId/suites/:suiteId
/environments
/environments/:profileId
/recordings/:recordingId
/recordings/:recordingId/review
/review
/runs
/runs/:runId
/batches/:batchId
/devices
/devices/:deviceId
/settings/general
/settings/evidence
/settings/integrations
/settings/appearance
/settings/advanced
/settings/about
```

Versions and Accounts are workspace resources; an app selection does not imply ownership of
those resources. Primary navigation is Tests and Runs, with the Map following the chosen App, and
Accounts and Devices as setup. Plans are groups in the Tests library, and app management belongs
in the app selector. Checking a code change is a CLI and agent loop (`relay ci`,
`relay_check_change`), not a screen.

Selected entities and useful substate belong in the URL. Query state may include `status`, `app`,
`view`, `step`, `screen`, `session`, `test`, `result`, and `section`. Every route has one parent, title, primary object, primary
action, sidebar selection, Back behavior, restorable view state, and explicit loading/error rules.

## Interaction laws

1. The router is the navigation authority. Back and Forward (including Electron and mouse Back)
   use router history; feature-specific return memories are not allowed.
2. Escape closes exactly one topmost transient layer, in this order: menu, popover, inline editor,
   dialog, sheet, temporary inspector, canvas selection. Escape never cancels a Run or navigates.
3. Each page has one dominant action: Tests/New Test, Test/Run, Recording/Stop, Review/Replay,
   passing Replay/Save Test, failed Run/Fix Test, and Map/Explore App.
4. Only one contextual side surface is open at a time.
5. Save state is always visible: Saved, Saving, Offline — saved locally, Could not save, or
   Unsaved changes. Route changes preserve or flush recoverable drafts.
6. Sessions, Recording, Runs, and Plan runs persist in the Activity Center
   across routes.
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

## One product shell

React Product is Relay's only browser and Electron product shell. Retired Studio, Results,
Settings, onboarding, Combine, Variable, focus, and tooltip implementations are not compatibility
surfaces and must not be reintroduced alongside the canonical routes.
