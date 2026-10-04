# TesterArmy customer and supporting post audit — 2026-10-04

This note covers seven official posts assigned from the complete 16-video media inventory collected by the parent audit. Post metadata comes from the parent's live X DOM inventory, `.relay/testerarmy-video-inventory-oct04.json`. View figures are rounded public **post views**, observed on October 4; they are not video completions, unique viewers, organic reach, or customer conversions.

## Playback coverage

This subagent could not watch these clips: its CUA inventory exposed no browser, and both `createBrowserTab("iab", …, {visible:true})` and `createBrowserTab("3", …)` returned “Browser is not available.” A direct web read of the Juno X post also returned 403. The parent has separate playback evidence and can supplement this note. No opening/middle/end timestamps, audio review, or transcript review are claimed here. The official customer pages below were read directly. Their statements are vendor-published customer accounts, not independent performance measurements.

## Assigned posts and observed copy

| Primary post                                                                         | Duration from parent inventory | Public post views | Copy and role                                                                                   |
| ------------------------------------------------------------------------------------ | -----------------------------: | ----------------: | ----------------------------------------------------------------------------------------------- |
| [September 21 teaser](https://x.com/TesterArmy/status/2102074969555603950)           |                       13.376 s |               10K | “Coming soon” plus the e2e destination; curiosity before release.                               |
| [September 14 Juno](https://x.com/TesterArmy/status/2099513907845210522)             |                       84.900 s |               45K | Named CEO, shipping outcome, merged PRs, and reclaimed testing time; customer evidence.         |
| [September 4 open source](https://x.com/TesterArmy/status/2095922474219381044)       |                       12.500 s |              2.1K | One page for MIT tools built for the team's own agents and CI; developer utility.               |
| [August 29 small refactor meme](https://x.com/TesterArmy/status/2093715352396112056) |                       23.267 s |              1.3K | PR-title joke; familiarity with development pain.                                               |
| [August 28 Friday deploy meme](https://x.com/TesterArmy/status/2093288402292736087)  |                       15.003 s |               813 | Deploy/code-review joke; familiarity with development pain.                                     |
| [August 27 Novu](https://x.com/TesterArmy/status/2092980904541188541)                |                       16.491 s |               62K | Named CTO and two claimed improvements; customer evidence linked to a case study.               |
| [August 25 Resend](https://x.com/TesterArmy/status/2092267087578509525)              |                       22.366 s |               40K | Named recognizable customer, testing every PR, and reciprocal email relationship; announcement. |

The three customer announcements in this subset have 40–62K public post views; the two memes have 813–1.3K. This is a descriptive comparison of different dates and topics. Distribution, paid promotion, audience, and the site's view-counting behavior are unknown. It does not establish why one post reached more people. It also shows that TesterArmy's official video feed is not uniformly reaching a million views.

## Customer evidence relevant to Relay

[Juno's first-party case study](https://tester.army/customers/juno) describes a mobile team whose CEO manually tested both platforms, then added a suite to each PR. It reports 501 July merged PRs and 791 in August, a 58% increase. The engineer joined August 10 and TesterArmy first ran August 14; team growth also accompanies the comparison. The CEO's tenfold figure is his throughput estimate, and the page distinguishes feature throughput from the duration of one release. Prior approaches failed through long setup, agent stalls, lost context, and absent PR integration. The story makes the buyer's recurring job and the previous pain legible. Relay should demonstrate a saved test running on a subsequent change, with retained failure evidence, and later substantiate usefulness through a real customer's repeated use.

[Novu's first-party case study](https://tester.army/customers/novu) describes a switch from outsourced test maintenance to tests the team could change and inspect itself. The decisive first experience was signing up and entering the authenticated product with little guidance. Saved flows run on staging; recordings explain the agent's path. The roughly 30% faster merges and 50% fewer flaky tests are the CTO's estimates, and the page explicitly says neither is formally tracked. Relay's saved Accounts, reusable Tests, replay, and visible evidence should be demonstrated as one complete task. An easy authenticated first run is a stronger product lesson here than copying the headline percentages.

[TesterArmy's customer index](https://tester.army/customers) says its stories use recorded interviews and customer-supplied numbers. Other testimonials repeatedly mention the first successful run, short setup, authentication, caught regressions, and PR coverage. A customer reference is credible when the person, app, job, result, and limits can be inspected together. The Resend X copy announces usage, but this subagent found no accessible Resend case study at the guessed `/customers/resend` URL and did not infer measured impact.

[The official open-source page](https://tester.army/open-source) gives each tool a purpose and a command. It offers CLI/agent entry points and distinguishes tools needing an account from those that do not. The website shown today may differ from the September 4 clip. For Relay, the practical launch implication is a public, supported install followed by one successful task, with a readable result an agent and a human can both use. A generic tool collection announcement alone has low observed reach in this subset.

## Recommendations inferred from these sources

1. Build the launch around one recognizable job: record or define a flow, save it, run it on a changed app, inspect a meaningful result. Name the user and the app in the demonstration.
2. Show login/account setup as part of that task, because authenticated access is a repeated buyer obstacle in the customer accounts.
3. Make the visible payoff understandable in the first few seconds; use a later customer film for the longer explanation. This is an editorial hypothesis to test, since this subagent could not assess the clips' actual openings.
4. Gather customer evidence after recurring use: setup time, repeated-run success, actionable failures, and time recovered. Record methods and denominators. Use estimates as estimates.
5. Treat memes as optional experiments. The two supplied examples offer no observed evidence that meme posting produces high reach for this brand.

The parent audit owns the comparison with Relay's current implementation, founder/partner distribution, Revyl playback, and the final priority order. No source code or product changes were made in this subtask.
