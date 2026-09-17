# RC-23 screenshot-first inventory (2026-09-17)

**Not 53 covered.** RC-23 dest-ends bind **2** workbook originals as screenshot-first view packets: **GQA-004 attach menu** and **GQA-040 settings inventory**. Workbook is **2 bound / 51 unbound / 5 excluded** (`tests/coverage/grok-qa-workbook.v1.yaml` revision 3). Remaining-before-gates stays **53**. Similarly named Tests do not cover. `grok-ios-daily` 12/12 is not this freeze. Composer-focus inspect does not cover S03. iOS Imagine stays Unbound — orig 37 and image-generation rows stay unbound. Agents cannot Looks-correct. **0 accepted.**

Language: **planned · captured · blocked · missing · pending review**. Dest-end `outcome:passed` is execution only. Looks correct cannot accept missing.

Canonical freeze: `packages/protocol/src/rc23-screenshot-first.ts`. Slot identities: `tests/coverage/rc23-screenshot-first-slots.json`. Captions are display text; obligations are `plannedSlots` identities.

## Frozen denominator (10 × web/android/ios × attempt 1)

**30 planned · 29 captured · 1 blocked · 0 missing · 29 pending review · 0 accepted**

`29 + 1 + 0 = 30`. The mixed 13-cell count **cannot shrink this**. **29 captured jobs ≠ 30 complete.** Unsigned grok-daily Home/Settings are the same **web** slots as grok-lab — not a fourth configuration.

| Source                              | Planned | Captured | Blocked | Missing | Pending | Accepted |
| ----------------------------------- | ------: | -------: | ------: | ------: | ------: | -------: |
| Frozen 10×3 attempt 1               |  **30** |   **29** |   **1** |   **0** |  **29** |    **0** |
| Historical mixed cells (do not use) |      13 |       12 |       1 |       0 |      12 |        0 |

## Ten checkpoint ids

Dest-end on **at least one** platform (2026-09-17 dest-phase recapture: grok-web leftover-tolerant **r932–r936** attach/settings/imagine/models/sidebar + leftover-home dest-phase **r916/r918/r919** home/dictation/composer-focus + logo **r924** leftover inspect-skip + private **r925** prior dest disclaimer / live grok-web **r937**; grok-ios dest-phase **r353–r361** / live **r362**; grok-android slot jobs **r339–r364** / live **r373**, Galaxy dest-wait **r368** unrecaptured). Web dictation and composer-focus stay dest-end inspect (dest-phase Fast on leftover home chrome). iOS Imagine compile `unresolved-step` / binding `unresolved` (`navigation.tab.imagine` absent) — **blocked Unbound, not omitted**. Android 10/10 dest-ends stay captured pending (Galaxy `RQCY104BG8X` **OFF ADB**; AVD is not Galaxy). iOS is **9 captured pending + 1 blocked Unbound** (Imagine). Remaining freeze hole is **iOS Imagine Unbound**.

1. `home-chrome`
2. `dictation`
3. `sidebar`
4. `attach`
5. `settings`
6. `imagine`
7. `logo`
8. `composer-focus`
9. `models`
10. `private-chat`

Left out of this ten: new-chat (dest-end exists), Search (Android-only companion; iOS Conversations is not grok.com Search).

## Workbook dest-end bindings (narrow)

RC-23 `requirementId` stays `rc23-screenshot-first` — not a GQA original. Binding is a reviewed dest-end whose Test executed that original's causal action as a **single view** packet. Slot ids, not captions.

| Original                     | Packet | RC-23 checkpoint | Platforms         | Not covered by this dest-end                                  |
| ---------------------------- | ------ | ---------------- | ----------------- | ------------------------------------------------------------- |
| GQA-004 attach / import menu | view   | `attach`         | web, android, ios | orig 5 File Connectors (excluded); orig 53 upload analysis    |
| GQA-040 settings inventory   | view   | `settings`       | web, android, ios | orig 41 App Language; orig 43 SuperGrok row; orig 44 Sign Out |

Explicit non-bindings (similar names / inspect / leftover skip do not cover):

- `composer-focus` does not bind GQA-001 / GQA-002 / GQA-006 (no type, send, or typeahead persistence)
- `models` does not bind GQA-007 / GQA-008 (inspect-only sheet is not Switch model or presets)
- `sidebar` does not bind GQA-033 / GQA-034 / GQA-036 (open dest-end is not open+close, History expand, or New Chat from menu)
- `logo` does not bind GQA-035 (leftover inspect-skip is not logo from Chat/Imagine/Voice/Projects/History)
- `imagine` does not bind GQA-037 or image-generation GQA-016 / 017 / 050 / 054 / 055 (iOS Unbound; Android companion is not a workbook binding)
- `dictation` does not bind GQA-042 (globally excluded)
- `home-chrome` and `private-chat` have no workbook original

**2 bound ≠ 53 covered.** 51 originals stay unbound with planned packets. 5 stay excluded.

