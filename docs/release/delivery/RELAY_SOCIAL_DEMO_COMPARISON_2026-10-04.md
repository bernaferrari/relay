# Relay, TesterArmy and Revyl: adoption and demo findings

Observed October 4, 2026. Beads: `agent-device-z1xw`, `agent-device-rehi`, `agent-device-cp5z`, `agent-device-9hx2`. Relay source baseline: `2f41d440a`; the changes described below follow that baseline. This is evidence for product decisions, not instructions to publish, contact people, buy services, or accept a visual baseline.

## What the million-view posts actually were

TesterArmy's [founder launch](https://x.com/o_kwasniewski/status/2105675143464763540) displayed **1,173,344 post views** at inspection. It was a static announcement with a concrete setup command and destination, rather than a product video. It was followed by an [Expo quote](https://x.com/expo/status/2105697228627247231), a [Guillermo Rauch quote](https://x.com/rauchg/status/2105723481413550427), explanatory posts, and an actual [Expo integration guide](https://docs.expo.dev/guides/using-e2e/). The guide creates a route from interest into an existing developer workflow, without requiring a TesterArmy account for the open-source framework.

Revyl also had million-view posts: the [Parrot integration article](https://x.com/tryrevyl/status/2062700910950969749) displayed **1,487,139 post views**, and its [company quote](https://x.com/tryrevyl/status/2062702806117835259) displayed **1,250,317**. The article includes coding-agent/cloud-phone footage. Their smaller ordinary feature demos should not obscure this larger article reach.

These are changing public post counters. They do not reveal unique viewers, video completion, paid versus organic reach, installs, revenue, retention, or which element caused distribution. Quote audiences overlap. We do not have equivalent Relay funnel data, so “our interface caused fewer views” is not an established diagnosis.

**Inference:** the strongest observed adoption pattern is a clear developer job, an executable entry point, credible demonstrations, and distribution through relevant people and ecosystems. Interface quality affects whether the invitation succeeds after the click. It cannot by itself guarantee a million views.

## Coverage and playback limits

We used the Codex inline browser, public primary pages and local Relay source. No social posts, messages, likes, follows, signups, purchases, or competitor installation were performed.

| Corpus                                              | Coverage                                                                                                                                                                                                    | Limits                                                                                                                                                                                                   |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TesterArmy visible main Posts feed                  | 57 distinct timeline items; **28 video-bearing posts**: 16 direct uploads and 12 quoted demos. Decoded visual samples for all 28. Visible bottom reached March 10.                                          | Header said 154 posts. Replies and all original founder posts are not an exhaustive account archive. Reused footage is counted by post, not as unique assets. One meme has only partial ending coverage. |
| TesterArmy linked explainers                        | Official 101-second YouTube video and founder-shared 239-second creator video. Official auto transcript read fully; visual sequences sampled.                                                               | Creator narration only partially reviewed. No complete X audio audit.                                                                                                                                    |
| Revyl visible main feed and discovered thread clips | **143 video-bearing company post URLs**: 18 native, 5 thread/reply, 120 quotes. All attempted; 142 have decoded visual samples. Of those, 132 have start/intermediate/near-end coverage and 10 are partial. | July 5 post `2073838323966292247` stayed poster-only. Samples do not constitute every-frame or full spoken-audio watching. Repeated quoted assets are not unique videos.                                 |
| Revyl integration article                           | Two article GIFs visually sampled.                                                                                                                                                                          | Partial visual coverage; not a benchmark reproduced by us.                                                                                                                                               |

The [TesterArmy video ledger](./TESTERARMY_PRODUCT_VIDEO_AUDIT_2026-10-04.md), [Revyl video ledger](./REVYL_SOCIAL_VIDEO_AUDIT_2026-10-04.md), and [launch distribution audit](./TESTERARMY_DISTRIBUTION_AUDIT_2026-10-04.md) preserve source links, timestamps, observations and limits. Captions and vendor demonstrations are evidence of what they communicate, not independent product qualification.

## What the strongest examples teach

### 1. Show a complete task, with a visible consequence

TesterArmy's [Android Kick flow](https://x.com/TesterArmy/status/2063043884759085112) ends with an actual application screen and passed steps. Its [launch defect report](https://x.com/TesterArmy/status/2031426098181857564) makes the failure inspectable through expected/observed evidence and replay. Some other clips end at generated tests with no run, or hide their payoff in small desktop text. They are not all format examples worth copying.

Revyl's [report demonstration](https://x.com/tryrevyl/status/2026402701027025181) puts a phone beside the selected action and its validation. Its [parallel-phone clip](https://x.com/tryrevyl/status/2038782670197625313) is impressive visually, but ends with a mixed, unfinished batch. We should show the actual outcome of a named task, including failures or work still running.

For Relay, the clearest candidate story is: record a short flow, save it, replay it, inspect the retained result, identify a deliberate defect, fix it, and rerun the same Test. The whole path must actually work. A passing action replay alone does not prove visual correctness.

### 2. Explain why the check deserves trust

The [e2e cache documentation](https://e2e.tester.army/docs/cache) distinguishes verified action replay from live assertions, waits and extraction, with matching-context requirements and fallback. A [quoted cache demo](https://x.com/TesterArmy/status/2097668756801503394) visibly ends with eight passes and three model calls. A broad zero-cost claim would misrepresent that clip.

The launch also led to [questions about an agent judging its own work](https://x.com/ItsGoharr/status/2105799463239614536), with a [founder response about exact checks and separate judging](https://x.com/o_kwasniewski/status/2105889861890617819). Relay already separates execution from human screenshot review. We should demonstrate that distinction with a known defect, an explicit expected condition, and retained evidence rather than adding another green badge.

Revyl's [bouncing-ball validation](https://x.com/tryrevyl/status/2094952135943471452) communicates a condition over time. Relay's named screenshot sequences and completion waits are useful, but this audit does not establish equivalent temporal judging. An unchanged screenshot is not sufficient proof that generation completed.

### 3. Make the evidence the first thing people can read

Revyl's [mobile performance replay](https://x.com/tryrevyl/status/2049636353386942641) places a phone, timeline and CPU graph together; [its optimization clip](https://x.com/tryrevyl/status/2043848823873904729) explains a before/after with a simple graph. These are publisher demonstrations, not reproduced performance benchmarks.

Relay already has screenshot history, logs/network panels and a performance panel. The opportunity is to explain one relevant failure without opening several technical panels. Our existing performance panel correctly describes approximate saved-step selection; a demo should not imply exact-frame correlation where none was captured.

### 4. Fit the coding agent's existing workflow

TesterArmy's open-source [quickstart](https://e2e.tester.army/docs/quickstart), [agent entry point](https://tester.army/e2e), and [Expo guide](https://docs.expo.dev/guides/using-e2e/) offer concrete actions. The short command still has real Node and platform prerequisites. A reported [obsolete package-name bug](https://github.com/tester-army/e2e/issues/743) shows why those snippets need execution checks.

Revyl's [Swift iteration demonstration](https://x.com/tryrevyl/status/2042050478985638209) makes a changed device UI the payoff of a coding loop. Its annotation/agent/PR examples give users a bridge from seeing a problem to asking for a fix. Relay already has an MCP/plugin interface, offline task guides and saved-Test execution. The gap is a polished first task and, longer term, a direct evidence-to-agent handoff—not inventing a second agent runtime.

## Relay: present capabilities versus unqualified promises

| Task                       | Present in Relay                                                                                                           | What this audit has not established                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Manually record and repeat | Canonical App Map, saved editable Tests, action recording, browser repeat, per-run evidence.                               | Fresh-user ease across supported operating systems or physical devices.                                               |
| Agent access               | CLI, MCP, plugin skill and offline guides. Local runtime/MCP release candidates exist.                                     | A published package or standalone desktop installer that succeeds on a fresh supported host.                          |
| Result inspection          | Screenshot review, history, logs/network, performance samples, export and read-only share links.                           | Complete video/motion oracle, exact device-state/SQLite diff or all competitor cloud capabilities.                    |
| Generation waits           | Expected-condition and response-completion logic, busy/error/quota diagnostics, bounded polling and retained observations. | Pixel stability alone as completion, or the entire requested Grok image/video workflow on the physical phone.         |
| Fix handoff                | Agents can consume the same retained Test/Run evidence.                                                                    | A qualified one-action screenshot annotation → coding agent → verified changed screen experience.                     |
| Product acceptance         | Controlled fixture runs, automated checks and novice-agent probes.                                                         | Real human acceptance of the current first-use experience. A Luna screenshot critique is not a human usability study. |

Source seams inspected include `recipe-response-completion.ts`, `still-screen-wait.ts`, `run-performance-panel.tsx`, protocol capture-sequence phases, runtime packaging and the existing first-run demo. We should use the capabilities already present before expanding the platform.

## Changes delivered from this audit

### A first task with a usable result

- README now leads with record/replay/review and links a complete [first-test guide](../../FIRST_TEST.md).
- The guide states source prerequisites, expected screen, seeded defect, repeat command, model-free scope, service lifetime and local-package limits.
- The demo creates the existing canonical read-only run share after verifying the exported screenshot hash. It prints Test and Run IDs. The result opens without a frontend dev server.
- The demo describes the seeded Save/team-seat overlap as something to inspect; it does not pretend that passing collection accepted the visual result.

### A quieter, more useful evidence gallery

- Small result/context column beside the screenshot, with a stacked narrow-screen layout.
- Latest capture first and open; earlier captures remain available in closed groups.
- Whole screenshot contained in its stage and a full-resolution Open screenshot link.
- Human screenshot-review state separate from run execution. Zero-valued metric clutter removed from the initial view.
- Technical identity, counters and privacy details remain under Run details.
- Different matrix paths retain their individual captions; identical captions need only one group heading.
- Withheld or digest-invalid images remain blocked; revoked and expired capability links keep their existing boundaries.

### Correct and qualified verdicts

- Explicit execution outcome wins over legacy status. A failed, uncertain or cancelled outcome cannot turn green because status says `ok`; an explicit terminal outcome also cannot be double-counted as in progress.
- Public headlines and text labels mask recognized credential patterns and URL queries even when broad workspace redaction is off. This does not mask image pixels or guarantee removal of arbitrary sensitive application text.
- Privacy copy states which structured data is omitted and warns that screenshots and labels can contain app content.

## Actual verification

Two real `pnpm demo -- --once` invocations completed. The existing saved Test was reused, rather than a newly recorded first-ever test in a clean workspace:

- Test: `test-authoring-cc74da74-8f5d-4181-862b-840ba44bd9a3`.
- First Run: `dc2ce286-8bd7-4c45-a916-a2c077852d11`.
- Repeated Run: `c3a637ab-f78f-4a55-a142-41efce0c5240`.

The local gallery was opened in the inline browser. The full 1100×760 retained screenshot fits the 1280×720 viewer, and the deliberate overlap remains visible. Execution passes and two planned captures still await human review. No human review decision was fabricated. The controlled fixture server closed after each `--once`; retained images still loaded from the Relay service.

At a 768-pixel breakpoint the context and gallery stack, the image stays contained, and there is no horizontal page overflow. A final Luna static-image probe correctly read the execution/review distinction, identified the Save/team-seat overlap and chose Open screenshot for closer inspection. It also found the fixture's plain page and large whitespace unfinished. This is readability evidence, not live interaction or human acceptance; the fixture is not a polished public launch demo.

Validation: core share tests 13/13, server share routes 8/8, existing demo/startup tests 4/4, root Vitest tests 6/6, core/server type checks, formatting/lint, docs and architecture guards. These are focused checks for this change, not a new full-device or release qualification.

## The next priorities and how to judge them

Existing Beads issues remain the tracking source. The order below is a product recommendation, not a promise of virality.

| Priority | Concrete outcome                                                                                                 | Existing tracking / measurement                                                                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | Qualify a public browser install and one uninterrupted record/save/replay/review path on a fresh supported host. | `agent-device-ubfb`. Measure install success, time to first saved Test and interventions. Do not advertise an unpublished npm command.                                            |
| 2        | Observe a real new user reaching the useful result without coaching.                                             | `agent-device-7zd2`. Measure wrong turns, help requests, success and return to the same evidence. Existing human trial remains pending.                                           |
| 3        | Finish one genuine defect→repair→same-Test replay demonstration.                                                 | Launch-demo portion of `agent-device-ubfb`. Show exact condition, timing, model calls where measured, defect caught, retained screenshots and repair result.                      |
| 4        | Put that qualified task into one relevant developer ecosystem's guide.                                           | Use a concrete tested framework fixture before outreach. Track setup, first replay and later repeat use separately from post views. No outreach or public posting performed here. |

Startup simplification (`agent-device-a0im`) and renderer bundle reduction (`agent-device-4ee1`) remain relevant to first-use friction. More feature breadth should follow a demonstrated audience need.

**Assessment:** Relay is better at presenting its proof after these changes. It is not yet proven as intuitive as e2e for a new user, and the local candidate is not a public install. The biggest next win is a first task that a stranger can successfully repeat—not an unsupported usability score or a promise of one million views.
