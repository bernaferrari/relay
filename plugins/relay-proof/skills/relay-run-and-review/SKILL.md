---
name: relay-run-and-review
description: Run a saved Relay Test, repeat selected data values, inspect a failed Run, or export retained evidence for review.
---

# Run and review

1. Read `relay://guides/run`; for a failure read `relay://guides/debug`, and
   for sharing read `relay://guides/review`. Find the exact App/Test in its
   resources and select the intended target. A saved Test can run directly.
2. Call `relay_run_test`. Keep the returned workflow ID and version. Inspect
   through `relay_inspect_workflow` until the server reports completion or a
   concrete blocker. A queued request is not a completed Run.
3. For explicitly requested data values, use `relay_repeat_test` for one
   representative pilot. Inspect its result before `relay_continue_repeat`;
   continuation requires explicit confirmation and the latest version.
4. Inspect a failed Run with `relay_inspect_failure`. Return the failed check,
   expected versus observed state, target, and evidence. Propose a repair only
   when requested; proposals remain reviewable and retain the original attempt.
5. Export an existing Run through `relay_export_evidence`. Finish with the
   Run ID, exact result, evidence references and any missing captures or review.

Functional completion, captured screenshots, and human visual review are
separate results. A human makes review decisions; agents summarize evidence.
Keep interrupted or unknown outcomes inspectable and preserve target identity.