S02 shell navigation (GQA-003, GQA-033, GQA-035, GQA-036, GQA-037) now has explicit **test-action** evidence-needed packets (before/after + receipt; logo adds sequence). Those packets are **not coverage**. Live grok-lab leftover `b2dcd768…` already has the sidebar open (Automations + Toggle Sidebar) plus Introducing Build Mode (did not Dismiss) — leftover dest skip is not GQA-033 open+close. Similar-named sidebar / logo / imagine / new-chat Tests do not cover. iOS Imagine stays Unbound. **Did not recapture this turn.**

| Checkpoint     | Web grok-lab (`browser:grok-com`)                                                                                                                                                       | Android `RQCY104BG8X` (off ADB; r368 dest-wait unrecaptured)                  | iOS `ai.x.GrokApp`                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| home-chrome    | captured pending `ec2588e6` leftover-home dest-phase What should we explore? **PASS** (not recaptured this session)                                                                     | captured pending `ec54c62a`                                                   | captured pending `5e2dca45` r358 dest-phase Fast dest wait Speak/ask/hamburger/add/model **PASS**                             |
| dictation      | captured pending `b97a9b8e` dest-end inspect dest-phase leftover home + Dictation (do not tap; not recaptured this session)                                                             | captured pending `81b51428`                                                   | captured pending `0e5d0984` r361 dest-phase Fast dest wait `voice.speak.button`; did not toggle; not orig 42                  |
| sidebar        | captured pending `0976eb98` r936 leftover dest skip Automations present, Toggle Sidebar skipped **PASS**                                                                                | captured pending `de163986` dest-end last-frame Automations+Settings **PASS** | captured pending `e79b55ac` r353 dest-phase Fast dest wait `sidebar.settings.button`; hamburger transition-executed; no Close |
| attach         | captured pending `074ef085` r932 dest-phase Fast dest Upload a file **PASS**                                                                                                            | captured pending `6529ee13`                                                   | captured pending `dd7643a2` r355 dest-phase Fast dest-wait Camera/Photos/Files/Connectors/Skills; no Close                    |
| settings       | captured pending `6fe95c66` r933 dest-phase Fast dest Appearance **PASS**                                                                                                               | captured pending `6290fd6f` (Appearance panel; not sidebar gear)              | captured pending `bb704c47` r356 dest-phase Fast dest wait `toolbar.close.button`; no Close tap                               |
| imagine        | captured pending `bf026eff` r934 dest-phase Fast dest What should we imagine? **browser-approximation**; did not tap Try it now                                                         | captured pending `001be26c`                                                   | **blocked Unbound**                                                                                                           |
| logo           | captured pending `0de108cd` dest-end leftover inspect-skip dest-phase home chrome (not recaptured this session)                                                                         | captured pending `1d9acbd6` dest-end last-frame Speak home **PASS**           | captured pending `da7dd841` r357 dest-phase Fast dest wait ask textfield + hamburger                                          |
| composer-focus | captured pending `07a42321` dest-end inspect dest-phase `chat-input` (do not type; not recaptured this session)                                                                         | captured pending `78a0127a`                                                   | captured pending `eae15cdd` r360 dest-phase Fast dest wait Hide keyboard after focus tap                                      |
| models         | captured pending `bfe409df` r935 dest-phase Fast dest Fast/Build/Auto/Expert/Heavy sheet                                                                                                | captured pending `5310092a` dest-end last-frame Auto sheet Heavy **PASS**     | captured pending `04c7ad2f` r354 dest-phase Fast dest-wait Heavy                                                              |
| private-chat   | captured pending `41513df5` r925 dest-phase history disclaimer **PASS**; this session leftover Private is **not** dest disclaimer AX — TAP would toggle Private off; **not recaptured** | captured pending `5e78db0d`                                                   | captured pending `d3dc2280` r359 dest-phase Fast dest wait Temporary Chat after New temporary conversation tap                |

Two captions named **Settings** on web vs iOS are **two slots** (`rc23-screenshot-first::settings::grok-com::::1` vs `…::ai.x.GrokApp::::1`).

## Slot identity

Each slot is `requirementId × checkpointId × configuration/platform × attempt 1`.

- `requirementId`: `rc23-screenshot-first` — **not** a GQA original. Workbook originals bound by dest-end: **GQA-004** and **GQA-040** only. The other **51** stay unbound.
- Platforms: web `{ browser: "grok-com" }` · android `{ app: "android" }` · ios `{ app: "ai.x.GrokApp" }`.
- Lane/profile do not enter `slotId`. grok-lab is observed metadata.
- Browser grok-lab Imagine = **browser-approximation**, not physical iOS/Android.

## Historical mixed cells (not the freeze)

**13 planned · 12 captured · 1 blocked · 12 pending · 0 accepted** — leftover unsigned + grok-lab + iOS chrome + Android 3-pack + iOS Imagine blocked. Keep as provenance only.

