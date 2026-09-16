# RC-23 screenshot-first inventory (2026-09-16)

**Not a workbook binding.** This file does not cover, bind, or accept any grok-qa original. Workbook stays **0 bound / 53 unbound / 5 excluded** (`tests/coverage/grok-qa-workbook.v1.yaml`). Similarly named Tests do not cover. `grok-ios-daily` 12/12 is not this freeze. Agents cannot Looks-correct. **0 accepted.**

Language: **planned · captured · blocked · missing · pending review**. Dest-end `outcome:passed` is execution only. Looks correct cannot accept missing.

Canonical freeze: `packages/protocol/src/rc23-screenshot-first.ts`. Slot identities: `tests/coverage/rc23-screenshot-first-slots.json`.

## Frozen denominator (10 × web/android/ios × attempt 1)

**30 planned · 29 captured · 1 blocked · 0 missing · 29 pending review · 0 accepted**

`29 + 1 + 0 = 30`. The mixed 13-cell count **cannot shrink this**. **29 captured jobs ≠ 30 complete.** Unsigned grok-daily Home/Settings are the same **web** slots as grok-lab — not a fourth configuration.

| Source | Planned | Captured | Blocked | Missing | Pending | Accepted |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Frozen 10×3 attempt 1 | **30** | **29** | **1** | **0** | **29** | **0** |
| Historical mixed cells (do not use) | 13 | 12 | 1 | 0 | 12 | 0 |

## Ten checkpoint ids

Dest-end on **at least one** platform (compile 2026-09-16, maps grok-web **r904** job / live r905 / grok-android **r364** job / live r365 / grok-ios capture r316–r322, dest-wait **r324–r328**). Web dictation and composer-focus are inspect, not dest-end. iOS Imagine compile `unresolved-step` — **blocked, not omitted**. Android 10/10 dest-ends are captured pending (not accepted). Android leftover dest-wait: logo r359, sidebar r360, models dest-wait Heavy optional r364 (sheet uninspectable). iOS is **9 captured pending + 1 blocked Unbound** (Imagine); capture-review last-frame identity FAIL on sidebar/attach/models/private-chat/settings (close hid dest). Remaining freeze hole is **iOS Imagine Unbound**.

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

| Checkpoint | Web grok-lab (`browser:grok-com`) | Android `RQCY104BG8X` | iOS `ai.x.GrokApp` |
| --- | --- | --- | --- |
| home-chrome | captured pending `a0b6380d` | captured pending `ec54c62a` | captured pending `3754526f` |
| dictation | captured pending `b1eead7a` (inspect; do not enable) | captured pending `81b51428` | captured pending `ea3bfb8e` (not orig 42) |
| sidebar | captured pending `b7c18573` dest-end | captured pending `de163986` dest-end last-frame Automations+Settings **PASS** | captured pending `345c2e67` dest `frames/002`; last-frame home **identity FAIL** |
| attach | captured pending `a11c41b4` | captured pending `6529ee13` | captured pending `679b39b7` dest `frames/004`; last-frame home **identity FAIL** |
| settings | captured pending `3787eb65` | captured pending `6290fd6f` (Appearance panel; not sidebar gear) | captured pending `ec09b7ba` dest peek `frames/007`; last-frame home **identity FAIL** |
| imagine | captured pending `37014ba6` **browser-approximation** | captured pending `001be26c` | **blocked Unbound** |
| logo | captured pending `d8bf4385` leftover inspect-skip | captured pending `1d9acbd6` dest-end last-frame Speak home **PASS** | captured pending `eb3512fd` (inspect wait-for) |
| composer-focus | captured pending `ded7d047` inspect (`chat-input`; do not type) | captured pending `78a0127a` | captured pending `2e31db46` |
| models | captured pending `f5116f81` dest-end last-frame Fast/Auto/Expert/Heavy sheet | captured pending `5310092a` dest-end last-frame Auto sheet Heavy **PASS** | captured pending `3cd34331` dest Fast sheet `frames/003`; last-frame home **identity FAIL** |
| private-chat | captured pending `2b2377c7` dest-end | captured pending `5e78db0d` | captured pending `dd229b0b` dest Private Chat `frames/005`; last-frame home **identity FAIL** |

