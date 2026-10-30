# Phase 2.5a verification results

## Current v2 correction

The repair is isolated in the `physiology-review-fixes` worktree. It does not enable or migrate owner LIVE. Current contract is **checkpoint 7 / runtime 6 / `lumi-physiology-v2`**; body-rate math stays v1. Actual walking/task slowdown and restorable noisy ordinary sensing are implemented, while severe truth monitoring/deadline forcing bypasses noise/lapses. Active 6→7 migration preserves body/cues/deadlines/memories/gate/history and initializes only new sampling/task-credit fields at the current tick. Circadian phase remains tracked-only. No home/day/night/2.5b system or new paid call is included.

| Check | Actual evidence |
| --- | --- |
| V2 mechanics | **7/7**, plus **21** pure reducer and **17** integration checks |
| Measured execution | 20 simulated seconds: fatigue 0.05 → **12.128 m / 585 work units**; fatigue 0.95 → **9.448 m / 315 units** |
| Ordinary awareness under impairment | 32 seeded moderate-sleep fixtures (pressure 0.74, fatigue 0.8) attended in **5–40 world seconds**, before severe; this is a measured fixture range, not a new deadline guarantee |
| Actual renderer + FAKE provider | **1/1**, NVIDIA ANGLE, zero external calls; current v5 internal context |
| Historical actual checkpoint-6 ZIP | Original `pr9-final-hunger.zip` exact replay **PASS** with unchanged state/event/runtime hashes shown below |
| New V2 artifact | COMPLETE, **9/9** assertions and independent exact replay **PASS**, detailed below |
| Test stability | Baseline **308/308**, focused **36/36** and Windows cleanup **15/15** passed before final v2 full checks; isolated held-budget regression fails closed with zero dispatch then succeeds after release |
| Full suite | Initial new run **307/316**, nine stale schema fixtures corrected and affected **10/10 PASS**; final rerun **316/316 PASS**, zero failures in **28.75 s**, `diagnostics/physiology-v2-final-test.log`; initial failure log retained |
| Lint/build | Full lint/build passed before test-only corrections; final scoped lint of four changed tests and TypeScript passed (`physiology-v2-final-lint-scoped.log` / `physiology-v2-final-typecheck.log`) |
| Reviews | Independent high-risk Astra and ordinary current-diff reviews clean, no findings. No hosted clean result or owner-runtime upgrade claimed for this repair |

The test command now uses `--test-concurrency=4`. The host reports 24 available logical workers across 44 test files; this modest cap reduces concurrent process/CIM/ledger fixtures without changing production financial leases, cleanup deadlines or assertions. The prior sporadic Windows process-query timeout was not reproduced, and no blind timeout increase is claimed. No benchmark/performance campaign is implied.

The actual-renderer fixture now declares a stationary 120-world-second genesis window, preventing a genuine stale image after a waypoint turn before the new five-second first sample. Runtime freshness/safety guards were not relaxed. Existing pixel-confidence behavior is unchanged.

### Current V2 diagnostic artifact

`diagnostics/physiology-v2-hunger-final.zip` is **188,311 bytes**, **13 entries**, COMPLETE with **3,796 records**, **2 ordered inputs / 3,784 events**, zero gaps or drops. Both checkpoint/runtime payloads carry the new fractional credit and dedicated sampling PRNG/cadence. The summary passed **9/9**. Independent current replay passed at tick **50,926**; log: `diagnostics/physiology-v2-independent-replay.log`.

```powershell
npm.cmd run replay -- --bundle diagnostics/physiology-v2-hunger-final.zip
```

| Canonical evidence | Hash |
| --- | --- |
| State | `171b518da373bdd2e86e1300dfc28ba6851e8f1410d6365c85742efe269f2227` |
| Events | `295e9a4482ab2bb8063e936d1ca9c8383b6b6588885107bb7356bf10c81d49fa` |
| Runtime | `69b97d58faa266574f002205bb1dd89b803787c80088e19083182298b91552df` |

The noisy mild checkpoint is tick **24,000**, moderate **40,000**. Exact severe crossing **49,091**→attention **49,120** remains **29 raw/eligible seconds**, all exclusions zero and no breach. The labelled nutrition fixture resolves the need at **49,126**; absorption completes at **50,925**. This is still a fixture, not evidence of food acquisition/eating. No original-runtime activation or actual owner migration has been verified by these isolated checks.

## Historical checkpoint-6 / v1 evidence