| Source                                                      | Planned | Captured | Blocked | Pending | Accepted | Missing |
| ----------------------------------------------------------- | ------: | -------: | ------: | ------: | -------: | ------: |
| Web unsigned `2b45db8f` Home + Settings                     |       2 |        2 |       0 |       2 |        0 |       0 |
| Web signed grok-lab `cf9f0260` Home/Attach/Imagine/Settings |       4 |        4 |       0 |       4 |        0 |       0 |
| iOS chrome `78f13d43` Home/Dictation/Sidebar                |       3 |        3 |       0 |       3 |        0 |       0 |
| Android physical `RQCY104BG8X` Home/Sidebar/Imagine         |       3 |        3 |       0 |       3 |        0 |       0 |
| iOS Imagine Unbound                                         |       1 |        0 |       1 |       0 |        0 |       0 |
| **Live mixed total**                                        |  **13** |   **12** |   **1** |  **12** |    **0** |   **0** |

Unsigned Home `9c7a40d9` / Settings `ab4823a9` do not add web slots. iOS Settings/Attach on `grok-ios-daily` batch `d7eafb3c` (**1054460ms** `dailyPack` only) do **not** fill this freeze — later leftover-tolerant dest-end jobs below do.

## Evidence (no new packs this freeze)

### Web signed — Lane grok-lab, Playwright chromium, unique profile + SuperGrok fixture

| Cell     | Job                                         | Duration | Status                                      |
| -------- | ------------------------------------------- | -------: | ------------------------------------------- |
| Home     | `ec2588e6-b64c-4ccd-9e5b-d5c7831b6c97` r916 |   6730ms | captured pending                            |
| Attach   | `074ef085-28c7-4f55-8f45-46e47fa0779c` r932 |  12291ms | captured pending                            |
| Imagine  | `bf026eff-52cc-4b36-903a-5bb0c5127507` r934 |   8909ms | captured pending; **browser-approximation** |
| Settings | `6fe95c66-7efe-4749-966e-de27ca56f17f` r933 |  13337ms | captured pending                            |

Plan `cf9f0260-8be1-428a-85fc-b1453d4bcae6` is prior mixed-cell provenance, not this dest-phase recapture. Engine on disk is **chromium**. **Electron grok-lab is unproven; do not relabel this pack as Electron.** `persist:lane:grok-lab` is absent (Grok Bot Partitions has `sand-forever-box` only). Fail closed — do not treat grok-daily unsigned as SuperGrok.

### Web leftover-tolerant dest-phase recapture — Lane grok-lab, Playwright chromium, fixture `7189423f` ready

Did **not** tap Try now / Dismiss / Sign Out / SuperGrok type. Identifier-only TAP on `model-select-trigger`. Capture-review later / pending / Fast / dest. Fixture `7189423f` health **ready** / signed in. Dest-wait patched r905→r912; dictation/composer dest-end r913–r916; live r937. Warm-confirm leftover skip now carries dest-phase (compiler `efb84ebd6`). Galaxy offline; did not invent iOS Imagine.

| Cell              | Job                                    |  Rev | Duration | Coverage                                                          | Status                                                                                      |
| ----------------- | -------------------------------------- | ---: | -------: | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Home chrome       | `ec2588e6-b64c-4ccd-9e5b-d5c7831b6c97` | r916 |   6730ms | dest-end dest-phase `frames/003.png` What should we explore?      | captured pending; leftover-home already-good                                                |
| Dictation inspect | `b97a9b8e-c00d-47fc-8a7a-3fbe64f26c2a` | r918 |   4725ms | dest-end inspect dest-phase leftover home + Dictation             | captured pending; leftover-home already-good                                                |
| Composer focus    | `07a42321-af4b-4157-a57a-7cb873175ded` | r919 |   4164ms | dest-end inspect dest-phase `chat-input` (do not type)            | captured pending; leftover-home already-good                                                |
| Sidebar           | `0976eb98-22ec-4855-b871-cef97bd8d1d0` | r936 |   7676ms | leftover dest skip Automations present, Toggle Sidebar skipped    | captured pending                                                                            |
| Attach            | `074ef085-28c7-4f55-8f45-46e47fa0779c` | r932 |  12291ms | dest-end dest-phase `frames/005.png` Upload a file                | captured pending                                                                            |
| Settings          | `6fe95c66-7efe-4749-966e-de27ca56f17f` | r933 |  13337ms | dest-end dest-phase `frames/005.png` Appearance                   | captured pending                                                                            |
| Imagine           | `bf026eff-52cc-4b36-903a-5bb0c5127507` | r934 |   8909ms | dest-end dest-phase `frames/005.png` What should we imagine?      | captured pending; **browser-approximation**                                                 |
| Logo              | `0de108cd-1a00-4ad9-a98e-2a1e23c8b642` | r924 |   6287ms | leftover inspect-skip dest-phase home chrome                      | captured pending; not recaptured this session                                               |
| Private chat      | `41513df5-d3b1-4ad6-b9a0-ea7d078d6539` | r925 |  10978ms | dest-end dest-phase `frames/003.png` history disclaimer           | captured pending; **this session leftover Private is not dest disclaimer — not recaptured** |
| Models            | `bfe409df-da3c-4652-a0d9-5a0112f5772f` | r935 |   8665ms | dest-end dest-phase `frames/003.png` Fast/Build/Auto/Expert/Heavy | captured pending                                                                            |

