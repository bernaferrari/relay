---
name: relay-run-and-review
description: Write a Relay Test from a description, run it and read the verdict, check a code change against an App's Tests, inspect a failure, or export evidence.
---

# Describe, run, read the verdict

1. Read `relay://guides/describe`; for a failure read `relay://guides/debug`.
   Call `relay_health`, then `relay_panel` (with an `appMapId` for that App's
   Tests) so you reuse an existing Test instead of writing a duplicate.
2. New coverage: call `relay_create_test` with one sentence (or one step per
   line) and the `url` or `app`. It saves the Test and returns the exact
   `relay_run_test` call. Steps written from words need a model key.
3. Call `relay_run_test`. It waits and returns one verdict: passed, failed,
   blocked or cancelled, with the failing step's expected vs. saw and a
   screenshot. Pass `targetId` from `relay_connect_target` when several
   targets are ready. If it returns `running`, call `relay_get_verdict` later.
   A risk report needs a deliberate repeat with transport `confirm: true`.
4. After changing code, call `relay_check_change` with the App and, when known,
   the changed `areas` or `testIds`. It runs the relevant ready Tests and
   returns their verdicts. This is a quick signal, not a merge decision; gated
   merge checks use the Proof flow (`relay-proof` skill, proof profile).
5. For a failure, call `relay_inspect_failure` for evidence and repair options.
   Propose a repair only when asked; the original attempt is kept.
   Export a Run with `relay_export_evidence` for a reviewer.
6. For explicitly requested data values, use `relay_repeat_test` for one pilot,
   then `relay_continue_repeat` with explicit confirmation.

Finish with the App/Test/Run IDs, the verdict, and the failing step if any.
A human makes screenshot review decisions; agents summarize evidence.
