# Relay Luna usability scenarios — October 4, 2026

## Method and limits

The user authorized Luna simulations of first use, recovery, and teammate handoff. Four Luna personas used the product through the in-app browser. Three independent sessions could open their own tabs; later turns and one initial recipient session could not. For those attempts, the root agent executed Luna's chosen actions and returned actual UI snapshots. Those portions are explicitly mediated.

Only the existing synthetic site on `127.0.0.1:8793` was exercised. The real-human acceptance fixture on port 8794 and disconnected phone were untouched. No accounts were revoked, no existing checks weakened, and no screenshot review decisions were changed.

Agent simulations are useful friction probes. They do not replace unfamiliar-human acceptance (`agent-device-7zd2`) or real customer pilots (`agent-device-4gxi`). They do not establish a product-wide usability score or competitive superiority.

## Scenarios and retained outcomes

| Scenario | Mode | Observed outcome |
| --- | --- | --- |
| First-time user finds and repeats a saved account test | Independent Luna UI session | `Saved account reuse - Oct4 Admin`, three steps, passed in 17 seconds. Run `e4b7c1d8-3297-474e-bfd0-fcd34f452001`. All three screenshots remained pending review. |
| Teammate identifies run provenance and review status | Root-mediated Luna decisions | Recipient took an Accounts detour, which did not establish which account ran the test. More → Configuration only showed saved target and chromium. No account identity was recorded. |
| Agent unavailable: diagnose a reported failure manually | Independent initial Luna UI session; mediated recheck | Run `73df31a6-6c53-4629-8bd6-f4bbbcd2c248` had passed execution steps but three reported screenshot issues. After the change, Luna immediately identified the screenshot issues and chose the direct review link. |
| Record, add a check, save, and repeat as Member | Root-mediated Luna decisions | Saved `Luna Oct4 manual settings`, Test `test-authoring-33901866-efd4-4803-a9a2-15a3e7223ac2`, using the existing Oct4 Member / Browser 24 setup. Tap Settings and check “Account member” is on screen. Run `21e34ab8-4f1e-4e2a-9a7b-b86b950ba375` passed both steps in 3.9 seconds. Two screenshots remained pending review. |
| Fresh recipient repeats the handoff inspection | Independent Luna UI session | Found the saved execution outcome, missing account provenance, pending screenshots, and More → Download walkthrough without the earlier Accounts detour. Preparation produced the download link; actual browser download was not verified. |

The manual recording required no agent runtime: all actions used Relay's recording stage, Wait or check dialog, review, and Run button. Luna reported no mistaken clicks in that mediated sequence. It still found the combined wait/check dialog and explicit text entry somewhat difficult to discover.

## Repairs

| Before | After | Why |
| --- | --- | --- |
| Passed test steps plus reported screenshots produced an unexplained Failed report heading. | The report says **Screenshot issues** when execution passed and a reviewer reported an issue. Actual execution failures still say Failed. | The user can identify the source of the problem before changing a check or rerunning. |
| A recipient had to find the review tab to discover pending or reported screenshots. | The outcome line links directly to the screenshots needing review or carrying reported issues. | The next action is visible beside the outcome. |
| Browser/account context was buried, and absent account provenance was silently omitted. | The report shows recorded browser/account context. Missing identity says **Account not recorded**; configuration includes the account field, recorded viewport, and language. | Current account records and test titles must not be mistaken for frozen run provenance. |
| A standalone captured-screen export was available only inside Explore screens. | More → **Download walkthrough** uses the existing canonical `run.walkthrough-pack.get` service and HTML renderer. Raw JSON evidence export remains available separately. | A teammate can discover the existing human-readable artifact from the report. This is a captured-screen walkthrough, not a new full report renderer. |
| An earlier successful download link could remain after another export failed. | Starting a fresh export clears and revokes the previous download URL. | A refused or changed-evidence export must not expose a stale copy as its result. |
| A saved screenshot request briefly showed **No screen yet**. The media query could also reuse the previous run's frame while selecting a new run. | Pending media gets a quiet, accessible placeholder; blob URLs must match the current blob. A failed request offers Retry screenshot. | Loading is distinct from missing evidence, and a current frame label must never describe another run's pixels. |

## Handoff evidence and remaining work

The root and fresh recipient both prepared a canonical walkthrough through the UI. Their browser download operations timed out. The canonical Relay CLI separately saved an actual HTML artifact at `.relay/oct04-luna-offline-handoff/walkthrough.html`. The browser's security policy refused navigation to a local `file:` URL, so recipient opening outside Relay was not qualified. No alternate browser or policy workaround was used. `agent-device-od9w` remains open, including the earlier transient export timeout whose cause was not reproduced.

The new Member run retains its authentication fixture ID in the frozen browser profile, but no account or authentication-health identity. Capture details also expose the existing `grok-com` configuration label on the synthetic site. `agent-device-bkix` tracks freezing the selected account reference and label separately from observed identity; old runs must not be backfilled from mutable catalog data. `agent-device-mr1g` remains the browser/configuration provenance and naming follow-up.

The controlled synthetic layout defect (Team seats and Save overlap) remained visible. The test checks Account member, so a functional pass is expected and does not certify that layout. Pending screenshots were not silently accepted.

Quality evidence is retained in `.relay/oct04-luna-*` logs: app tests, focused report/export/media regressions, types, formatting/lint, architecture/docs, and build checks. The media regression is also run against the original implementation to establish that it detects previous-run pixels, rather than only checking new markup.

The full app suite passed 1,228 tests before the isolated media repair. The final report/export/media run passed 21 tests, root `vp test` passed six tests, and final types, formatting/lint, architecture, documentation, and app build checks passed. Against the original media implementation, the new regression failed because `blob:first` was still visible after switching to the second Run. The repaired implementation passed. The build retained existing bundled dependency warnings.