Prior jobs (not this slot): Home `a0b6380d` / Attach `a11c41b4` + `2fbd94f7` r921 / Imagine `37014ba6` + `c6e3123a` r923 / Settings `3787eb65` + `37c7cab7` r922 / Dictation `b1eead7a` / Sidebar `b7c18573` + `405daa91` r920 / Logo `d8bf4385` / Private `2b2377c7` / Composer `ded7d047` / Models `f5116f81` r904 (inspect confirm path missed dest-phase) + `648ee0ab` r926. Models `fc5c83d3` r899 cancelled. Did **not** Dismiss. Identifier TAP `model-select-trigger` opened the sheet (Build Mode dialog went away as the menu opened — not a Dismiss tap). Dest-wait Fast/Auto/Expert/Heavy; no Close after dest. Capture-review `pending` · `policy:fast` · `phase:dest` · intended app `Grok.com` · account `authfx:7189423f-193e-45ed-b674-154505cc5107:1` SuperGrok signed-in · observed lane `grok-lab` · profile `browser:grok-com-1280x800-339a5a430a41` · Playwright. Leftover after this pass: signed-in grok-lab home `b2dcd768…` + Introducing Build Mode (did not Dismiss). Private leftover this session is `Private` / Switch to Private Chat, **not** dest history-disclaimer AX — TAP would toggle Private off; slot stays `41513df5` r925. Not accepted. Do not enqueue SuperGrok on Electron.

### P0.1 Lane identity — grok-lab dest-end 3-pass (2026-09-17)

Playwright chromium + fixture `7189423f` **ready** / `signedIn: true` / `needsReloginCount: 0`. Electron `persist:lane:grok-lab` is still **absent** (Grok Bot Partitions `sand-forever-box` only; `~/Library/Application Support/Electron/Partitions` has `lane:grok-auth-email` / `lane:grok-auth-gmail` only). Fail closed — do **not** relabel grok-daily unsigned as SuperGrok. grok-com `authenticationFixtureId` stays empty.

Live stores before dest-end (exclusive grok.com; did not touch iPad Settings leftover; did not wait on Galaxy):

| Lane       | Fingerprint | Nodes | Identity                                                                                           | Scheduling key                   | Profile                                  |
| ---------- | ----------- | ----: | -------------------------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------- |
| grok-lab   | `b2dcd768…` |   122 | Bernardo Ferrari, sidebar history, no Sign in, Introducing Build Mode, `model-select-trigger` Fast | `grok-com#authfx:7189423f-…`     | `browser:grok-com-1280x800-339a5a430a41` |
| grok-daily | `3b675478…` |    26 | Sign in + Sign up, no Bernardo                                                                     | `grok-com#signed-out:grok-daily` | `browser:grok-com`                       |

`test-grok-web-signed-in-model-iterate` dest-end **test-action** identifier TAP `model-select-trigger` (capture-view stays attach/settings). Dest-phase **dest**, Fast UI, optional wait-for Introducing Build Mode `timeoutMs: 0`, no Close / Dismiss / Try now / Sign Out / SuperGrok type.

| Attempt | Job                                    |  Rev | Duration | Outcome                                                                                                                                                                            |
| ------- | -------------------------------------- | ---: | -------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | `61318f78-d7ff-4efe-87b0-f5388ca87ff6` | r929 |   7237ms | **passed**                                                                                                                                                                         |
| 2       | `3f36ba74-7a53-45dc-8099-4b52d4b49a9f` | r930 |   7618ms | **passed**                                                                                                                                                                         |
| —       | `e1cf87dd-3e98-428d-8126-bf483d0aba2f` | r931 |    ~1.6s | **error** `browser.newContext` storage state / browser closed — tsx watch restarted `:8787` (sibling protocol edits). Did not reach dest. Not a product fail. Not a dest-end pass. |
| 3       | `f62a8b46-b583-4ecb-94eb-6ada17838ce9` | r931 |   7456ms | **passed**                                                                                                                                                                         |

Three dest-end passes (1, 2, 3): capture-review `pending` · `policy:fast` · `phase:dest` · app `Grok.com` · account `authfx:7189423f-193e-45ed-b674-154505cc5107:1` SuperGrok · observed lane `grok-lab` · profile `browser:grok-com-1280x800-339a5a430a41` · `sessionStore: playwright-user-data`. Dest frames: Fast sheet (Fast checked, Build/Auto/Expert/Heavy, SuperGrok Upgrade) + Bernardo Ferrari sidebar. **Not** grok-daily Sign in.

Concurrent during pass 2: unsigned `--lane grok-daily` snapshot still `3b675478…` / Sign in / no Bernardo. Scheduler overlap allowed; cookies not overlaid.

