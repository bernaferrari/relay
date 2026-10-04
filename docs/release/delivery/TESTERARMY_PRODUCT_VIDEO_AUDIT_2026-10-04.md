# TesterArmy full visible video corpus audit — 2026-10-04

This ledger covers all 28 video posts discovered on the visible official profile, plus an official YouTube explainer and a founder-shared creator explainer. Nine direct product videos were reviewed here; the parent supplied decoded visual evidence for the other seven direct uploads and four quotes. A main Posts scan reached the exact visible bottom at the March 10 hello-world post: 57 distinct timeline items from September 29 to March 10, including 28 video posts (16 direct uploads and 12 quoted demos). The profile header reports 154 posts; this ledger does not claim to cover every thread reply or every original founder post. Quoted-video metadata is saved in `.relay/testerarmy-quoted-video-inventory-oct04.json`. Public post views below were observed on October 4; they are post views, not unique people or video completion metrics. They do not establish organic reach or causality.

Method: normal browser playback and decoded screenshots at the timestamps listed, with read-only DOM checks of the player's duration and current time. The long creator clip also has three clearly marked samples obtained through the visible native seek bar. The twelve additional quotes and parent's seven direct clips use opening, intermediate and near-ending visual samples, with native seeking where indicated. A timestamp alone was insufficient: stale frames after seeking were re-observed after decoding. This is coverage across each clip's sequence, not an every-frame or every-spoken-word audit. No X transcript was exported; most product clips were muted. English auto-generated captions were exported for the official YouTube explainer. Music, voice delivery, and audio quality have not been audited. Screenshots are in the tool record, not downloaded remote media.

## Official product clips

### Integrations — September 22, 17.045s, 2,189 post views

