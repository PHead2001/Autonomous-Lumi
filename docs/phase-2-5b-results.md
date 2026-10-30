# Phase 2.5b verification results

The frozen candidate passes **357/357 tests** (70.51 s), lint and build. Both actual food/bed labs passed **5/5 checks**, COMPLETE diagnostic export and exact offline replay with **zero model requests**. The ordinary viewer’s food journey/download, cameras and narrow layout were checked. The normal browser bed scenario also reached **PASS**, with the timeline progressing through selection/travel/rest/sleep/wake/finished resting at world **330:16**. A bounded repeat visually confirmed **Getting into bed → reclined Sleeping → upright wake/exit** in the normal EXPERIMENT viewer, with the body length on the mattress and curled tail beside the body without floor clipping. Timeline and labelled time-lapse remained consistent. Independent local ordinary/Astra reviews and fix/re-review findings are closed. Hosted review and canonical owner-runtime integration remain **PENDING**.

## Checks and browser evidence

| Check | Actual result |
| --- | --- |
| `npm test` | **357/357**, zero failures; `diagnostics/home-final-test.log` |
| Lint / build including TypeScript | **PASS**, `home-final-lint.log` / `home-final-build.log`; existing chunk-size advisory only |
| Focused behavior | **23** home checks, **31** affected host checks and **2** real watcher checks passed |
| Review | Independent ordinary and Astra reviews/fix/re-reviews resolved; hosted review pending |
| Normal food Guided Lab | Browser **PASS**, actual experiment viewer and download |
| Observe / accessibility | Four modes, Free **W**, recenter, desktop and **390×844** narrow layout checked; camera operations emitted **zero outgoing WebSocket frames** in CDP evidence |
| Environmental cue | Doorbell server-confirmed and audio activated; audible playback **not independently verified** |
| Browser bed journey | **PASS**, timeline through Finished resting at 330:16; repeat visually observed entry, reclined sleeping with body/tail on mattress, and upright wake/exit |
| Candidate continuity | Zero viewers while tick **23,027→24,217**; intentional abrupt stop then recovered committed tick **24,245**, same history `03f92748-fa34-4329-b67f-f68d179cc2fe`, generation **803**, no fallback |

Paths without a prefix are under `diagnostics/`. The continuity check used candidate data, not owner LIVE, and does not prove long uptime or power-failure readiness. All camera state remains browser presentation; no observer actor, sensory event or authority command is created by changing cameras.

## Actual reproducible food and bed experiments

```powershell
npm.cmd run home:lab -- --scenario food --out diagnostics/home-lab/my-food.zip
npm.cmd run home:lab -- --scenario bed --out diagnostics/home-lab/my-bed.zip
npm.cmd run replay -- --bundle diagnostics/home-lab/accepted-food.zip
npm.cmd run replay -- --bundle diagnostics/home-lab/accepted-bed.zip
```

The accepted files are `diagnostics/home-lab/accepted-food.zip` and `accepted-bed.zip`, each with its actual `.zip.summary.json`:

| Artifact | Evidence | Replay |
| --- | --- | --- |
| Food | **36,572 bytes**, 13 entries, COMPLETE, 123 records, no gaps/drops; **5/5** assertions | **PASS** tick 51, 10 inputs / 68 events |
| Bed | **83,596 bytes**, 13 entries, COMPLETE, 728 records, no gaps/drops; **5/5** assertions | **PASS** tick 19,816, 41 inputs / 324 events |

Food evidence has legitimately recognized pantry/bed, controller selection at tick **41**, acquisition **46**, consumption **51**, actual body relief plus deferred absorption, and eligible production provenance. The bed fixture begins facing away from the resources; actual RGB discovery and refreshed attended need precede selection at **351**, bed-entry completion **358**, sleep **360** and natural wake/physical exit completion **19,771**. Search/fresh-cue waiting uses experiment **6×**, selected travel/interaction **1×**; asleep recovery uses bounded **300 fixed-tick** batches in this 1 Hz fixture. Body recovery rates are unchanged; normal LIVE remains 1×. Both scenarios have no fixture taint and no provider/model requests. Initial need and experiment rates are labelled fixtures, not owner LIVE manipulation.