Leftover after pass 3 snapshot: grok-lab home `b2dcd768…`, sidebar open, Introducing Build Mode up (did not Dismiss). That 3-pass is Lane-identity evidence, not a freeze cell. Later dest-phase recapture filled the freeze **models** slot with `bfe409df` r935 (this `f62a8b46` / `648ee0ab` trio is not the slot). Workbook **2 bound / 51 unbound / 5 excluded**. **0 accepted.** 19z5 stays open.

Remaining **P0.1:** Electron grok-lab still unproven. Remaining **P0.2:** `OPENROUTER_API_KEY` unset (agent env + workspace variables revision 0 empty) — judged Tier B blocked.

### N-account health + concurrent Lane isolation (2026-09-17) — not freeze coverage

Exclusive grok.com. Did **not** overlay grok-lab onto grok-daily. Did **not** Dismiss Build Mode / Try now / Sign Out / type SuperGrok. Did **not** tap iPad. Did **not** wait on Galaxy. Did **not** run dest-ends on auth Lanes. grok-com `authenticationFixtureId` stays empty. Electron `persist:lane:grok-lab` **absent** (Grok Bot Partitions `sand-forever-box` only; `~/Library/Application Support/Electron/Partitions` has `lane:grok-auth-email` / `lane:grok-auth-gmail` only). Fail closed — do **not** stamp SuperGrok on unsigned, do **not** relabel grok-daily as SuperGrok, do **not** enqueue SuperGrok on Electron.

`relay browser auth health grok-com --json` (probe default true) + MCP `relay_target_browser_auth_health` `targetId:grok-com` `probe:true` (MCP body truncated at 15 fixtures; CLI summary authoritative). Revoked lab A/B/C and expired cookie probes were **not** opened. Dead fixtures stay revoked / not live — `ACCOUNT_NEEDS_RELOGIN` would fail closed before a Plan could stamp them SuperGrok (`readyCount` 0 / `signedIn: false` / status ≠ ready).

| Fixture                            | Lane bind | Health                     | liveCount | readyCount | needsReloginCount |
| ---------------------------------- | --------- | -------------------------- | --------: | ---------: | ----------------: |
| `7189423f` SuperGrok lab signed-in | grok-lab  | `ready` / `signedIn: true` |         1 |          1 |                 0 |
| 14 revoked lab A/B/C + P2.3        | (none)    | `revoked` (not probed)     |         0 |          0 |                 0 |

Target summary: **liveCount 1 · readyCount 1 · needsReloginCount 0 · revokedCount 14 · expiredCount 0 · errorCount 0 · concurrentAccountsPossible false** (“One live account. Concurrent N-account Plans need another saved sign-in. Signed-out remains a separate lane.”).

| Lane                        | kind       | live | Scheduling key                        | Playwright store                                        |
| --------------------------- | ---------- | ---- | ------------------------------------- | ------------------------------------------------------- |
| grok-lab                    | fixture    | true | `grok-com#authfx:7189423f-…`          | unique profile `browser:grok-com-1280x800-339a5a430a41` |
| grok-daily                  | signed-out | true | `grok-com#signed-out:grok-daily`      | `grok-com__lane_grok-daily`                             |
| grok-auth-email             | signed-out | true | `grok-com#signed-out:grok-auth-email` | `grok-com__lane_grok-auth-email`                        |
| grok-auth-gmail / x / x-out | signed-out | true | `grok-com#signed-out:grok-auth-*`     | `grok-com__lane_grok-auth-*` (not snapshotted)          |
| grok-daily-b…h              | signed-out | true | `grok-com#signed-out:grok-daily-*`    | unsigned extras (not this overlap)                      |

Concurrent snapshots (three CLI jobs started together; MCP digest pair also overlapped grok-lab + grok-daily). First wave overlap lab+daily **4722ms** / three-way **4721ms**. Fingerprint wave overlap lab+daily **1613ms** / three-way **1607ms**. Cookies/fingerprints stayed isolated while both existed:

| Lane            | Fingerprint (full / digest)      | Nodes | Identity while overlapped                                                               | SuperGrok stamp                               |
| --------------- | -------------------------------- | ----: | --------------------------------------------------------------------------------------- | --------------------------------------------- |
| grok-lab        | `b2dcd768…` / `b2dcd768bae5dc6c` |   122 | Bernardo Ferrari, sidebar history, Introducing Build Mode (did not Dismiss), no Sign in | fixture ready only — Playwright, not Electron |
| grok-daily      | `3b675478…` / `3b675478320cae41` |    38 | Sign in + Sign up, cookie banner, no Bernardo                                           | **no** — unsigned                             |
| grok-auth-email | `3b675478…` / same unsigned home |    26 | Sign in + Sign up, no Bernardo (did **not** steal grok-lab cookies)                     | **no** — unsigned sign-in Lane                |