[Original post](https://x.com/TesterArmy/status/2102442409011605798).

Observed samples: 1.02/2.03s introduce connecting to an existing stack; 4.84s presents GitHub and testing before merge; 6.77s shows Slack/Discord notification delivery; 9.95s shows coding-agent logos and an MCP connection command; 13.14s shows Linear/Jira ticket creation; 16.58s ends with a free-trial CTA and customer logos. The visual style is large white/orange text on dark camouflage, with benefit statements and integration logos.

Creative inference: readable and complete in-feed, but it illustrates benefits rather than showing a particular defect being caught. Relay can borrow the clear one-sentence outcomes and distribution surfaces, while making the main story a concrete failure and repair.

### unbox-ai — September 2, 29.916s, 1,232 post views

[Original post](https://x.com/TesterArmy/status/2095177610426974597).

Observed samples: 1.03s opens inside a dark trace browser with a context view, tool list and latency waterfall; 8.03s opens a long user-prompt modal; 16.02s opens a Bash tool input/output modal; 23.03s returns to the waterfall and scrubbing; 29.03s shows the inspector's detailed text. The caption explains the token imbalance and gives an install command. In-video text is mostly the actual desktop UI.

Creative inference: useful proof for agent developers, but dense text makes a casual viewer work to understand the result. Relay should surface one surprise, such as a specific repeated cost or failing action, as a large overlay before opening detailed trace panels.

### iOS onboarding/search — August 25, 20.45s, 1,138 post views

[Original post](https://x.com/TesterArmy/status/2092356157461405857).

Observed samples: 0.84s shows the new-wallet checklist and Uniswap phone UI; 6.04s shows username creation; 11.04s shows notification onboarding; 16.03s shows the token-search screen; 19.84s shows Ethereum search results. This is a real mobile-flow recording beside the test's progressing steps. The ending sample is search results, not a conspicuous final pass banner.

Creative inference: recognizable app and meaningful flow help demonstrate capability. The narrow phone and tiny checklist would benefit from a large task statement and a visible result. A Relay clip can make cross-device evidence or a detected failure its payoff instead of relying on viewers to read the side panel.

### TesterArmy Agent — July 27, 29.866s, approximately 2.5K post views

[Original post](https://x.com/TesterArmy/status/2081788013638484261).

Observed samples: 0.82s opens with a test list and agent prompt; 7.03s shows suggestions for missing coverage; 14.04s shows a request to create a test for multiple environments; 20.99s shows generation progress and agent logs; 29.08s ends on the generated custom-environments test, whose run panel says there are no runs yet. The entire story remains inside the desktop app, with some zooming.

Creative inference: demonstrates test authoring, but the ending proves creation rather than execution. Relay should pair authoring footage with the actual replay and resulting screenshot/check, which makes the claimed outcome inspectable.

### SMS/OTP — July 16, 25.333s, 4,190 post views

[Original post](https://x.com/TesterArmy/status/2077745671197597948).

Observed samples: 0.93s shows the Uber website and rider-onboarding test; 6.02s shows phone entry; 12.21s shows the OTP screen; 18.04s shows log steps for retrieving the test phone number, waiting for SMS and replacing the first OTP digit; 24.92s shows populated first/last-name fields. The recording demonstrates advancement beyond the OTP barrier. The final sample does not show the completed rider home screen or final pass marker.

Creative inference: this is a concrete difficult flow and an understandable product capability. Relay should choose similarly specific obstacles that are actually supported, label the obstacle before showing the agent, and hold a conclusive result on screen.

### Android support release — June 5, 28.766s, 5,841 post views

[Original post](https://x.com/TesterArmy/status/2063043884759085112).

Observed samples: 0.82s shows a four-action test in plain language; 7.04s shows the Kick app home screen; 14.02s shows browsing categories; 21.02s shows the selected livestream playing; 28.16s shows a green pass result beside the phone recording. The caption supplies the Android launch context; the video primarily proves the workflow.

Creative inference: a complete task-to-evidence arc is stronger than capability lists. Relay can use this structure with a sharper opening outcome and larger device/result crop.

### Original Kick Android demonstration — June 2, 28.766s, 3,686 post views

[Original post](https://x.com/TesterArmy/status/2061934772650455084).

Observed samples: 0.81/7.03/14.04s show the same test, home and category sequence as the June 5 post; after a playback pause and visible Play-button resume, 21.03s shows the livestream and 28.11s shows the pass result. Matching duration and sampled scenes establish reuse of the same apparent creative across both posts; a pixel-for-pixel file comparison was not performed.

Creative inference: one recording was repackaged for an app example and a platform announcement. Relay can produce multiple hooks from a single verified run, then compare post outcomes without assuming the wording caused the difference.

### Lovable onboarding — May 22, 30.966s, 4,607 post views

[Original post](https://x.com/TesterArmy/status/2057709181885612166).

Observed samples: 0.93s shows the Run action for signup and simple-site generation; 7.09s shows temporary-email signup; 14.02s shows the project prompt being filled; 22.02s shows build progress; 30.32s shows a pass result for all seven steps. At that ending sample, the right preview pane is visually blank white. This does not establish whether the generated site's earlier preview or the test assertion was correct.

Creative inference: the pass marker is legible, but the final image does not provide the expected generated-site payoff. Relay should end its launch recording on evidence that a viewer can assess directly.

### Original launch — March 10, 19.683s, approximately 59K post views

[Original post](https://x.com/TesterArmy/status/2031426098181857564).

Observed samples: 0.81s shows a GitHub PR adding FAQ content; 5.02s shows a TesterArmy bot failure summary; 10.01s shows the failed run; 15.11/19.17s show a missing author-profile link report with severity, reproduction steps, expected/actual behavior, and session replay beside it. The reported bug is that an author handle is plain text where a clickable X link was expected.

Creative inference: this is the clearest defect-to-report story in these nine clips. Its small-text PR opening and low-stakes FAQ defect limit immediate general appeal. Relay's first clip should use an equally inspectable report with an obvious visual failure and a stronger consequence.

## Other seven direct uploads

These samples were observed by the parent after the customer-research agent could not access a browser. They supplement, and supersede the playback limitation in, [the customer research note](./TESTERARMY_CUSTOMER_VIDEO_AUDIT_2026-10-04.md). Exact timestamps are in `.relay/testerarmy-customer-video-frames-oct04.json`.

| Post                                                                                | Decoded samples (seconds) | Observed sequence and limits                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [September 21 e2e teaser](https://x.com/TesterArmy/status/2102074969555603950)      | 0, 2.33, 5.46, 11.56      | Large teaser typography; coming-soon message; e2e destination.                                                                                                                                                             |
| [September 14 Juno](https://x.com/TesterArmy/status/2099513907845210522)            | 2.04, 25.01, 43.32, 84.93 | Talking-head customer testimonial; opening tenfold claim; closing customer logos, PR coverage and story CTA. Claim is a customer's estimate, not a measured audit result. Ending decoded after an initially buffered seek. |
| [September 4 open source](https://x.com/TesterArmy/status/2095922474219381044)      | 0.36, 6.98, 12.38         | OSS card and animated terminal pass, Scout sweep and token summary; no app workflow.                                                                                                                                       |
| [August 29 refactor meme](https://x.com/TesterArmy/status/2093715352396112056)      | 0, 11.7, 16.1             | Large GitHub diff, bypass-rules merge dialog and bungee staging joke; no product demo. Ending seek initially buffered.                                                                                                     |
| [August 28 Friday deploy meme](https://x.com/TesterArmy/status/2093288402292736087) | 0.19, 8.02, 14.5          | Deployment/code-review labels over a comedy scene; no product UI.                                                                                                                                                          |
| [August 27 Novu](https://x.com/TesterArmy/status/2092980904541188541)               | 0.3, 5.95, 11.44, 16.47   | Customer animation, OTP test running, three passed checks for OTP/inbox/digest, then story CTA. Published impact estimates are separate from this visual demonstration.                                                    |
| [August 25 Resend](https://x.com/TesterArmy/status/2092267087578509525)             | 0.41, 8.09, 14.54, 21.59  | Customer showcase; verification link points at localhost; signup pass/email fail/dashboard blocked; relationship and catch-a-bug CTA. Illustrative promotion, not an independently executed test.                          |

## Twelve founder demos quoted by the official profile

These were omitted from the direct Videos-tab inventory. All twelve have decoded visual samples, with partial normal playback and native seeking for intermediate/end positions. Eight were reviewed here and four by the parent. Exact observations are saved in `.relay/testerarmy-product-quote-frames-oct04.json` and `.relay/testerarmy-root-quote-frames-oct04.json`. Durations below come from the actual players; feed badges were sometimes rounded.

| Official quote post                                                                   | Duration | Decoded samples (seconds)             | Observed sequence and limits                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------- | -------: | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [September 9 cached replay](https://x.com/TesterArmy/status/2097668756801503394)      |  29.983s | 2.60, 15.97, 29.53                    | Browser/terminal test sequence, ending with eight passed tests and three model calls. This ending does not support a blanket zero-model-call guarantee.                                                                                      |
| [September 1 e2e + agent-device](https://x.com/TesterArmy/status/2094822305528430745) |   25.55s | 0, 9.35, 24.90                        | Code describes creating/completing/deleting a reminder; Buy milk editing; decoded empty Reminders list and terminal completion after buffered seek retry.                                                                                    |
| [August 20 Issues](https://x.com/TesterArmy/status/2090468507590807734)               |  91.371s | 0.96, 12.91, 47.33, 90.25             | CTO picture-in-picture, dashboard, issue list with high-severity price bug, clothing-catalog replay and reproduction report, ending issue detail. The caption's fix-prompt/Linear claims were not independently executed.                    |
| [August 3 Gmail](https://x.com/TesterArmy/status/2084300460467392563)                 |  41.483s | 0.34, 20.84, 40.53                    | Test editor; Gmail compose beside login/compose/send/verify-Sent steps; green pass and replay at the zoomed ending. Small/blurred text prevents precise email-content claims.                                                                |
| [July 20 Scout/GitHub API](https://x.com/TesterArmy/status/2079259706053259472)       | 196.533s | 0, 5.92, 47.49, 98.50, 149.26, 193.79 | GitHub README and CTO face; terminal setup/agent prompt; tool output; small results table; ending repository CTA. Technical findings were not independently verified.                                                                        |
| [July 17 Scout initialization](https://x.com/TesterArmy/status/2078122836665700797)   |   8.597s | 1.74, 4.69, 8.22                      | Animated Swagger/Petstore sweep, 19 operations, 18 passes and one failed inventory request, then init CTA. Promotional animation, not independent API validation.                                                                            |
| [July 14 Devin](https://x.com/TesterArmy/status/2077086120123228515)                  | 103.125s | 5.12, 32.69, 48.68, 101.63            | Webhook-secret GitHub PR; implementation chat/diff during playback; bot's passing checklist; app session replay; ending returns to passing checks and CTO farewell. End decoded after a stale seek frame.                                    |
| [July 7 T3 iOS](https://x.com/TesterArmy/status/2074488134079770880)                  |  38.467s | 5.60, 19.64, 37.85                    | Run loading, phone chat and sent message with logs, green pass beside the final conversation. Concrete completed mobile workflow.                                                                                                            |
| [June 22 console/network logs](https://x.com/TesterArmy/status/2069140665716375593)   |  17.167s | 2.36, 9.25, 16.91                     | Passed create/delete-key replay, network request list, selected response detail. Ending blur prevents payload-value claims.                                                                                                                  |
| [May 28 automated QA](https://x.com/TesterArmy/status/2059867496333955580)            |  37.617s | 4.71, 24.01, 37.35                    | Request-analysis modal; Bluesky signup during playback; compose keyboard; near-ending green pass and feed. Samples cover the workflow without independently validating every assertion.                                                      |
| [May 18 Expensify](https://x.com/TesterArmy/status/2056382728745144366)               |  28.971s | 2.54, 8.76, 14.72, 28.91              | Agent opening, name entry and notification prompt, numeric onboarding, six-step send-message checklist with pass. Native midpoint/end samples.                                                                                               |
| [May 5 agentic UI](https://x.com/TesterArmy/status/2051772626046246913)               |  47.733s | 2.88, 9.22, 24.30, 46.88              | Agent opening, Bluesky login, compose keyboard, paused decoded ending with all eight steps passed and a Save Password prompt over the feed. First ending seek was stale; paused seek resolved the evidence. Auditor did not save a password. |

Creative inference: these extra clips broaden the product proof to authenticated mail, iOS messaging, API sweeps, developer-agent integration and inspectable issues. Several have a convincing completed workflow; others require a long desktop recording to make the payoff clear. The official account's founder quotes often add only a short reaction, so their public post views should not be mistaken for the reach of the original founder's video. Relay can demonstrate a similarly complete workflow while cropping the task and evidence for readability.

## Linked explanatory videos

### Official e2e YouTube explainer — 101.081s

[Video](https://www.youtube.com/watch?v=NEawZb6Hssw). The page showed approximately 2.5K views, 27 likes and a 24-subscriber channel. English auto-generated transcript export succeeded after the pre-roll finished; the first attempt during pre-roll reported no transcript. The exported transcript was read in full, but is not copied into this report.

Visual samples: 2.13s presenter introduction; 20.15s large goal cards; 40.04s test code beside action/assertion steps; 61.78s engine configuration switching without changing the test; 83.16s terminal setup wizard; 99.68s presenter and free/open-source/GitHub CTA. The narration describes hybrid agent and deterministic test APIs, web/iOS/Android coverage, custom engines, and model-provider choice. These are claims from the publisher, not independently executed checks.

Creative inference: presenter, readable diagrams, code and setup form a clearer teaching sequence than the older raw UI recordings. Relay can use a short explanation of why the end-state check is trustworthy, grounded in one demonstrated run.

### The Hype Kevin explainer shared by Oskar — 239.4s

[Founder quote post](https://x.com/o_kwasniewski/status/2106091977800642602). The quoted creator is @thehypekevin. The founder's quote showed 35,156 post views, 242 likes and 299 bookmarks; these metrics belong to the founder's quote, not necessarily the original creator post. Captions were enabled through the visible player. No full transcript was exported and narration coverage remains partial.

Normal-playback decoded samples: 4.43s shows agent icons and a daily-PR counter; 11.66s on replay introduces the open-source testing framework; 25.06s presents a billing-upgrade feature and an agent's success claim; 50.28s begins a Playwright example; 61.89s compares billing UI with test code; 80.14s introduces an agent-only approach and model-call counter; 120.66s shows semantic screen text; 140.05s shows a cached second run with zero model calls; 170.51s shows a separate judge model. The player was later verified ended at 239.400s. Intermittent player pauses and scrolling prevented reliable timed captures at some intermediate targets; a 60s observation call timed out.

Additional decoded samples via the visible native seek bar: 190.56s shows laptop/CI infrastructure; 210.88s shows agent logos, skill path and MCP server in the workflow; 238.80s shows the creator handle and e2e link CTA. These are seek samples, not proof of continuous observed playback over the final minute.

Creative inference: the creator makes the testing problem comprehensible through a recurring billing-upgrade story and large animated illustrations. Its audience hook is about how developers work, before the framework details. This is a useful format reference for Relay. Its reach still falls far short of one million in the inspected founder quote, so it is not evidence of a guaranteed million-view formula.

## Implications for Relay's creative

Across the raw demonstrations, many opening frames require reading small desktop UI before the viewer understands what happened. The more legible explanations use large statements, repeated illustrative situations and an explicit ending. The strongest raw proof is the launch failure report; the strongest complete successful flow is the Android replay and pass result. The creator explanation is a format reference for explaining the problem before showing implementation.

A concrete Relay cut should show an obvious defect in the first seconds, one supported agent instruction, the relevant device action, the failure evidence, a repair/replay, and the resulting pass with before/after screenshots. Hold the final evidence long enough to inspect. Use one truthful consequence in the post hook. These are creative hypotheses to test; public snapshots do not reveal retention, paid promotion or distribution history.