Canonical hashes from the actual replay summaries:

| Evidence | Food | Bed |
| --- | --- | --- |
| State | `f7fa5038bcf90d41936cbd414ef23ac4d78f07a99d42f0e91c1d6e8286cc7825` | `c3fb9ada66b891976276eaed49a5689c8d65aca30629df1c182d12c05d67c8b3` |
| Events | `84c60d6b0b843f32e047cdbca7e6b5333172b1cf65b8b031024f3bd435271611` | `51a496b31c58ed00aeb20f39eab7681687427a8d81cfb3266956cb974cfaf675` |
| Runtime | `62faaca6b0d893462ad5e532edb57b0875168f0eb78a55b725c0faa42dba3d3c` | `8cd15b3d129dedc540f7f85f0b4542775c9d2dba53c760b93aed46dc6b5c9c1b` |

## Actual dashboard export and pose inspection

The browser filtered `HOME_FOOD_CONSUMED` in Advanced and confirmed its selected branch/run row, then used **Advanced → Export diagnostic ZIP**. The actual downloaded file `diagnostics/home-browser-20261030/food-dashboard.zip` was inspected and replayed **PASS**: **37,193 bytes**, 13 entries, COMPLETE, **119 records**, no gaps/drops, tick **27**, **10 inputs / 59 events**. Its actual `food-dashboard-inspection.json` retains manifest/assertion/hash/replay details. Export is scoped to that EXPERIMENT run and proves deterministic evidence, not rendered motion or sound.

```powershell
npm.cmd run replay -- --bundle diagnostics/home-browser-20261030/food-dashboard.zip
```

Diagnostic first-person renders from replayed accepted-bed states are `diagnostics/home-perception/actual-bed-357.png` (entry 2/3, eye height 2.12824) and `actual-bed-360.png` (reclined eye `[2.25, 1.305, -0.955]`), with classification/source/tick sidecars. The reclined actual view faces the ceiling consistently with the shared pose. They exercise shared posture/eye rendering; they are developer replay inspection, not a claim that asleep Lumi attended or remembered those frames.

The browser reopened a verified accepted-food checkpoint at tick **48** through the normal Advanced catalog into paused EXPERIMENT **home-meal-restore**. The normal viewer visibly showed **Eating 25%**, the held serving and lifted arms. This is a restored presentation check, not a fresh controller-choice claim. Fixture: `diagnostics/home-browser-20261030/lumi/replayed-food-pose/checkpoints/holding.json`. Two independent restores advanced 25 steps to matching future hashes and exactly one consumption, without duplication. Normal Advanced single-step controls then advanced **48→49 (Eating 50%)→50 (75%)→51 (Finished eating, server confirmed)**. The serving was visible in her hands at 48 and gone at 51; the timeline contained exactly one Acquired, one Consumed and one Finished event. This remains a restored-sequence check, not a fresh controller choice.

Owner rollout preflight backed up four files under `E:\Coding_Projects\Autonomous Lumi\diagnostics\operations\home-life-20261030T055431Z`, generation **275**, tick **2,727,584**, retaining the owner history. Pure checkpoint 7→8 comparison preserved prior state except intentional activation with a safe **right** layout, reachable anchors and a **771,185-byte** budget against 2 MiB. This is backup/migration preflight only; actual owner rollout remains pending.

## Limits and remaining handoff gates

The recognizer is a narrow authored RGB-sign mechanism, not learned object recognition or VLM acceptance. The utility baseline reacts to present attended cues/known targets without future body-stock lookahead. The bounded trial is not multi-day life balancing. Public activity evidence is not autobiography. Doorbell audible output remains unverified. Hosted review and canonical owner-runtime upgrade still require their actual results; an isolated candidate or Git push alone does not prove the running owner app changed.