Two captions named **Settings** on web vs iOS are **two slots** (`rc23-screenshot-first::settings::grok-com::::1` vs `…::ai.x.GrokApp::::1`).

## Slot identity

Each slot is `requirementId × checkpointId × configuration/platform × attempt 1`.

- `requirementId`: `rc23-screenshot-first` — **not** a GQA original. Workbook originals stay **0 bound**.
- Platforms: web `{ browser: "grok-com" }` · android `{ app: "android" }` · ios `{ app: "ai.x.GrokApp" }`.
- Lane/profile do not enter `slotId`. grok-lab is observed metadata.
- Browser grok-lab Imagine = **browser-approximation**, not physical iOS/Android.

## Historical mixed cells (not the freeze)

**13 planned · 12 captured · 1 blocked · 12 pending · 0 accepted** — leftover unsigned + grok-lab + iOS chrome + Android 3-pack + iOS Imagine blocked. Keep as provenance only.

| Source | Planned | Captured | Blocked | Pending | Accepted | Missing |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Web unsigned `2b45db8f` Home + Settings | 2 | 2 | 0 | 2 | 0 | 0 |
| Web signed grok-lab `cf9f0260` Home/Attach/Imagine/Settings | 4 | 4 | 0 | 4 | 0 | 0 |
| iOS chrome `78f13d43` Home/Dictation/Sidebar | 3 | 3 | 0 | 3 | 0 | 0 |
| Android physical `RQCY104BG8X` Home/Sidebar/Imagine | 3 | 3 | 0 | 3 | 0 | 0 |
| iOS Imagine Unbound | 1 | 0 | 1 | 0 | 0 | 0 |
| **Live mixed total** | **13** | **12** | **1** | **12** | **0** | **0** |

Unsigned Home `9c7a40d9` / Settings `ab4823a9` do not add web slots. iOS Settings/Attach on `grok-ios-daily` batch `d7eafb3c` (**1054460ms** `dailyPack` only) do **not** fill this freeze — later leftover-tolerant dest-end jobs below do.

## Evidence (no new packs this freeze)

### Web signed — Lane grok-lab, Playwright chromium, unique profile + SuperGrok fixture

| Cell | Job | Duration | Status |
| --- | --- | ---: | --- |
| Home | `a0b6380d-6bc9-4bf7-878c-714e6ddf7815` | 11805ms | captured pending |
| Attach | `a11c41b4-c699-4c88-b551-eedf739bb1ea` | 14334ms | captured pending |
| Imagine | `37014ba6-ae10-4e2a-b395-cc4cce72a6dc` | 14301ms | captured pending; **browser-approximation** |
| Settings | `3787eb65-1523-4525-beb0-c310c28eaa10` | 16197ms | captured pending |

Plan `cf9f0260-8be1-428a-85fc-b1453d4bcae6` cell span **57734ms**. Engine on disk is **chromium**. **Electron grok-lab is unproven; do not relabel this pack as Electron.** `persist:lane:grok-lab` is absent (Grok Bot Partitions has `sand-forever-box` only). Fail closed — do not treat grok-daily unsigned as SuperGrok.

### Web leftover-tolerant fill — Lane grok-lab, Playwright chromium, fixture `7189423f` ready

Did **not** tap Try now / Dismiss / Sign Out. Fast identifier TAP only on models. Capture-review later / pending. Fixture `7189423f` health **ready** / signed in.

