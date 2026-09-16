# RC-23 screenshot-first inventory (2026-09-16)

**Not a workbook binding.** This file does not cover, bind, or accept any grok-qa original. Workbook stays **0 bound / 53 unbound / 5 excluded** (`tests/coverage/grok-qa-workbook.v1.yaml`). Similarly named Tests do not cover. `grok-ios-daily` 12/12 is not this freeze. Agents cannot Looks-correct. **0 accepted.**

Language: **planned · captured · blocked · missing · pending review**. Dest-end `outcome:passed` is execution only. Looks correct cannot accept missing.

Canonical freeze: `packages/protocol/src/rc23-screenshot-first.ts`. Slot identities: `tests/coverage/rc23-screenshot-first-slots.json`.

## Frozen denominator (10 × web/android/ios × attempt 1)

**30 planned · 17 captured · 1 blocked · 12 missing · 17 pending review · 0 accepted**

`17 + 1 + 12 = 30`. The mixed 13-cell count **cannot shrink this**. **17 captured jobs ≠ 30 complete.** Unsigned grok-daily Home/Settings are the same **web** slots as grok-lab — not a fourth configuration.

| Source | Planned | Captured | Blocked | Missing | Pending | Accepted |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Frozen 10×3 attempt 1 | **30** | **17** | **1** | **12** | **17** | **0** |
| Historical mixed cells (do not use) | 13 | 12 | 1 | 0 | 12 | 0 |

## Ten checkpoint ids

Dest-end on **at least one** platform (compile 2026-09-16, maps grok-web r896 / grok-android r357 / grok-ios r317). Web composer-focus has no Test. Web dictation is inspect, not dest-end. iOS Imagine compile `unresolved-step` — **blocked, not omitted**. Android 10/10 dest-ends are captured pending (not accepted).

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
| dictation | **missing** (inspect Test, not dest-end; never run) | captured pending `81b51428` | captured pending `ea3bfb8e` (not orig 42) |
| sidebar | **missing** (dest-end exists) | captured pending `16e8fc06` | captured pending `345c2e67` |
| attach | captured pending `a11c41b4` | captured pending `6529ee13` | **missing** (dailyPack is not this freeze) |
| settings | captured pending `3787eb65` | captured pending `6290fd6f` (Appearance panel; not sidebar gear) | **missing** (dailyPack is not this freeze) |
| imagine | captured pending `37014ba6` **browser-approximation** | captured pending `001be26c` | **blocked Unbound** |
| logo | **missing** (dest-end exists) | captured pending `c22f19eb` | **missing** (dailyPack is not this freeze) |
| composer-focus | **missing** (no web Test) | captured pending `78a0127a` | **missing** (dest-end exists) |
| models | **missing** (dest-end `model-iterate`) | captured pending `e53e8f65` (selector Auto; Fast visible, not a model-change) | **missing** (dest-end exists) |
| private-chat | **missing** (dest-end exists) | captured pending `5e78db0d` | **missing** (dailyPack is not this freeze) |

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

Unsigned Home `9c7a40d9` / Settings `ab4823a9` do not add web slots. iOS Settings/Attach on `grok-ios-daily` batch `d7eafb3c` (**1054460ms** `dailyPack` only) stay **missing** here.

## Evidence (no new packs this freeze)

### Web signed — Lane grok-lab, Playwright chromium, unique profile + SuperGrok fixture

| Cell | Job | Duration | Status |
| --- | --- | ---: | --- |
| Home | `a0b6380d-6bc9-4bf7-878c-714e6ddf7815` | 11805ms | captured pending |
| Attach | `a11c41b4-c699-4c88-b551-eedf739bb1ea` | 14334ms | captured pending |
| Imagine | `37014ba6-ae10-4e2a-b395-cc4cce72a6dc` | 14301ms | captured pending; **browser-approximation** |
| Settings | `3787eb65-1523-4525-beb0-c310c28eaa10` | 16197ms | captured pending |

Plan `cf9f0260-8be1-428a-85fc-b1453d4bcae6` cell span **57734ms**. Engine on disk is **chromium**. **Electron grok-lab is unproven; do not relabel this pack as Electron.**

### iOS chrome — physical iPad, prime without relaunch

| Cell | Job | Duration | Status |
| --- | --- | ---: | --- |
| Home | `3754526f-bcf2-4818-838e-0adcb8596a0e` | 71141ms | captured pending |
| Dictation inspect | `ea3bfb8e-005a-4442-b78a-49b40c11ba23` | 67137ms | captured pending; not orig 42 |
| Sidebar | `345c2e67-8b32-49f3-9d9a-1876809d313d` | 57607ms | captured pending |

Plan `78f13d43-6783-43fa-b5cd-29e7e2b1d340` cell span **196019ms**. This is **not** chrome quote `86740566` **120703ms** and **not** daily `d7eafb3c` **1054460ms**.

iOS Imagine: compile `unresolved-step` (`navigation.tab.imagine` absent). **Blocked / Unbound.** Do not invent nav.

### Android — physical SM S931B `RQCY104BG8X`

| Cell | Job | Duration | Status |
| --- | --- | ---: | --- |
| Home chrome | `ec54c62a-1de6-43ca-875a-0595c152b177` r339 | 9270ms | captured pending |
| Sidebar | `16e8fc06-bb9d-400b-9916-dc496c3096b9` r340 | 13367ms | captured pending |
| Imagine | `001be26c-3440-443f-ac03-06545a320999` r341 | 14681ms | captured pending |
| Logo | `c22f19eb-ba85-4201-a2f2-36f1c0f88c2d` r342 | 10190ms | captured pending; inspect-setup-skipped on Imagine leftover |
| Dictation | `81b51428-9d40-401a-bffd-46121e962948` r349 | 9383ms | captured pending |
| Composer focus | `78a0127a-f0b0-45e0-b1b8-634489b62b39` r350 | 13169ms | captured pending; transition-executed |
| Attach | `6529ee13-5d48-4db7-84da-d93783e74b47` r351 | 18436ms | captured pending; transition-executed |
| Models | `e53e8f65-9284-45f2-8e5c-21aed9f8cee1` r353 | 14734ms | captured pending; inspect selector **Auto** (live chip; Fast/Expert fallback). First Fast/Expert recipe failed (no job) |
| Private chat | `5e78db0d-1959-4cc1-b8ce-96848f371ce4` r354 | 13185ms | captured pending; dest Temporary conversation |
| Settings | `6290fd6f-7ae0-4490-b45f-a8f7cb394830` r357 | 15351ms | captured pending; dest **Appearance** (panel-unique); coverage **transition** on `settings_button`. Job `5372fb33` r355 inspect-skipped on sidebar Settings gear — **not** this slot |

**job.get matches** `tests/grok-android.capacity.json` and `docs/GROK_DAILY_QA.md`: Home/Sidebar/Imagine cell span **52880ms** (`startedAt` 1789578927191 → `finishedAt` 1789578980071). This 7-Test leftover-tolerant fill is **not** copied into P50. Orchestrator wall **62226ms** is `cliWatchMs`, not cell span. Not the 19-test Plan.

## Still not RC-23 acceptance

- 12 missing dest-end captures **not executed this freeze** (web + remaining iOS). iOS Imagine stays **blocked Unbound**.
- No unfamiliar-QA vs agent (Package 3 Vite stranger still **blocked**; did not `pnpm dev:app`).
- No bulk accept; capture-review pending. Looks correct cannot accept missing.
- Workbook originals not executed (0/53/5).
- OPENROUTER unset. grok-com `authenticationFixtureId` stays empty.
- 19z5 stays open.
