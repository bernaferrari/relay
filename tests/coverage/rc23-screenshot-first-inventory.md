# RC-23 screenshot-first inventory (2026-09-16)

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

Dest-end on **at least one** platform (compile 2026-09-16, maps grok-web dest-end dest-phase recapture **r916–r926** / live r927 / grok-android **r364** job / live r365 / grok-ios dest-end recollect **r333–r341** / settings dest-wait **r343** / composer-focus dest-wait **r344** / live r344). Web dictation and composer-focus are dest-end inspect (dest-phase Fast on leftover home chrome). iOS Imagine compile `unresolved-step` — **blocked, not omitted**. Android 10/10 dest-ends are captured pending (not accepted). Android leftover dest-wait: logo r359, sidebar r360, models dest-wait Heavy optional r364 (sheet uninspectable). iOS is **9 captured pending + 1 blocked Unbound** (Imagine); dest-end last-frame identity **PASS** on sidebar/attach/models/private-chat/settings (no Close after dest). Remaining freeze hole is **iOS Imagine Unbound**.

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

| Checkpoint     | Web grok-lab (`browser:grok-com`)                                                                            | Android `RQCY104BG8X`                                                         | iOS `ai.x.GrokApp`                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| home-chrome    | captured pending `ec2588e6` dest-end dest-phase+last-frame What should we explore? **PASS**                  | captured pending `ec54c62a`                                                   | captured pending `12e0cbef` dest-end last-frame SuperGrok Speak unique **PASS**                                              |
| dictation      | captured pending `b97a9b8e` dest-end inspect dest-phase leftover home + Dictation (do not tap)               | captured pending `81b51428`                                                   | captured pending `a262c526` dest-end last-frame SuperGrok Speak visible; did not toggle; not orig 42                         |
| sidebar        | captured pending `405daa91` dest-end dest-phase+last-frame Automations **PASS**                              | captured pending `de163986` dest-end last-frame Automations+Settings **PASS** | captured pending `81ab27a4` dest-end last-frame SuperGrok Plus Bernardo Ferrari + Automations + Settings gear **PASS**       |
| attach         | captured pending `2fbd94f7` dest-end dest-phase+last-frame Upload a file **PASS**                            | captured pending `6529ee13`                                                   | captured pending `9fb29721` dest-end last-frame Camera/Photo or Video/Files/Connectors/Skills **PASS**                       |
| settings       | captured pending `37c7cab7` dest-end dest-phase+last-frame Appearance **PASS**                               | captured pending `6290fd6f` (Appearance panel; not sidebar gear)              | captured pending `32b7deaf` dest-end dest-phase+last-frame Settings + Bernardo Ferrari @bernaferrari SuperGrok Plus **PASS** |
| imagine        | captured pending `c6e3123a` dest-end dest-phase+last-frame What should we imagine? **browser-approximation** | captured pending `001be26c`                                                   | **blocked Unbound**                                                                                                          |
| logo           | captured pending `0de108cd` dest-end leftover inspect-skip dest-phase home chrome                            | captured pending `1d9acbd6` dest-end last-frame Speak home **PASS**           | captured pending `f67d37fe` dest-end last-frame SuperGrok home Speak **PASS**                                                |
| composer-focus | captured pending `07a42321` dest-end inspect dest-phase `chat-input` (do not type)                           | captured pending `78a0127a`                                                   | captured pending `56898725` dest-end dest-phase+last-frame focused Ask Anything + keyboard **PASS**                          |
| models         | captured pending `648ee0ab` dest-end dest-phase+last-frame Fast/Build/Auto/Expert/Heavy sheet                | captured pending `5310092a` dest-end last-frame Auto sheet Heavy **PASS**     | captured pending `04c08ecd` dest-end last-frame Fast sheet (Fast checked, Heavy/Expert/Auto/Build) **PASS**                  |
| private-chat   | captured pending `41513df5` dest-end dest-phase+last-frame history disclaimer **PASS**                       | captured pending `5e78db0d`                                                   | captured pending `113c9510` dest-end last-frame Private Chat + Temporary Chat **PASS**                                       |

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
| Attach   | `2fbd94f7-cd51-4897-9b05-d24a15ac341d` r921 |   8035ms | captured pending                            |
| Imagine  | `c6e3123a-817d-4305-865e-d788f16ebd50` r923 |   7795ms | captured pending; **browser-approximation** |
| Settings | `37c7cab7-199b-4e45-9068-929b01ff5ab0` r922 |  10502ms | captured pending                            |

