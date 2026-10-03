---
name: relay-debug-and-record
description: Reproduce an app issue or record a reusable Relay Test, including reviewing accidental actions and preserving a failed attempt.
---

# Record a reusable Test

1. Read `relay://guides/record`, `relay://guides/targets`, and
   `relay://guides/waits`. Call `relay_panel`, then call it with the chosen
   `appMapId` to check whether the journey already exists. Read detailed steps
   at `relay://app-maps/<appMapId>/tests/<testId>` with the returned IDs.
   Choose the intended ready target through `relay_connect_target` and observe
   its starting screen.
2. Call `relay_record_test` with the App, target and a clear title. This starts
   the existing durable authoring workflow. Keep its returned workflow ID
   and exact version for every subsequent decision.
3. Send typed actions through `relay_record_action`, using the latest version
   returned after each action. Use `relay_preview` before an uncertain tap;
   on a native target pass its serial, on a browser pass its saved Lane.
   Add useful named evidence through `relay_add_checkpoint`.
4. Call `relay_stop_recording`, then inspect the workflow. Remove or rename
   accidental actions with `relay_edit_recording`. An edit requires replay
   of that exact revision through `relay_replay_recording` before saving.
5. Save with `relay_approve_recording` only when the canonical workflow says
   approval is allowed. An unchanged recording may already qualify. If replay
   failed, retain its evidence and repair deliberately; preserve the failure.
6. Return the saved App/Test IDs and evidence, then run the saved Test once
   through `relay_run_test` when validating repeatability is part of the task.

Use `relay_inspect_workflow` after an interrupted or uncertain operation;
unknown mutation outcomes permit inspection rather than repeated input.
A fixed wait and an unchanged screenshot cannot establish asynchronous
completion. If this tool schema cannot express the required observable wait,
add that condition using Relay's existing Test editor and retain the gap.
