---
name: relay-debug-and-record
description: Record a Relay Test when steps must be exact and model-free, reproduce an app issue, review accidental actions, and preserve a failed attempt.
---

# Record an exact Test

Start from a description (`relay_create_test`) when that is enough. Record
when a step must be exact, fast, or run without a model, or to reproduce an
issue precisely.

Recording needs the `device` profile (the plugin's default).

1. Call `relay_get_guide` for `record`, `targets` and `waits`. Call
   `relay_list_tests` for the chosen App to check whether the journey already
   exists. Choose the ready target through `relay_list_devices` and look at its
   starting screen with `relay_observe_target`.
2. Call `relay_record_test` with the App, target and a clear title. Keep the
   returned workflow ID and exact version for every following call.
3. Send actions through `relay_record_action`, using the latest version after
   each one. Use `relay_preview` before an uncertain tap. Add an expect or
   wait-for check for the outcome; `relay_add_checkpoint` names a screenshot.
4. Call `relay_stop_recording`, then `relay_inspect_workflow`. Fix accidental
   actions with `relay_edit_recording`; an edit needs a passing
   `relay_replay_recording` of that revision before saving.
5. Save with `relay_approve_recording` when the workflow allows approval. If
   replay failed, keep its evidence and repair deliberately.
6. Run the saved Test with `relay_run_test` and report its verdict.

After an interrupted or uncertain operation, inspect with
`relay_inspect_workflow` instead of repeating input. A fixed pause or an
unchanged screenshot cannot prove that something finished.