| Cell | Job | Rev | Duration | Coverage | Status |
| --- | --- | ---: | ---: | --- | --- |
| Dictation inspect | `b1eead7a-775e-4569-bb30-d9d63fe94071` | r896 | 14736ms | inspect | captured pending |
| Sidebar | `b7c18573-1cc2-4fb5-92fe-2ec35aa86885` | r897 | 15181ms | dest-end transition | captured pending |
| Logo | `d8bf4385-97b1-4aee-9116-86cacc44b46e` | r898 | 8349ms | leftover inspect-skip | captured pending |
| Private chat | `2b2377c7-9e77-49a0-9aa1-e41299ec1831` | r899 | 12241ms | dest-end transition | captured pending |
| Composer focus | `ded7d047-82a0-4d69-b80c-03cf781cab60` | r901 | 11392ms | inspect `chat-input` | captured pending |
| Models | `f5116f81-87d6-448e-9d7d-2c545a649218` | r904 | 10877ms | dest-end last-frame Fast/Build/Auto/Expert/Heavy | captured pending |
| Models (prior) | `fc5c83d3-9cb1-49b2-b0b4-714af982a87e` | r899 | cancelled | transition SOS then cancel; radios never opened | not this slot |

Prior leftover signed-in home (`b2dcd768…`) with Introducing Build Mode overlay no-op'd identifier TAP `{1001,302}`. Did **not** Dismiss. r904 dest-end: optional wait-for Introducing Build Mode timeout 0; identifier-only TAP `model-select-trigger`; dest-wait Auto/Expert/Heavy; no Close/Dismiss/Back. TAP opened the sheet (dialog went away as the menu opened — not a Dismiss tap). Dest `frames/002.png` and capture-review dest-phase `frames/003.png` are the open Fast/Build/Auto/Expert/Heavy sheet (Fast checked). Capture-review `pending` · `settled:false` · `policy:fast` · intended app `Grok.com` · account `authfx:7189423f-193e-45ed-b674-154505cc5107:1` SuperGrok signed-in · action Inspect model choices signed-in · screen model sheet. Observed lane `grok-lab` · profile `browser:grok-com-1280x800-339a5a430a41` · Playwright. Optional dest-phase (no Looks-correct): dictation inspect `frames/001.png` leftover home + mic (no capture-review artifact); sidebar dest collapsed `frames/002.png`, last `frames/005.png` expanded home + leftover dialog; logo last `frames/005.png` leftover home; private-chat dest **PASS** `frames/002.png` + last `frames/003.png` Private + history disclaimer; composer inspect `frames/001.png` leftover home + `chat-input`. Leftover after models: signed-in home `b2dcd768…` + Introducing Build Mode returned. Not accepted. Do not enqueue SuperGrok on Electron.

### iOS chrome — physical iPad, prime without relaunch

| Cell | Job | Duration | Status |
| --- | --- | ---: | --- |
| Home | `3754526f-bcf2-4818-838e-0adcb8596a0e` r316 | 71141ms | captured pending; identity **PASS** `frames/003.png` SuperGrok Ask+Speak |
| Dictation inspect | `ea3bfb8e-005a-4442-b78a-49b40c11ba23` r316 | 67137ms | captured pending; identity **PASS** `frames/003.png` SuperGrok Speak visible; did not toggle; not orig 42 |
| Sidebar | `345c2e67-8b32-49f3-9d9a-1876809d313d` r316 | 57607ms | captured pending; dest **PASS** `frames/002.png` SuperGrok Plus Bernardo Ferrari + Automations + Settings gear; capture-review last `frames/005.png` SuperGrok home — last-frame **identity FAIL**. Close hid dest. Patched r324 |

Plan `78f13d43-6783-43fa-b5cd-29e7e2b1d340` cell span **196019ms**. This is **not** chrome quote `86740566` **120703ms** and **not** daily `d7eafb3c` **1054460ms**. Capture-review `fast` · `settled:false` · `status:pending`. App `Grok` / header SuperGrok. Pixel account SuperGrok Plus. **0 accepted.**

### iOS leftover-tolerant dest-end fill — Lane grok-ios-daily, prime without relaunch, review later, Fast UI