Same unsigned fingerprint on grok-daily and grok-auth-email is logged-out home chrome, not a shared jar: separate `id__lane_*` user-data, grok-lab stayed `b2dcd768…` + Bernardo for the whole overlap. Auth Lane dest-ends were **not** run.

Freeze **30 · 29 captured · 1 blocked · 0 missing · 29 pending · 0 accepted** unchanged — this is N-account evidence, not a freeze cell. Workbook **2 bound / 51 unbound / 5 excluded**. **0 accepted.** 19z5 stays open.

Remaining **N-account:** a second live SuperGrok fixture (3-account Plans still unmeasured). Remaining **P0.1:** Electron `persist:lane:grok-lab` still absent. Remaining **P0.2:** `OPENROUTER_API_KEY` unset — judged Tier B blocked.

### iOS chrome — physical iPad, prime without relaunch

| Cell              | Job                                         | Duration | Status                                                                                                                                                                                                      |
| ----------------- | ------------------------------------------- | -------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home              | `3754526f-bcf2-4818-838e-0adcb8596a0e` r316 |  71141ms | captured pending; identity **PASS** `frames/003.png` SuperGrok Ask+Speak                                                                                                                                    |
| Dictation inspect | `ea3bfb8e-005a-4442-b78a-49b40c11ba23` r316 |  67137ms | captured pending; identity **PASS** `frames/003.png` SuperGrok Speak visible; did not toggle; not orig 42                                                                                                   |
| Sidebar           | `87c73e11-aab5-4fe9-ac84-ad5d3b78e449` r328 |  13501ms | captured pending; last-frame **PASS** `frames/003.png` SuperGrok Plus Bernardo Ferrari + Automations + Settings gear. No Close in recipe. Prior `345c2e67` r316 last-frame home after Close — not this slot |

Plan `78f13d43-6783-43fa-b5cd-29e7e2b1d340` cell span **196019ms**. This is **not** chrome quote `86740566` **120703ms** and **not** daily `d7eafb3c` **1054460ms**. Capture-review `fast` · `settled:false` · `status:pending`. App `Grok` / header SuperGrok. Pixel account SuperGrok Plus. **0 accepted.**

### iOS leftover-tolerant dest-end fill — Lane grok-ios-daily, prime without relaunch, review later, Fast UI

Sequential from leftover signed-in Home. Identifier then label. Preview before leftover-restore taps. Did **not** 12-pack, Imagine/Create Videos, Sign Out, or conversation-list walk. Fast tap only on models selector. Job JSON `account:signed-out` is Lane `unsignedLaneId=grok-ios-daily` — pixels are SuperGrok / Bernardo Ferrari. Capture-review `pending` · `settled:false` · `samples:1` · `policy:fast` · `phase:dest`.

| Cell           | Job                                    |  Rev | Duration | Coverage                                                           | Status                                                                                                                                                                                 |
| -------------- | -------------------------------------- | ---: | -------: | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logo           | `da7dd841-e968-49be-88d0-bb1cfa50b732` | r357 |   8695ms | dest-end dest wait ask textfield + hamburger                       | captured pending; dest-phase **PASS** Fast dest `frames/001.png`. Prior `f67d37fe` r333 / `eb3512fd` r317 — not this slot                                                              |
| Home chrome    | `5e2dca45-ece2-46f5-a8b1-cb4de7526338` | r358 |  17743ms | dest-end dest wait Speak/ask/hamburger/add/model                   | captured pending; dest-phase **PASS** Fast dest `frames/003.png`. Temporary Chat leftover inspect unread-tree skip. Prior `12e0cbef` r340 / `3754526f` r316 — not this slot            |
| Dictation      | `0e5d0984-750d-48c9-9a28-3840b0b7873b` | r361 |   9574ms | inspect dest wait `voice.speak.button`; do not toggle Speak        | captured pending; dest-phase **PASS** Fast dest `frames/003.png`; not orig 42. Leftover inspect unread-tree skip. Prior `a262c526` r341 / `ea3bfb8e` r316 — not this slot              |
| Sidebar        | `e79b55ac-cdb7-4a2e-a85b-b20e5dac897b` | r353 |  14977ms | dest-end dest wait `sidebar.settings.button`; no Close             | captured pending; dest-phase **PASS** Fast dest `frames/003.png`; hamburger transition-executed. Prior `81ab27a4` r334 / `87c73e11` r328 — not this slot                               |
| Attach         | `dd7643a2-879e-4e7e-9277-58d99fdf1fbd` | r355 |  50697ms | dest-end dest-wait Camera/Photos/Files/Connectors/Skills; no Close | captured pending; dest-phase **PASS** Fast dest `frames/005.png`; last-frame `frames/006.png` after dest. Prior `71034ce6` r347 / `8d072240` r346 / `34a9aea5` r346 — not this slot    |
| Models         | `04c7ad2f-7420-463b-8aca-718724ac8320` | r354 |  16323ms | dest-end dest-wait Heavy                                           | captured pending; dest-phase **PASS** Fast dest `frames/003.png`. Prior `04c08ecd` r336 / `67eff67f` r330 — not this slot                                                              |
| Private chat   | `d3dc2280-0e41-4641-892d-6228b51297e5` | r359 |  20148ms | dest-end dest wait Temporary Chat                                  | captured pending; dest-phase **PASS** Fast dest `frames/005.png`; New temporary conversation transition-executed. No exit tap. Prior `113c9510` r337 / `69f353ad` r331 — not this slot |
| Settings       | `bb704c47-eee8-499e-b048-ecdb946187e8` | r356 |  48842ms | dest-end dest-wait `toolbar.close.button`; no Close tap            | captured pending; dest-phase **PASS** Fast dest `frames/007.png`; last-frame `frames/008.png` after dest. Prior `2f0c7174` r348 / `4eb6e5ef` r345 — not this slot                      |
| Composer focus | `eae15cdd-cd30-496e-941a-6701b986e999` | r360 |  25047ms | dest-end dest-wait Hide keyboard after focus tap                   | captured pending; dest-phase **PASS** Fast dest `frames/005.png`; last-frame `frames/006.png` after dest. Prior `56898725` r344 / `43ece456` r339 dest-phase was before the focus tap. |

