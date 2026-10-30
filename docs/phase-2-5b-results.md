# Phase 2.5b verification results

The initial frozen candidate passed **357/357 tests** (70.51 s), lint and build. Hosted [PR #10](https://github.com/PHead2001/Autonomous-Lumi/pull/10) then found two valid defects: sleep-disabled reactivation and wake fast-forward visibility. Both are fixed with three regressions and clean independent Astra re-review; the fresh full suite now passes **360/360**, zero failures in **32.201 s**, with full lint/build/typecheck PASS. Logs: `diagnostics/home-final-reviewfix-{test,lint,build}.log`. Both actual food/bed labs passed **5/5 checks**, COMPLETE diagnostic export and exact offline replay with **zero model requests**. The ordinary viewer’s food journey/download, cameras and narrow layout were checked. The normal browser bed scenario also reached **PASS**, with the timeline progressing through selection/travel/rest/sleep/wake/finished resting at world **330:16**. A bounded pre-backend-fix repeat visually confirmed **Getting into bed → reclined Sleeping → upright wake/exit** in the normal EXPERIMENT viewer, with the body length on the mattress and curled tail beside the body without floor clipping. Timeline and labelled time-lapse remained consistent. Independent local ordinary/Astra reviews and fix/re-review findings are closed. Hosted re-review of application source `f60421cc64297d23ce16d2749bf14af088ac3332` completed **CLEAN**, with no findings, unresolved threads or failing statuses; both initial threads are resolved. PR #10 remains open/unmerged. The latest fixes are loaded in the canonical owner runtime, with graceful sensor-watch recovery verified below.

## Checks and browser evidence

| Check | Actual result |
| --- | --- |
| `npm test` | **360/360**, zero failures, 32.201 s; `diagnostics/home-final-reviewfix-test.log` |
| Lint / build including TypeScript | **PASS**, `home-final-reviewfix-lint.log` / `home-final-reviewfix-build.log`; existing chunk-size advisory only |
| Focused behavior | **23** home checks, **31** affected host checks and **2** real watcher checks passed |
| Review | Initial local ordinary/Astra reviews resolved; two hosted findings now fixed with clean independent Astra re-review and three regressions; hosted re-review clean, both initial threads resolved |
| Latest hosted-fix checks | **360/360**, full lint/build/typecheck PASS; three regressions and local Astra re-review clean |
| Normal food Guided Lab | Browser **PASS**, actual experiment viewer and download |
| Observe / accessibility | Four modes, Free **W**, recenter, desktop and **390×844** narrow layout checked; camera operations emitted **zero outgoing WebSocket frames** in CDP evidence |
| Environmental cues / reconnect | Doorbell and slam server-confirmed, audio activated, actual owner disconnect/reconnect checked; audible playback and rapid ear articulation **not independently captured** |
| Browser bed journey | **PASS**, timeline through Finished resting at 330:16; repeat visually observed entry, reclined sleeping with body/tail on mattress, and upright wake/exit |
| Candidate continuity | Zero viewers while tick **23,027→24,217**; intentional abrupt stop then recovered committed tick **24,245**, same history `03f92748-fa34-4329-b67f-f68d179cc2fe`, generation **803**, no fallback |

Paths without a prefix are under `diagnostics/`. The continuity check used candidate data, not owner LIVE, and does not prove long uptime or power-failure readiness. All camera state remains browser presentation; no observer actor, sensory event or authority command is created by changing cameras.

## Actual reproducible food and bed experiments

```powershell
npm.cmd run home:lab -- --scenario food --out diagnostics/home-lab/my-food.zip
npm.cmd run home:lab -- --scenario bed --out diagnostics/home-lab/my-bed.zip
npm.cmd run replay -- --bundle diagnostics/home-lab/accepted-food.zip
npm.cmd run replay -- --bundle diagnostics/home-lab/accepted-bed-wake-boundary.zip
```

The accepted files are `diagnostics/home-lab/accepted-food.zip` and `accepted-bed-wake-boundary.zip`, each with its actual `.zip.summary.json`. The older `accepted-bed.zip` is historical pre-fix evidence only:

| Artifact | Evidence | Replay |
| --- | --- | --- |
| Food | **36,572 bytes**, 13 entries, COMPLETE, 123 records, no gaps/drops; **5/5** assertions | **PASS** tick 51, 10 inputs / 68 events |
| Bed, wake-boundary fix | **85,336 bytes**, 13 entries, COMPLETE, 730 records, no gaps/drops; **5/5** assertions | **PASS** tick 19,771, 43 inputs / 312 events |

Food evidence has legitimately recognized pantry/bed, controller selection at tick **41**, acquisition **46**, consumption **51**, actual body relief plus deferred absorption, and eligible production provenance. The bed fixture begins facing away from the resources; actual RGB discovery and refreshed attended need precede selection at **351**, bed-entry completion **358**, sleep **360** and natural wake/physical exit completion **19,771**. Search/fresh-cue waiting uses experiment **6×**, selected travel/interaction **1×**; asleep recovery uses bounded batches of at most **300 fixed ticks** in this 1 Hz fixture, now ending exactly at natural wake **19,766**, with no remaining fast-forward ticks. Home waking is **19,767** and physical exit completes **19,771**, both at 1×. The actual `.zip.wake-audit.json` records that boundary and subsequent scheduled operations. Body recovery rates are unchanged; normal LIVE remains 1×. Both scenarios have no fixture taint and no provider/model requests. Initial need and experiment rates are labelled fixtures, not owner LIVE manipulation.

Canonical hashes from the actual replay summaries:

| Evidence | Food | Bed |
| --- | --- | --- |
| State | `f7fa5038bcf90d41936cbd414ef23ac4d78f07a99d42f0e91c1d6e8286cc7825` | `def347b96da59fbd3efb077c10fe2a28c18e8b382c3161ee84e981758c1c5858` |
| Events | `84c60d6b0b843f32e047cdbca7e6b5333172b1cf65b8b031024f3bd435271611` | `4adf1aba6b504779f6bd03389ec6f4863d3322583b7c8ed238cfb5dac69cb305` |
| Runtime | `62faaca6b0d893462ad5e532edb57b0875168f0eb78a55b725c0faa42dba3d3c` | `fc866da9253181acfb3d53fab713e7ac88c1f85d1c67a89e6c728776e1b0cd2a` |

## Actual dashboard export and pose inspection

The browser filtered `HOME_FOOD_CONSUMED` in Advanced and confirmed its selected branch/run row, then used **Advanced → Export diagnostic ZIP**. The actual downloaded file `diagnostics/home-browser-20261030/food-dashboard.zip` was inspected and replayed **PASS**: **37,193 bytes**, 13 entries, COMPLETE, **119 records**, no gaps/drops, tick **27**, **10 inputs / 59 events**. Its actual `food-dashboard-inspection.json` retains manifest/assertion/hash/replay details. Export is scoped to that EXPERIMENT run and proves deterministic evidence, not rendered motion or sound.

```powershell
npm.cmd run replay -- --bundle diagnostics/home-browser-20261030/food-dashboard.zip
```

Diagnostic first-person renders from replayed accepted-bed states are `diagnostics/home-perception/actual-bed-357.png` (entry 2/3, eye height 2.12824) and `actual-bed-360.png` (reclined eye `[2.25, 1.305, -0.955]`), with classification/source/tick sidecars. The reclined actual view faces the ceiling consistently with the shared pose. They exercise shared posture/eye rendering; they are developer replay inspection, not a claim that asleep Lumi attended or remembered those frames.

The browser reopened a verified accepted-food checkpoint at tick **48** through the normal Advanced catalog into paused EXPERIMENT **home-meal-restore**. The normal viewer visibly showed **Eating 25%**, the held serving and lifted arms. This is a restored presentation check, not a fresh controller-choice claim. Fixture: `diagnostics/home-browser-20261030/lumi/replayed-food-pose/checkpoints/holding.json`. Two independent restores advanced 25 steps to matching future hashes and exactly one consumption, without duplication. Normal Advanced single-step controls then advanced **48→49 (Eating 50%)→50 (75%)→51 (Finished eating, server confirmed)**. The serving was visible in her hands at 48 and gone at 51; the timeline contained exactly one Acquired, one Consumed and one Finished event. This remains a restored-sequence check, not a fresh controller choice.

Owner rollout preflight backed up four files under `E:\Coding_Projects\Autonomous Lumi\diagnostics\operations\home-life-20261030T055431Z`, generation **275**, tick **2,727,584**, retaining the owner history. Pure checkpoint 7→8 comparison preserved prior state except intentional activation with a safe **right** layout, reachable anchors and a **771,185-byte** budget against 2 MiB. That was the earlier backup/migration preflight; the later actual rollout below selected its safe layout for the then-current actor.

## Verified initial canonical rollout

The owner app is running from the canonical runtime branch with server **3001** and viewer **5173**. It recovered checkpoint **7** at tick **2,741,432**, generation **292**, into checkpoint **8** / runtime **7** under the same history `90d139a5-e9a6-429d-98ac-a484539c9e24`. Home is active, `home-default`, ready with a safe **left** layout for the current actor, and tick advanced to **2,748,641+** without fallback/save error. Effect cursor **0** confirms no fictional meal was added at installation. Main cognition remains enabled, Decisions disabled, and `.env`/the durable budget unchanged.

Backup and operation evidence is under `E:\Coding_Projects\Autonomous Lumi\diagnostics\operations\home-life-20261030T055431Z`. A combined checkout-and-launch action was automatically rejected before execution; separate checkout and normal-default launch succeeded without environment/reset overrides. After fast-forward integration to reviewed application source `f60421c`, the canonical watcher gracefully restarted the same history with active/ready home state and no errors. A timestamp-only `src/avatar.ts` trigger then verified the actual sensor dependency watch: run `f41ade4a…` changed to `05438784-8545-49c8-b225-67a970845d8c`, tick **2,781,667** recovered at **2,781,673** and advanced to **2,781,686**, without fallback, save error or forced-kill warning. Proofs are `sensor-watch-proof.json` and `runtime-proof.json` in that operation folder. Server/viewer remain on 3001/5173; the temporary 3030 process was stopped.

## Limits and remaining handoff gates

The recognizer is a narrow authored RGB-sign mechanism, not learned object recognition or VLM acceptance. The utility baseline reacts to present attended cues/known targets without future body-stock lookahead. The bounded trial is not multi-day life balancing. Public activity evidence is not autobiography. Doorbell audible output remains unverified. Hosted source review and canonical reload are complete. The earlier browser pose walkthrough preceded the backend wake-boundary fix; its frontend was unchanged. Post-fix wake/exit timing is proven by the new actual bundle, operation audit and clock regression, not a newly repeated live visual walkthrough. Final computer-use reconnect attempts timed out, and the viewer-open request was queued, not rendered proof. The last actual health check had zero viewers while the world continued; no currently connected viewer is claimed. To check the remaining presentation limits manually, open 5173, press Slam to listen/watch the immediate ears, and run the Guided bed scenario to watch the post-fix wake/exit at 1×.