Sequential from leftover signed-in Home (keyboard leftover mid-pack). Identifier then label. Preview before tap. Did **not** 12-pack, Imagine/Create Videos, Sign Out, or conversation-list walk. Fast tap only on models. Job JSON `account:signed-out` is Lane `unsignedLaneId=grok-ios-daily` — pixels are SuperGrok / Bernardo Ferrari.

| Cell | Job | Rev | Duration | Coverage | Status |
| --- | --- | ---: | ---: | --- | --- |
| Logo | `eb3512fd-48d5-415e-8cdc-d5a0ffedc77d` | r317 | 7675ms | inspect wait-for | captured pending; identity **PASS** `frames/001.png` SuperGrok home Speak |
| Composer focus | `2e31db46-e93a-4b86-ab77-1f71917b110d` | r318 | 53636ms | transition; grok-arrows-right inspect-skip | captured pending; identity **PASS** `frames/005.png` focused Ask Anything + keyboard |
| Attach | `679b39b7-fb38-41de-a5b9-661504f0eeb0` | r319 | 88580ms | transition; camera inspect-skip then opener | captured pending; dest **PASS** `frames/004.png` Camera/Photo or Video/Files/Connectors/Skills; capture-review last `frames/008.png` Ask home + keyboard — last-frame **identity FAIL**. Close hid dest. Patched r325 |
| Models | `3cd34331-eacc-4f36-8a9d-6df00122a10d` | r320 | 37750ms | transition; Fast selector allowed | captured pending; dest **PASS** `frames/003.png` Fast sheet (Fast checked, Heavy/Expert/Auto/Build); capture-review last `frames/006.png` Ask home + keyboard — last-frame **identity FAIL**. Patched r326 dest-wait Heavy |
| Private chat | `dd229b0b-918e-42eb-9e62-fab1851a1d8d` | r321 | 88982ms | transition round-trip hat → Temporary Chat → Speak | captured pending; dest **PASS** `frames/005.png` Private Chat + Temporary Chat AX; capture-review last `frames/007.png` Speak home — last-frame **identity FAIL**. Patched r327 dest-wait Temporary Chat |
| Settings | `ec09b7ba-fe83-4fa4-b076-121bc713a99a` | r322 | 67974ms | transition peek; no Sign Out | captured pending; dest **PASS** `frames/007.png` Settings + Bernardo Ferrari @bernaferrari SuperGrok Plus; capture-review last `frames/011.png` SuperGrok home — last-frame **identity FAIL**. Close hid dest. Patched r328. Did not tap Sign Out |

iOS Imagine: compile `unresolved-step` (`navigation.tab.imagine` absent). **Blocked / Unbound.** Do not invent nav. Live leftover dest-wait patches **r324–r328** (sidebar no Close; attach no close; models dest-wait Heavy; private-chat dest Temporary Chat; settings dest close-button wait, no close tap). Did not re-run. Leftover after review: closed signed-in Home, keyboard dismissed, Speak unique, visual fp `8521c88d…`, AX `511ae65c64463269`.

### Android — physical SM S931B `RQCY104BG8X`

Capture-review on disk is **fast** · `settled:false` · `samples:1` · `status:pending`. `observed.profileId` `device:RQCY104BG8X-1080x2340`. App log `ai.x.grok`. No saved Lane `grok-android` (serial). Account SuperGrok / Bernardo Ferrari on sidebar + Settings. **0 accepted. No Looks-correct.** Closed Settings leftover to sidebar then Ask home Speak unique before dest-end re-runs. Live leftover dest-wait: logo r359, sidebar r360, models dest-wait Heavy **optional r364** (Auto sheet is pixels-only; Heavy never in AX). Leftover after this pass: Ask home Speak unique.