iOS Imagine: live map grok-ios **r362** Test `test-grok-ios-imagine` step-action binding **unresolved** — `navigation.tab.imagine is absent on live SuperGrok home; dest-end stays Unbound until a unique Imagine tab identifier exists`. No unique Imagine identifier/label / Type to imagine / Create Images AX. **Blocked / Unbound.** Do not invent nav. Did not drive the iPad for Imagine. Dest-phase recapture **r353–r361** (compiler leftover dest skip `efb84ebd6` / leftover-skip unread-tree `8781e3c91`). Capture-review `pending` · `policy:fast` · `phase:dest` · `settled:false` · `samples:1`. Persisted ui-tree nodes were empty on these jobs — dest-phase **PASS** is wait-for dest + job `outcome:passed`, not Looks-correct last-frame AX. Recipes have no Close/Back after dest. Did not Sign Out. Did not reboot.

### Android — physical SM S931B `RQCY104BG8X`

Capture-review on disk is **fast** · `settled:false` · `samples:1` · `status:pending`. `observed.profileId` `device:RQCY104BG8X-1080x2340`. App log `ai.x.grok`. No saved Lane `grok-android` (serial). Account SuperGrok / Bernardo Ferrari on sidebar + Settings. **0 accepted. No Looks-correct.** Closed Settings leftover to sidebar then Ask home Speak unique before dest-end re-runs. Live leftover dest-wait: logo r359, sidebar r360, models dest-wait Heavy **optional r364** (Auto sheet is pixels-only; Heavy never in AX). Galaxy `RQCY104BG8X` is **OFF ADB** this session (`/devices` Android empty). Live grok-android **r373**. Dest-wait recapture **r368** is **unrecaptured**. AVD `Resizable_Experimental` is not the Galaxy — do not fake. Leftover after the prior pass: Ask home Speak unique.

| Cell           | Job                                         | Duration | Status                                                                                                                                                                                                                                                                                                                                                            |
| -------------- | ------------------------------------------- | -------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home chrome    | `ec54c62a-1de6-43ca-875a-0595c152b177` r339 |   9270ms | captured pending; identity **PASS** `frames/003.png` Ask+Imagine+Build+Speak                                                                                                                                                                                                                                                                                      |
| Sidebar        | `de163986-c621-4fca-bb6a-bf1811f61ffe` r362 |   9730ms | captured pending; last-frame **PASS** `frames/003.png` Automations+Settings SuperGrok / Bernardo Ferrari. No Close in recipe. Prior `16e8fc06` r340 last-frame home after Close — not this slot                                                                                                                                                                   |
| Imagine        | `001be26c-3440-443f-ac03-06545a320999` r341 |  14681ms | captured pending; identity **PASS** `frames/005.png` Imagine + Type to imagine                                                                                                                                                                                                                                                                                    |
| Logo           | `1d9acbd6-214f-4544-b790-b1062db8f721` r361 |  10418ms | captured pending; last-frame **PASS** `frames/003.png` Ask home Speak unique (not Type to imagine). Prior `c22f19eb` r342 Imagine leftover — not this slot                                                                                                                                                                                                        |
| Dictation      | `81b51428-9d40-401a-bffd-46121e962948` r349 |   9383ms | captured pending; identity **PASS** `frames/003.png` Ask home Speak visible; did not toggle                                                                                                                                                                                                                                                                       |
| Composer focus | `78a0127a-f0b0-45e0-b1b8-634489b62b39` r350 |  13169ms | captured pending; identity **PASS** `frames/005.png` focused Ask anything + keyboard; transition-executed                                                                                                                                                                                                                                                         |
| Attach         | `6529ee13-5d48-4db7-84da-d93783e74b47` r351 |  18436ms | captured pending; identity **PASS** `frames/006.png` Camera/Gallery/Files/Skills/Connectors (menu still up after Back)                                                                                                                                                                                                                                            |
| Models         | `5310092a-e5cf-4cd0-9e55-3a98e91bd9a2` r364 |  23521ms | captured pending; last-frame **PASS** checkpoint/`frames/005.png` Auto sheet (Heavy/Expert/Fast, Auto checked). Dest-wait Heavy optional — sheet uninspectable. No Back in recipe. Jobs `78e87393` / `294e8d22` r363 dest-wait Heavy **required** failed (AX miss, pixels dest) — not this slot. Prior `e53e8f65` r353 last-frame home after Back — not this slot |
| Private chat   | `5e78db0d-1959-4cc1-b8ce-96848f371ce4` r354 |  13185ms | captured pending; identity **PASS** `frames/005.png` Private Chat + Temporary conversation                                                                                                                                                                                                                                                                        |
| Settings       | `6290fd6f-7ae0-4490-b45f-a8f7cb394830` r357 |  15351ms | captured pending; identity **PASS** `frames/006.png` Settings + Appearance + SuperGrok. `settings_button` is transition. Job `5372fb33` r355 inspect-skipped on sidebar Settings gear — **not** this slot                                                                                                                                                         |

