# Phase 2.5a verification results

The body/interoception integration, prepared lab, scoped dashboard/browser walkthrough and one corrected actual-provider integration have evidence below. The current lab artifact and independent replay pass, with final lint/build and affected checks below. The initial full suite was **299/303**: three stale schema/gate assertions and one load-sensitive 100 ms provider fixture. Those four areas were corrected, and **54/54 affected tests**, final lint/build including TypeScript passed. The provider fixture budget changed to 1,000 ms with its assertions retained. This is not a fresh 303/303 full run. Logs: `diagnostics/physiology-final-{test,affected,lint,build}.txt`.

## Actual focused and browser evidence

| Check | Actual evidence |
| --- | --- |
| Host targeted checks | Earlier **48/48**; final actual-renderer/FAKE preflight + three cleanup-failure cases + eight verification checks **12/12 PASS**, `diagnostics/physiology-cleanup-final-check.log`; final lint/build |
| Core corrections | **54/54 affected PASS**, final lint/build; initial full **299/303** retained honestly |
| Independent boundary review | All P1/high-risk, legacy-import and sleep-attention fixes re-reviewed clean by Astra; ordinary cleanup targeted re-review clean |
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

The final current-schema lab at `diagnostics/physiology-lab/final-hunger.zip` and its `.summary.json` passed **9/9 computed assertions**, with COMPLETE evidence and independently matching current offline replay. It observed mild hunger during the running task at tick **20,000**, moderate at **40,000**, and severe crossing **49,091**→first attention **49,120**: **29 eligible world seconds**, zero exclusions and no breach, using 1 Hz production-rate genesis. Present severe hunger remained available with encoding disabled; activity continued until an explicitly supplied nutrition fixture relieved satiety and then absorbed reserves over 1,800 seconds. No meal acquisition/eating action or memory was asserted.

Independent inspection found **177,201 bytes**, **13 entries**, checkpoint **6** / runtime **5** with `legacyImport: null`, COMPLETE ticks **0–50,926**, **3,728 records**, **2 ordered inputs / 3,716 events**, zero gaps and zero drops. The documented CLI independently passed against the current code; log: `diagnostics/physiology-lab-independent-replay-current.log`.

```powershell
npm.cmd run replay -- --bundle diagnostics/physiology-lab/final-hunger.zip
```

| Canonical evidence | Hash |
| --- | --- |
| State | `eb6e3231050ec0d5524f44d3b9531f5118fe084b4e1c8eea2a35dbb69d38faa4` |
| Events | `698b9346ff4f716b52ab4cf222920a8cdde6b8b977b180bea00a31dc401eaad4` |
| Runtime | `10c54da48d4dc50bc4e6e57a85a7549d246e6729cd25786962d437d141f16546` |

The earlier pre-marker artifact is preserved as `final-hunger.pre-legacyImport.zip`; it is not substituted for current evidence.

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

All P1/high-risk and legacy-import/sleep-attention re-reviews are accepted. The cleanup-report correction retains response/input/budget evidence and any available COMPLETE replayable ZIP when initial close, restored close or restart listen fails; its three injected failure cases and the final 12-check group pass. Ordinary targeted cleanup re-review is clean with no further findings; all local reviews are resolved. No Phase 2.5a PR/hosted-review result is claimed before that workflow exists.

Checkpoint 6 now requires `physiology.legacyImport: null|{kind: explicit-unverified-import-v1, sourceHistoryId, destinationHistoryId, importTick}`. Only explicit bare legacy EXPERIMENT import creates a marker. Old origin/records/debug taint remain intact, same-tick old episodes are accepted, future internal encoding is permanently blocked as `legacy_unverified`, and secondary unverified imports reject. Awareness continues. The sleep-attention fix also prevents a first visual delivery while asleep from creating visual attention/baseline/cognition selection; already attended pre-sleep requests retain their separate late-result semantics.

New/migrated owner LIVE physiology remains inactive unless explicitly enabled; restored schema-6 gates obey the documented process override. No day/night/home loop, sustainable food behavior, long-running desktop/power guarantee or new pixel-confidence work is included. See [Physiology and interoception](physiology.md) for the model, calibration, severe-need eligibility, provenance and checkpoint contracts.
