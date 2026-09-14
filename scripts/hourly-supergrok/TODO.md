# Hourly SuperGrok — gated leftovers (`relay plan run … --todo`)

Heavy is a Lane swap on `grok-lab`, not overlay.json. Never bind onto `browser:grok-com`. Never write passwords. Do not invent Tests.

grok-web Plans: `grok-web-daily` (logged-out 8), `grok-web-weekly`, `grok-hourly` (saved chrome: signed-in home / attach / model). Do not invent Tests. Do not include Delete / Sign Out / older-chat / Thread.

Tick 5 (2026-09-13 ~17:50 local): `plan run grok-web grok-hourly --lane grok-lab` batch `f2695937` passed — home `50a0daec`, attach `86946221`, model `8e4c09f3`. Matrix locale name is `logged-out`; session was signed-in (Bernardo Ferrari). Findings 0. Did not generate; tick 2 SuperGrok rate-limit still up. Visuals: `relay run visual review <job>` only.

Tick 6 (2026-09-13 ~18:50 local): same Plan, batch `5b47d4c2` passed — home `8d413062`, attach `e908b8f8`, model `b2a7228e`. Signed-in. Findings 0. No rate-limit banner on chrome. Did not generate; tick 2 ~10h SuperGrok limit still in window. Did not tap Fast/Expert/Heavy.

Tick 7 (2026-09-13 ~19:50 local): same Plan, batch `36061fc5` passed — home `29bc05e1`, attach `d0dadfd9`, model `0025731d`. Signed-in. Findings 0. No rate-limit banner. Did not generate; tick 2 ~10h SuperGrok limit still in window. Did not tap Fast/Expert/Heavy.

Tick 8 (2026-09-13 ~20:50 local): same Plan, batch `d29f69a1` passed — home `9ffaea27`, attach `014b15cd`, model `8a20f9e6`. Signed-in. Findings 0. No rate-limit banner. Did not generate; tick 2 ~10h SuperGrok limit still in window. Did not tap Fast/Expert/Heavy.

Tick 9 (2026-09-13 ~21:50 local): same Plan, batch `cd0fd5db` passed — home `179284fb`, attach `72286bd3`, model `cc54a3b3`. Server had restarted (pid 59589); lane still signed-in. Findings 0. No rate-limit banner. Did not generate; tick 2 ~10h SuperGrok limit still in window. Did not tap Fast/Expert/Heavy.

Tick 10 (2026-09-13 ~22:50 local): same Plan, batch `3950625c` passed — home `de425202`, attach `120e2335`, model `08ddad9f`. Signed-in. Findings 0. No rate-limit banner. Did not generate; tick 2 ~10h SuperGrok limit still in window (~until 00:50). Did not tap Fast/Expert/Heavy.

First pass 2026-09-13 used lab SuperGrok `7189423f-193e-45ed-b674-154505cc5107` + unique profile `browser:grok-com-1280x800-339a5a430a41`. grok-com daily fixture stayed empty.

- [ ] Chat Heavy (this lab account cannot — do not fake)
- [ ] Chat Expert / Fast if they still open SuperGrok pricing (preview; do not fake). Tick 3 job `2b265331` opened selector: Fast (already checked), Auto, Expert, Heavy + SuperGrok Upgrade in-menu. Did not tap Fast/Expert/Heavy.
- [ ] Chat Auto if the product forbids it for tests. Auto row seen on `2b265331`; not selected.
- [x] Chat Build (intro chrome `1cc08eef` — “Build Mode” / Try now. Not a built app. Visual frames only.)
- [x] Imagine Speed _generation_ (job `8808b405`; dest-end + wait-for Speed; prompt “hourly relay red cube”. Visual frames only — do not auto-accept. Not Heavy.)
- [ ] Imagine Quality 2.0 (if Heavy-gated). Tick 4 job `d9abb699` dest-end chrome: Quality 2.0 radio present. Not generated.
- [ ] Imagine Agent image / Agent video. Agent radio on `d9abb699`. Not generated.
- [ ] Video 480p / 720p / 1080p, upscale, extension (Video radio on `d9abb699`; resolutions not exercised)
- [ ] Image editing (Photo Edit / Image Editing on `d9abb699`. Not exercised.)
- [ ] Media upload: image and video (file PDF passed `5527f701`)
- [ ] Voice conversation (headed + mic; chrome-only `2f9011ac` is not a pass)
- [ ] Dictation (`Dictation (⌃D)` on Imagine `d9abb699`; not exercised)
- [ ] Read Aloud (assert spoken/text output, not only a menu label). Tick 2 job `aa18aee0` hit SuperGrok rate-limit banner (~10h) before toolbar/More; SOS paused; cancelled. Fail closed.
- [ ] Google SSO / Apple SSO / X Auth / Email Login (reuse saved fixtures; record once if a person must complete OAuth; Cloudflare on Sign Out/Sign up is Infra)