Plan `cf9f0260-8be1-428a-85fc-b1453d4bcae6` is prior mixed-cell provenance, not this dest-phase recapture. Engine on disk is **chromium**. **Electron grok-lab is unproven; do not relabel this pack as Electron.** `persist:lane:grok-lab` is absent (Grok Bot Partitions has `sand-forever-box` only). Fail closed — do not treat grok-daily unsigned as SuperGrok.

### Web leftover-tolerant dest-phase recapture — Lane grok-lab, Playwright chromium, fixture `7189423f` ready

Did **not** tap Try now / Dismiss / Sign Out / SuperGrok type. Identifier-only TAP on `model-select-trigger`. Capture-review later / pending / Fast / dest. Fixture `7189423f` health **ready** / signed in. Dest-wait patched r905→r912; dictation/composer dest-end r913–r916; live r927. Warm-confirm leftover skip now carries dest-phase (compiler). Galaxy offline; did not touch iPad.

| Cell              | Job                                    |  Rev | Duration | Coverage                                                          | Status                                      |
| ----------------- | -------------------------------------- | ---: | -------: | ----------------------------------------------------------------- | ------------------------------------------- |
| Home chrome       | `ec2588e6-b64c-4ccd-9e5b-d5c7831b6c97` | r916 |   6730ms | dest-end dest-phase `frames/003.png` What should we explore?      | captured pending                            |
| Dictation inspect | `b97a9b8e-c00d-47fc-8a7a-3fbe64f26c2a` | r918 |   4725ms | dest-end inspect dest-phase leftover home + Dictation             | captured pending                            |
| Composer focus    | `07a42321-af4b-4157-a57a-7cb873175ded` | r919 |   4164ms | dest-end inspect dest-phase `chat-input` (do not type)            | captured pending                            |
| Sidebar           | `405daa91-d8bd-4fd2-87cf-c4519c9ca514` | r920 |   6580ms | dest-end dest-phase `frames/005.png` Automations                  | captured pending                            |
| Attach            | `2fbd94f7-cd51-4897-9b05-d24a15ac341d` | r921 |   8035ms | dest-end dest-phase `frames/005.png` Upload a file                | captured pending                            |
| Settings          | `37c7cab7-199b-4e45-9068-929b01ff5ab0` | r922 |  10502ms | dest-end dest-phase `frames/005.png` Appearance                   | captured pending                            |
| Imagine           | `c6e3123a-817d-4305-865e-d788f16ebd50` | r923 |   7795ms | dest-end dest-phase `frames/005.png` What should we imagine?      | captured pending; **browser-approximation** |
| Logo              | `0de108cd-1a00-4ad9-a98e-2a1e23c8b642` | r924 |   6287ms | leftover inspect-skip dest-phase home chrome                      | captured pending                            |
| Private chat      | `41513df5-d3b1-4ad6-b9a0-ea7d078d6539` | r925 |  10978ms | dest-end dest-phase `frames/003.png` history disclaimer           | captured pending                            |
| Models            | `648ee0ab-1b9b-4d22-903e-88eaefefa960` | r926 |   6261ms | dest-end dest-phase `frames/003.png` Fast/Build/Auto/Expert/Heavy | captured pending                            |

Prior jobs (not this slot): Home `a0b6380d` / Attach `a11c41b4` / Imagine `37014ba6` / Settings `3787eb65` / Dictation `b1eead7a` / Sidebar `b7c18573` / Logo `d8bf4385` / Private `2b2377c7` / Composer `ded7d047` / Models `f5116f81` r904 (inspect confirm path missed dest-phase). Models `fc5c83d3` r899 cancelled. Did **not** Dismiss. Identifier TAP `model-select-trigger` opened the sheet (Build Mode dialog went away as the menu opened — not a Dismiss tap). Dest-wait Fast/Auto/Expert/Heavy; no Close after dest. Capture-review `pending` · `policy:fast` · `phase:dest` · intended app `Grok.com` · account `authfx:7189423f-193e-45ed-b674-154505cc5107:1` SuperGrok signed-in · observed lane `grok-lab` · profile `browser:grok-com-1280x800-339a5a430a41` · Playwright. Last frame equals dest-phase on all 10. Leftover after this pass: signed-in grok-lab home `b2dcd768…` + Introducing Build Mode (did not Dismiss). Not accepted. Do not enqueue SuperGrok on Electron.