[PR #9](https://github.com/PHead2001/Autonomous-Lumi/pull/9) hosted review found three actionable defects: validated LIVE checkpoint override history continuity, activation capacity on older-schema migration, and fractional absorption completion. All three are locally fixed: final `npm.cmd test` passed **308/308**, zero failures in **18.86 s**; lint/build passed, with the existing >500 kB chunk advisory only. Independent local re-reviews are clean. Logs: `diagnostics/physiology-pr9-final-{test,lint,build}.txt`. The regenerated current-chain lab is independently verified COMPLETE/replay PASS. Hosted threads await push/re-review; no clean hosted outcome is claimed. Earlier paid artifacts remain historical development-contract evidence.

## Prior verification evidence

The body/interoception integration, prepared lab, scoped dashboard/browser walkthrough and one corrected actual-provider integration have evidence below. The pre-hosted-fix lab artifact and independent replay passed, with final lint/build and affected checks below. The initial full suite was **299/303**: three stale schema/gate assertions and one load-sensitive 100 ms provider fixture. Those four areas were corrected, and **54/54 affected tests**, final lint/build including TypeScript passed. The provider fixture budget changed to 1,000 ms with its assertions retained. This is not a fresh 303/303 full run. Logs: `diagnostics/physiology-final-{test,affected,lint,build}.txt`.

## Actual focused and browser evidence

| Check | Actual evidence |
| --- | --- |
| Host targeted checks | Earlier **48/48**; final actual-renderer/FAKE preflight + three cleanup-failure cases + eight verification checks **12/12 PASS**, `diagnostics/physiology-cleanup-final-check.log`; final lint/build |
| Core corrections | **54/54 affected PASS**, final lint/build; initial full **299/303** retained honestly |
| Independent boundary review | All PR #9 boundary re-reviews clean; source complete locally, hosted re-review pending |
| Final PR #9 full checks | **308/308 PASS**, lint/build PASS; existing chunk advisory only |
| Actual renderer + FAKE-provider preflight | **1/1**, not a paid-provider substitute |
| Attention demo | **1/1** |
| Zero-viewer continuity/recovery | Actual autoscheduled host runs for 350 ms, advances at least three ticks with zero viewers, then RecoveryStore restart preserves active body, one internal episode and history |
| Host suspend | Controlled 60-second gap gives zero executed steps and identical complete simulation checkpoint; no hunger/sleep-recovery advancement |
| Dashboard | Normal LIVE/EXPERIMENT selection, coarse current sensation, private advanced numbers; experiment 5259→5260 exact step, pause/resume; expired transient accurately shows no attended sensation |
| Original viewer | Upright feminine humanoid, walking, ears/tail/arms/hands visible; position changed; disconnect 2:44→reconnect 2:56 to same advancing preview run |
| Slam/audio | Normal button activated audio UI; audible sound and immediate door/ear transient were not independently captured, so no fresh articulated-reflex proof claimed |

Screenshot: `diagnostics/physiology-dashboard.png`. Browser work used an isolated active/fast preview with providers OFF; owner port 3001/data remained untouched. A 350 ms runtime and injected suspend gap are not prolonged uptime, machine shutdown or power-readiness acceptance.

## Prepared hunger laboratory

```powershell
npm.cmd run physiology:lab -- --out diagnostics/physiology-lab/hunger-during-task.zip
npm.cmd run replay -- --bundle diagnostics/physiology-lab/hunger-during-task.zip
```

The final current-contract lab at `diagnostics/physiology-lab/pr9-final-hunger.zip` and its `.summary.json` passed **9/9 computed assertions**, with COMPLETE evidence and independently matching replay against the final local contract. It observed mild hunger during the running task at tick **20,000**, moderate at **40,000**, and severe crossing **49,091**→first attention **49,120**: **29 eligible world seconds**, zero exclusions and no breach, using 1 Hz production-rate genesis. Present severe hunger remained available with encoding disabled; activity continued until an explicitly supplied nutrition fixture relieved satiety and then absorbed reserves over 1,800 seconds. No meal acquisition/eating action or memory was asserted.

Independent inspection found **177,396 bytes**, **13 entries**, checkpoint **6** / runtime **5** with `legacyImport: null` and `verifiedCheckpointImports: []` in both simulation/runtime snapshots, COMPLETE ticks **0–50,926**, **3,728 records**, **2 ordered inputs / 3,716 events**, zero gaps and zero drops. The documented CLI independently passed against current code; log: `diagnostics/physiology-lab-independent-replay-pr9-final.log`. Privacy inspection found no credentials, raw prompts/responses, pixel/image payloads, contact data or private geometry.

```powershell
npm.cmd run replay -- --bundle diagnostics/physiology-lab/pr9-final-hunger.zip
```

| Canonical evidence | Hash |
| --- | --- |
| State | `06a24cf498a34246645b11d7c2eab71b7f1fce5c8faa703a2859c208344742b6` |
| Events | `698b9346ff4f716b52ab4cf222920a8cdde6b8b977b180bea00a31dc401eaad4` |
| Runtime | `3c33cd94395d19e1fee8984832868e261b25543c73c344d62f51a84bf3d55858` |

Earlier `final-hunger.zip` and `final-hunger.pre-legacyImport.zip` artifacts remain development history, not substitutes for this current-chain replay. The final evidence also records fixture intake/urgent resolution at tick 49,126 and absorption completion at 50,925; this remains a labelled fixture, not actual food acquisition/eating.

## Actual active-profile provider check

```powershell
# Explicit paid opt-in, enabled main cognition/local key required.
# Exactly one main request, zero Decisions calls; uses the existing shared US$1 ledger.
npm.cmd run cognition:verify -- --paid --physiology --out diagnostics/physiology-provider-check
```

There were **two authorized single-call attempts**, not an automatic retry loop. The first report, `diagnostics/physiology-provider-single/physiology-verification.json`, received a valid provider response but correctly marked harness acceptance **INCOMPLETE** because internal context was empty: a head commitment preceded awareness. It cost **US$0.00006449** and remains retained.

The corrected report, `diagnostics/physiology-provider-corrected/physiology-verification.json`, **passed**. An actual 512×512 render and `lumi-vision-prompt-v5` request included nonempty severe-hunger context with only `kind`, `band`, description and coarse uncertainty; private-field inspection found no numeric-body/private evidence leak. The response normalized successfully, with no validation error, and the actual internal episode survived a cognition-disabled restart. Its ZIP was COMPLETE and replay passed **at the time of that development contract**. The later mandatory `legacyImport` field deliberately makes both original paid ZIPs reject against the final checkpoint contract with `Invalid checkpoint: physiology runtime fields`. Both originals remain unmodified and their `current-replay-status.json` records `HISTORICAL_DEVELOPMENT_CONTRACT`; no current paid-ZIP replay acceptance is claimed. Actual wire/context/provider success, reported cost and the at-time restart observation remain evidence, not a substitute for current artifact replay. The corrected call used **912 input / 343 output tokens**, **7,896.13 ms** provider-adapter latency and reported **US$0.00007195**; provider revision metadata was unavailable. This is one active-profile integration, not a perception benchmark or evidence of independent food/recovery behavior.

The two calls total **US$0.00013644**. The original application-wide ledger ceiling remained **US$1**; accounted spending rose **US$0.101369685→US$0.101506125**, with the prior unknown reservation retained. No ledger reset, raised ceiling or Decisions call was used. The labelled acceptance-fast disposable LIVE genesis does not alter owner history or production rates.

## Review and material limits

Earlier P1/high-risk and legacy-import/sleep-attention re-reviews were accepted before the three hosted findings. The cleanup-report correction retains response/input/budget evidence and any available COMPLETE replayable ZIP when initial close, restored close or restart listen fails; its three injected failure cases and the final 12-check group pass. Ordinary targeted cleanup re-review was clean. All local PR #9 targeted re-reviews are now clean, including independent Astra boundary review. Hosted re-review remains pending; no clean hosted outcome is claimed.

Checkpoint 6 now requires `physiology.legacyImport: null|{kind: explicit-unverified-import-v1, sourceHistoryId, destinationHistoryId, importTick}`. Only explicit bare legacy EXPERIMENT import creates a marker. Old origin/records/debug taint remain intact, same-tick old episodes are accepted, future internal encoding is permanently blocked as `legacy_unverified`, and secondary unverified imports reject. Awareness continues. The sleep-attention fix also prevents a first visual delivery while asleep from creating visual attention/baseline/cognition selection; already attended pre-sleep requests retain their separate late-result semantics.


### Hosted correction contract (locally verified)

An explicit validated LIVE `LUMI_CHECKPOINT` override creates a new history under the existing RecoveryStore policy. Schema 6 requires `physiology.verifiedCheckpointImports: []`, bounded to **eight** edges of `{kind: explicit-live-checkpoint-import-v1, sourceHistoryId, destinationHistoryId, importTick}`. Only the validated LIVE explicit-override boundary may append one; ordinary restore cannot infer authorization. Source origin, old memories and debug taint remain unchanged. Old-source episodes are bounded at or before the import tick; legitimate new destination episodes are strictly after it, and verified future encoding remains allowed. The chain carries into experiment forks. This is separate from the unverified EXPERIMENT `legacyImport` marker, whose permanent future-encoding restriction remains.

Activation must preflight the complete capacity budget on every path, including old-schema migration. Fractional absorption must normalize completion instead of retaining a tiny residual/timer inconsistency. The reducer passed **21 tests** and clean ordinary review; core passed **52 targeted checks plus one composition regression**; host passed **10 context checks** and TypeScript. These cover named/bare LIVE override startup, old visual/internal preservation plus valid destination encoding, normal restart, experiment fork and unverified legacy composition, EXPERIMENT→LIVE rejection, eight-edge bounds and near-capacity schema-5 activation preflight. Maximum reserved-growth shape including all eight edges measured **338,421 bytes**, below 384 KiB by **54,795 bytes**. Independent Astra re-review accepted all affected boundaries.

New/migrated owner LIVE physiology remains inactive unless explicitly enabled; restored schema-6 gates obey the documented process override. No day/night/home loop, sustainable food behavior, long-running desktop/power guarantee or new pixel-confidence work is included. See [Physiology and interoception](physiology.md) for the model, calibration, severe-need eligibility, provenance and checkpoint contracts.