| Cell | Job | Duration | Status |
| --- | --- | ---: | --- |
| Home chrome | `ec54c62a-1de6-43ca-875a-0595c152b177` r339 | 9270ms | captured pending; identity **PASS** `frames/003.png` Ask+Imagine+Build+Speak |
| Sidebar | `de163986-c621-4fca-bb6a-bf1811f61ffe` r362 | 9730ms | captured pending; last-frame **PASS** `frames/003.png` Automations+Settings SuperGrok / Bernardo Ferrari. No Close in recipe. Prior `16e8fc06` r340 last-frame home after Close — not this slot |
| Imagine | `001be26c-3440-443f-ac03-06545a320999` r341 | 14681ms | captured pending; identity **PASS** `frames/005.png` Imagine + Type to imagine |
| Logo | `1d9acbd6-214f-4544-b790-b1062db8f721` r361 | 10418ms | captured pending; last-frame **PASS** `frames/003.png` Ask home Speak unique (not Type to imagine). Prior `c22f19eb` r342 Imagine leftover — not this slot |
| Dictation | `81b51428-9d40-401a-bffd-46121e962948` r349 | 9383ms | captured pending; identity **PASS** `frames/003.png` Ask home Speak visible; did not toggle |
| Composer focus | `78a0127a-f0b0-45e0-b1b8-634489b62b39` r350 | 13169ms | captured pending; identity **PASS** `frames/005.png` focused Ask anything + keyboard; transition-executed |
| Attach | `6529ee13-5d48-4db7-84da-d93783e74b47` r351 | 18436ms | captured pending; identity **PASS** `frames/006.png` Camera/Gallery/Files/Skills/Connectors (menu still up after Back) |
| Models | `5310092a-e5cf-4cd0-9e55-3a98e91bd9a2` r364 | 23521ms | captured pending; last-frame **PASS** checkpoint/`frames/005.png` Auto sheet (Heavy/Expert/Fast, Auto checked). Dest-wait Heavy optional — sheet uninspectable. No Back in recipe. Jobs `78e87393` / `294e8d22` r363 dest-wait Heavy **required** failed (AX miss, pixels dest) — not this slot. Prior `e53e8f65` r353 last-frame home after Back — not this slot |
| Private chat | `5e78db0d-1959-4cc1-b8ce-96848f371ce4` r354 | 13185ms | captured pending; identity **PASS** `frames/005.png` Private Chat + Temporary conversation |
| Settings | `6290fd6f-7ae0-4490-b45f-a8f7cb394830` r357 | 15351ms | captured pending; identity **PASS** `frames/006.png` Settings + Appearance + SuperGrok. `settings_button` is transition. Job `5372fb33` r355 inspect-skipped on sidebar Settings gear — **not** this slot |

**job.get matches** `tests/grok-android.capacity.json` and `docs/GROK_DAILY_QA.md`: Home/Sidebar/Imagine cell span **52880ms** (`startedAt` 1789578927191 → `finishedAt` 1789578980071). This 7-Test leftover-tolerant fill is **not** copied into P50. Orchestrator wall **62226ms** is `cliWatchMs`, not cell span. Not the 19-test Plan.

## Still not RC-23 acceptance

- **0 missing.** iOS Imagine stays **blocked Unbound**. iOS rows are 9 captured pending + 1 blocked — **not** 10 accepted.
- **29 captured ≠ 30 complete.** Android logo/sidebar/models dest-end last frames are now **identity PASS** (r361/r362/r364). Web models last-frame is the open selector (`f5116f81` r904). iOS sidebar/attach/models/private-chat/settings capture-review last frames are **identity FAIL** (close hid dest); dest-wait patched r324–r328, not re-run. **Not accepted.**
- No unfamiliar-QA vs agent (Package 3 Vite stranger still **blocked**; did not `pnpm dev:app`).
- No bulk accept; capture-review pending. Looks correct cannot accept missing.
- Workbook originals not executed (0/53/5).
- OPENROUTER unset. grok-com `authenticationFixtureId` stays empty.
- 19z5 stays open.