### iOS chrome — physical iPad, prime without relaunch

| Cell              | Job                                         | Duration | Status                                                                                                                                                                                                      |
| ----------------- | ------------------------------------------- | -------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home              | `3754526f-bcf2-4818-838e-0adcb8596a0e` r316 |  71141ms | captured pending; identity **PASS** `frames/003.png` SuperGrok Ask+Speak                                                                                                                                    |
| Dictation inspect | `ea3bfb8e-005a-4442-b78a-49b40c11ba23` r316 |  67137ms | captured pending; identity **PASS** `frames/003.png` SuperGrok Speak visible; did not toggle; not orig 42                                                                                                   |
| Sidebar           | `87c73e11-aab5-4fe9-ac84-ad5d3b78e449` r328 |  13501ms | captured pending; last-frame **PASS** `frames/003.png` SuperGrok Plus Bernardo Ferrari + Automations + Settings gear. No Close in recipe. Prior `345c2e67` r316 last-frame home after Close — not this slot |

Plan `78f13d43-6783-43fa-b5cd-29e7e2b1d340` cell span **196019ms**. This is **not** chrome quote `86740566` **120703ms** and **not** daily `d7eafb3c` **1054460ms**. Capture-review `fast` · `settled:false` · `status:pending`. App `Grok` / header SuperGrok. Pixel account SuperGrok Plus. **0 accepted.**

### iOS leftover-tolerant dest-end fill — Lane grok-ios-daily, prime without relaunch, review later, Fast UI

Sequential from leftover signed-in Home. Identifier then label. Preview before leftover-restore taps. Did **not** 12-pack, Imagine/Create Videos, Sign Out, or conversation-list walk. Fast tap only on models selector. Job JSON `account:signed-out` is Lane `unsignedLaneId=grok-ios-daily` — pixels are SuperGrok / Bernardo Ferrari. Capture-review `pending` · `settled:false` · `samples:1` · `policy:fast` · `phase:dest`.

| Cell           | Job                                    |  Rev | Duration | Coverage                                                    | Status                                                                                                                                                                                                          |
| -------------- | -------------------------------------- | ---: | -------: | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logo           | `f67d37fe-8a92-4d20-92d7-a651313f0897` | r333 |   7460ms | inspect wait-for                                            | captured pending; dest-phase **PASS** `frames/001.png` SuperGrok home Speak. Prior `eb3512fd` r317 — not this slot                                                                                              |
| Home chrome    | `12e0cbef-46ef-4870-a2f0-3b76234e151f` | r340 |  24746ms | dest-end; Temporary Chat leftover exit                      | captured pending; dest-phase **PASS** `frames/003.png` SuperGrok Speak unique. Prior `3754526f` r316 — not this slot                                                                                            |
| Dictation      | `a262c526-8156-4d68-9af1-b62a73c1154a` | r341 |  42610ms | inspect; do not toggle Speak                                | captured pending; dest-phase **PASS** `frames/003.png` SuperGrok Speak visible; not orig 42. Prior `ea3bfb8e` r316 — not this slot                                                                              |
| Sidebar        | `81ab27a4-e987-4bff-92cd-56502485f990` | r334 |  14115ms | dest-end; no Close                                          | captured pending; dest-phase **PASS** `frames/003.png` SuperGrok Plus Bernardo Ferrari + Automations + Settings gear. Prior `87c73e11` r328 — not this slot                                                     |
| Attach         | `9fb29721-66f1-47a0-9330-2fe142341103` | r335 |  49709ms | dest-end; leftover camera skip                              | captured pending; dest-phase **PASS** `frames/005.png` Camera/Photo or Video/Files/Connectors/Skills. No close in recipe. Prior `c585dc28` r329 — not this slot                                                 |
| Models         | `04c08ecd-7089-40a6-8da7-47d45ef0c69c` | r336 |  15640ms | dest-end; Fast selector allowed                             | captured pending; dest-phase **PASS** `frames/003.png` Fast sheet (Fast checked, Heavy/Expert/Auto/Build). Dest-wait Heavy. Prior `67eff67f` r330 — not this slot                                               |
| Private chat   | `113c9510-4250-4cc9-b3bc-6873edc19928` | r337 |  66133ms | dest-end; dest Temporary Chat                               | captured pending; dest-phase **PASS** `frames/005.png` Private Chat + history disclaimer. No exit tap. Prior `69f353ad` r331 — not this slot                                                                    |
| Settings       | `32b7deaf-a11e-4004-92c4-c4ba77fbcc68` | r343 |  47769ms | dest-end peek; dest-wait toolbar.close.button, no Close tap | captured pending; dest-phase **PASS** `frames/007.png` Grok/Settings + Bernardo Ferrari @bernaferrari SuperGrok Plus; last-frame `frames/008.png` same dest. Prior `183110a2` r338 dest-phase was open sidebar. |
| Composer focus | `56898725-7890-46b8-abd1-2b193cdf82b0` | r344 |  71947ms | dest-end; dest-wait Hide keyboard after focus tap           | captured pending; dest-phase **PASS** `frames/005.png` Grok/SuperGrok focused Ask Anything + keyboard; last-frame `frames/006.png` same dest. Prior `43ece456` r339 dest-phase was before the focus tap.        |

