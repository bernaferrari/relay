# Product direction

Relay should be the fastest way to know whether your app still works, on the
devices you own, from a sentence, with an answer you can trust.

## What we compete on

|               | Relay                                                       | Revyl                      | TesterArmy                |
| ------------- | ----------------------------------------------------------- | -------------------------- | ------------------------- |
| Where it runs | Your machine, your devices (physical, simulators, browsers) | Their cloud, mobile only   | Their cloud               |
| A test is     | A plain-English file in your repo                           | YAML synced to their cloud | Steps in their dashboard  |
| Steps run by  | A model, or an exact recording when one exists              | Their agent                | Their agent               |
| Result        | Passed / Failed / Blocked with expected vs. saw             | Verdict + report           | PASSED / FAILED / BLOCKED |
| Map           | Grows from every run                                        | Atlas                      | None                      |
| Price         | Free, your model key                                        | Per device minute          | Per run                   |

Win by being **local, file-based, and verdict-first**, and by making
recordings an accelerator, not a requirement.

## The whole product in four nouns

- **App**: what you test (a website or a phone app).
- **Test**: a file of plain-English steps (`check:` for checks).
- **Run**: one execution, ending in a verdict.
- **Map**: the screens runs reached and how they connect.

Everything else (Plans, Data sets, saved sign-ins, recordings, proofs) is an
option on one of these, never a fifth noun people must learn first.

## The three loops

1. **Describe → run → verdict.** A sentence or a test file becomes steps; a
   run answers passed, failed (the app misbehaved) or blocked (Relay could
   not finish), and a failure says what was expected and what Relay saw.
2. **Change → check.** After a code change, `relay ci` (or an agent's
   `relay_check_change`) runs the app's tests and reports verdicts.
3. **Runs → map.** Every run adds what it saw; people fix mistakes rather
   than approve screens.

## Rules we hold ourselves to

- One verdict shape everywhere: desktop, CLI, `relay ci`, agents.
- One way to do each thing in the everyday surface; advanced commands live
  behind `relay advanced` and the command palette.
- People review only what changed. Matching and first-passing screenshots
  never become homework.
- No engine internals in user copy: no selectors, coordinates, package ids,
  campaign or Lane jargon, or product-specific examples in generic help.
- A test file edit never throws away a recording whose words did not change.

## Next, in order

1. **Agents and CLI on the same loop**: `relay test new`, `relay ci`,
   names instead of ids, tables for people, verdicts for agents.
2. **Test accounts that sign in by themselves**: saved sign-ins per app,
   plus a connected test inbox (IMAP) so steps like "Enter the code from
   the email" work locally, without a hosted mail service.
3. **Replay cache**: when a plain-English step succeeds, keep the taps it
   chose; next run replays them and falls back to the sentence if the
   screen changed. Fast and exact by default, adaptive when needed.
4. **Pull-request check**: a GitHub Action around `relay ci` that comments
   the verdict table and failing screenshots.
5. **Cuts**: retire screens and commands nobody reaches from the everyday
   loop (prototype workbenches, duplicate run commands, deprecated aliases),
   after checking their tests and callers.