**job.get matches** `tests/grok-android.capacity.json` and `docs/GROK_DAILY_QA.md`: Home/Sidebar/Imagine cell span **52880ms** (`startedAt` 1789578927191 → `finishedAt` 1789578980071). This 7-Test leftover-tolerant fill is **not** copied into P50. Orchestrator wall **62226ms** is `cliWatchMs`, not cell span. Not the 19-test Plan.

## Still not RC-23 acceptance

- **0 missing.** iOS Imagine stays **blocked Unbound**. iOS rows are 9 captured pending + 1 blocked — **not** 10 accepted.
- **29 captured ≠ 30 complete.** Android slots stay the prior dest-end jobs (Galaxy off ADB; r368 dest-wait unrecaptured). Web dest-phase recapture this session: attach `074ef085` r932 / settings `6fe95c66` r933 / imagine `bf026eff` r934 / models `bfe409df` r935 / sidebar `0976eb98` r936 leftover dest skip. Web leftover-home already-good: `ec2588e6` r916 / `b97a9b8e` r918 / `07a42321` r919. Web logo stays `0de108cd` r924. Web private stays `41513df5` r925 — leftover Private is not dest disclaimer; TAP would toggle Private off; **not recaptured**. iOS dest-phase recapture: sidebar `e79b55ac` r353 / models `04c7ad2f` r354 / attach `dd7643a2` r355 / settings `bb704c47` r356 / logo `da7dd841` r357 / home-chrome `5e2dca45` r358 / private-chat `d3dc2280` r359 / composer-focus `eae15cdd` r360 / dictation `0e5d0984` r361. **Not accepted.** iOS Imagine stays **blocked Unbound**.
- No unfamiliar-QA vs agent (Package 3 Vite stranger still **blocked**; did not `pnpm dev:app`).
- No bulk accept; capture-review pending. Looks correct cannot accept missing.
- Workbook originals: **2 bound / 51 unbound / 5 excluded**. Remaining-before-gates **53**. Not 53 covered. Similarly named Tests do not cover.
- OPENROUTER unset. grok-com `authenticationFixtureId` stays empty.
- Electron `persist:lane:grok-lab` still absent. P0.1 Playwright dest-end 3-pass is lane identity, not Electron. N-account health + concurrent grok-lab/grok-daily/grok-auth-email snapshots are isolation evidence, not Electron and not a freeze cell. Do not relabel grok-daily as SuperGrok.
- 19z5 stays open.

### 2026-09-17 dest-phase recapture alignment (do not close 19z5; no Looks-correct; no visual accept)

Aligned freeze identities to dest-phase jobs already on disk. `:8787` in-memory `/jobs` was empty after watch restart; evidence is persisted `runs/*/run.json`. Capture-review `pending` · Fast · dest. Did **not** Looks-correct. Did **not** auto-accept visual baselines. Did **not** Dismiss Build Mode. Did **not** tap iPad Close X. Did **not** reboot. Did **not** bind workbook originals by similar Test names.

**Fail-closed this session:** iOS Imagine Unbound (`navigation.tab.imagine` absent on grok-ios r362). Web private leftover is `Private` / Switch to Private Chat, not dest history-disclaimer AX — TAP would toggle Private off; slot stays `41513df5` r925. Galaxy `RQCY104BG8X` off ADB; r368 dest-wait unrecaptured; AVD is not Galaxy.

Compiler SHAs already on main: dest leftover skip `efb84ebd6`; fence recover `9b42c1ee9`; leftover inspect `9da720de1`; leftover-skip unread-tree `8781e3c91`; P0.4 `f1ebbdf70`; airplane/lock `b9b7ffa37`. Freeze **30 planned · 29 captured · 1 blocked · 0 missing · 29 pending · 0 accepted**. Workbook **2/51/5**. **29 ≠ 30 complete.** 19z5 stays open.