iOS Imagine: compile `unresolved-step` (`navigation.tab.imagine` absent). Live snapshot this session: no unique Imagine identifier/label, no Type to imagine / Create Images AX. **Blocked / Unbound.** Do not invent nav. Live dest-end recollect **r333–r341** plus settings dest-wait **r343** / composer-focus dest-wait **r344**. Leftover after this pass: signed-in Home Speak unique, AX `511ae65c64463269`, keyboard dismissed, visual `8521c88d50f124e87245dc8ee64666c8b65efde6e72fad743260ab46cc337ebd`.

### Android — physical SM S931B `RQCY104BG8X`

Capture-review on disk is **fast** · `settled:false` · `samples:1` · `status:pending`. `observed.profileId` `device:RQCY104BG8X-1080x2340`. App log `ai.x.grok`. No saved Lane `grok-android` (serial). Account SuperGrok / Bernardo Ferrari on sidebar + Settings. **0 accepted. No Looks-correct.** Closed Settings leftover to sidebar then Ask home Speak unique before dest-end re-runs. Live leftover dest-wait: logo r359, sidebar r360, models dest-wait Heavy **optional r364** (Auto sheet is pixels-only; Heavy never in AX). Leftover after this pass: Ask home Speak unique.

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
- **29 captured ≠ 30 complete.** Android logo/sidebar/models dest-end last frames are now **identity PASS** (r361/r362/r364). Web dest-end dest-phase recapture last frames are dest (`ec2588e6` r916 / `b97a9b8e` r918 / `405daa91` r920 / `2fbd94f7` r921 / `37c7cab7` r922 / `c6e3123a` r923 / `0de108cd` r924 / `07a42321` r919 / `648ee0ab` r926 / `41513df5` r925). iOS dest-end recollect last frames are now **identity PASS** (`12e0cbef` r340 / `a262c526` r341 / `81ab27a4` r334 / `9fb29721` r335 / `04c08ecd` r336 / `113c9510` r337 / `32b7deaf` r343 / `f67d37fe` r333 / `56898725` r344). **Not accepted.** iOS Imagine stays **blocked Unbound**.
- No unfamiliar-QA vs agent (Package 3 Vite stranger still **blocked**; did not `pnpm dev:app`).
- No bulk accept; capture-review pending. Looks correct cannot accept missing.
- Workbook originals: **2 bound / 51 unbound / 5 excluded**. Remaining-before-gates **53**. Not 53 covered.
- OPENROUTER unset. grok-com `authenticationFixtureId` stays empty.
- 19z5 stays open.
