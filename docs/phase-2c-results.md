# Phase 2c verification results

Current repair verification passes: **263/263** offline tests, lint/build, actual `vision:verify` **8/8**, attention **2/2**, and a bounded **six-call actual prompt-v4 run**. All six main HTTP 200 responses normalized successfully with `validationError: null`; six COMPLETE bundles replay with matching canonical results. No automated retries or Decisions calls occurred in this correction. Independent ZIP inspection and hosted review of the new patch remain pending; earlier source approvals are historical. PR #8 remains open/unmerged.

## Current contract and local verification

The active contract is `lumi-vision-prompt-v4` / `lumi-interpretation-v2`, with `rgb-mask-contrast-v2`. The model returns interpretation, uncertainty, evidence handles and action; the server binds immutable observation/frame identifiers after strict remote parsing, then independently validates references/actions/encoding. Optional bounded `validationError` categories distinguish malformed JSON, schema, unsupported action, observation/frame mismatch, unknown handle, provider envelope, incomplete output and model mismatch. API/ordered diagnostics/bundles preserve only the category, not raw rejected content.

The prompt requests plain first-person perception. Existing v3 memories remain verbatim history and eligible context; the repair does not rewrite them. Historical schema-5 requests and old paid bundles retain exact replay semantics. `rgb-mask-contrast-v2` excludes only no-raster-pixel or zero-local-RGB candidates. Positive weak/same-wall evidence remains LOW; the actual same-wall case retained three LOW hints. The actual pixel + FAKE transport **3/3** verifies visible `inspect`→fresh capture, black without shapes and invented-handle rejection with zero memory.

All six harness cases run even after a case failure, with strict overall acceptance and attempted LIVE recovery. Immutable case identity/generation/deadline, abortable pacing, `endCase` cleanup and a synchronous dispatch guard prevent delayed calls leaking into later cases. Configured pacing beyond the 60-second case budget yields a timeout without a late call. Provider checks **54** and pacing/provider/verification checks **27/27** passed; focused reviews are resolved. The initial **259/260** run is superseded by the final **263/263** result, not presented as an all-green earlier run.

| Check | Actual result / local evidence |
| --- | --- |
| `npm test` | **263/263 PASS**, `diagnostics/v4-repair-final-tests.log` |
| Lint / build including TypeScript | **PASS**, `v4-repair-final-lint.log` / `v4-repair-final-build.log` |
| Actual renderer / attention | **8/8 / 2/2 PASS**, `v4-repair-vision-verify.log` / `v4-repair-vision-attention.log` |
| Actual pixel + FAKE transport | **3/3 PASS**, zero external calls |
| Cleanup | **15/15** focused checks, actual **8/8**, lint/TypeScript and independent Astra review clean |
| New repair hosted review / independent ZIP check | **PENDING** |

Paths without a prefix are under `diagnostics/`. Cleanup has a structural fallback for a confirmed owned-renderer exit within the original shared **2,500 ms** deadline and a server-filtered CIM query; queried PIDs are never killed. This repairs the fallback race and reduces query work. The external four-failure sequence and its reported paths were unavailable here, so its exact cause and elimination are not proven.

## Actual prompt-v4 paid acceptance

Sources: `diagnostics/phase2c-paid-v4-repair-20261029/{verification.json,acceptance-summary.json,http-evidence.json}`. Six main calls used actual 512×512 images on the same Qwen route; all six succeeded, with no validation category, retries or optional Decisions call. Zero forbidden context fields were found. This bounded sample is not a reliability/failure-rate estimate and does not explain the inaccessible earlier v3 reports at `C:\Users\PhillipHead\lumi-paid-2c-v3` and `lumi-paid-2c-v3b`.

| Case | Provider latency (s) | Ordered request→result wall time (s) | Model uncertainty | Local action result |
| --- | ---: | ---: | ---: | --- |
| visible | 11.221 | 11.270 | 0.2 | continued |
| partial | 9.443 | 9.462 | 0.25 | continued |
| dark | 5.093 | 5.145 | 1 | continued |
| absent | 7.749 | 10.933 | 0.1 | continued |
| hidden | 5.973 | 6.974 | 0.95 | continued |
| temporary-live | 9.464 | 11.409 | 0.65 | observed_bearing_exceeds_head_limits |

The dark input was actual **512×512 RGB max 0**, with **zero shape hints and zero prior experiences before the response**. The model reported completely black/no visual information, uncertainty **1**, empty evidence handles and no object claim. Its fallible darkness interpretation was then admitted; this is not memory-free after encoding. All six admitted texts match the model response verbatim, and the developer-geometry-wording scan found **zero** occurrences. Existing stored v3 text was preserved rather than rewritten.

In temporary LIVE, the proposal's `look` action was rejected at tick **388** with `observed_bearing_exceeds_head_limits`. Its actual-renderer perception independently qualified for encoding, without claiming a completed action (`RealExperience.actionOutcome: null`). Restart with cognition disabled retained **one** record in the **same** isolated temporary history. The harness did not use owner LIVE history.

The run reported **5,057 input / 2,119 output tokens**, **US$0.00042718** main cost. Durable accounted spending moved from **US$0.100942505** to **US$0.101369685**, with **pending 0 / unknown 1**. The original failed request's **US$0.1002304** unknown reservation remains charged; no ledger reset/refund was used. Provider latency was **5.093–11.221 s**, ordered end-to-end **5.145–11.409 s**; separate HTTP intervals are recorded in the source report. Uncertainty is not calibrated accuracy and provider revision metadata remains unavailable.

All six new bundles are COMPLETE and their recorded CLI replay results are PASS. For example:

```powershell
npm.cmd run replay -- --bundle diagnostics/phase2c-paid-v4-repair-20261029/temporary-live.zip
```

| Temporary LIVE canonical evidence | Result |
| --- | --- |
| Tick / ordered inputs / events | 388 / 9 / 60 |
| State | `9e31d1da1e2d6724e0bf0a946ba353a5d69b941dea3ac1eeeb6a51e499aba068` |
| Events | `d97a0926e40d875879ff5c5595b5e6ac5221e493943b5fc51a811a2b3f37482d` |
| Runtime | `dba9519c5b95f84e87a8a9cf3c8a8c0dabd891f03e0178cfd0c5765570b34d05` |

Independent inspection of this new ZIP remains pending. Earlier independent artifact proof and optional Decisions results below are kept as historical evidence, not substituted for the new artifact or re-run here.

## Earlier pixel-confidence correction (historical)

The renderer is `three-room-pixel-evidence-v2`; qualification is `rgb-mask-contrast-v1`, provider profile `pixel_checked_v3`, prompt `lumi-vision-prompt-v3`. Output schema remains `lumi-interpretation-v1`; handles and `inspect` keep their existing format. Current hints use `geometry_candidates_pixel_checked` with bounded quality flags; old geometry-only records preserve their original offline semantics. The [guide](multimodal-experience.md) documents the actual thresholds.

Actual fixed-geometry render fixtures measured:

| Fixture | Measured pixel evidence | Result |
| --- | --- | --- |
| Visible | RGB contrast 91/255 | HIGH |
| Dim, illumination 0.04 | Contrast 7/255 | LOW, retained |
| Black | Contrast 0 | LOW, retained |
| Same wall material | Interior/ring luminance 141/141, RGB contrast 0 | LOW, retained |
| Tiny / partial / hidden / out-of-view | Pixel support and geometric eligibility | Tiny LOW; partial retained; hidden/out-of-view absent |

A focused review found a low-signal loophole: luminance 40/4 gave absolute contrast 36 and relative contrast 0.9 but could be HIGH. The fix requires measured median display signal ≥48/255 for HIGH; weaker signal stays LOW with `low_rgb_signal`. This cap is an engineering heuristic, not physiology or a day/night system. The fix passed **24 affected pixel/core checks**, **2/2 actual pixel checks** and **1/1 delayed-capture check**, plus TypeScript/lint and clean targeted re-review.

| Check | Actual result / evidence |
| --- | --- |
| Full offline suite | **248/248 PASS**, `diagnostics/pixel-confidence-tests.log` |
| Lint / build including TypeScript | **PASS**, `pixel-confidence-lint.log` / `pixel-confidence-build.log` |
| Actual attention | **2/2 PASS**, `pixel-confidence-vision-attention.log` |
| Paired renderer mask | **2/2**, D3D11 and SwiftShader; clean independent Astra review |
| Actual pixel + FAKE transport integration | **2/2**, normal handle `inspect` → isolated LIVE encoding → fresh capture; zero external calls, `pixel-confidence-actual-tests.log` |
| Existing paid artifacts | Six ZIPs exact offline canonical **PASS**; no new paid calls |
| Renderer verification after correction | Initial **7/8**: one outdated test expected grounding without pixel metadata, not cleanup/runtime failure. Corrected affected test **1/1 PASS** with admitted RGB/mask/camera/complete-qualification proof; no full clean 8/8 rerun claimed |
| Low-signal review correction | 24 affected checks, actual pixel **2/2**, delayed **1/1**, TypeScript/lint and targeted review clean; `pixel-confidence-review-fix-unit.log`, `pixel-confidence-actual-review-fix.log`, `pixel-confidence-delayed-capture-review-fix.log` |
| Latest hosted review | **PASS**, source `9fc8dbb`: no findings or unresolved findings; later `fe5e04c` documentation-only, not claimed as reviewed source |

Paths without a prefix in this table are under `diagnostics/`. Missing/corrupt paired evidence produces zero handles and an explicit operational failure, rather than falling back to geometry-only confidence. The private mask never becomes model evidence. Controlled fixtures demonstrate this bounded heuristic, not broad perceptual accuracy.

Cleanup diagnosis passed **13/13** focused checks (actual Windows query **469 ms**) and an exclusive pre-change `vision:verify` run **8/8** in **21.01 s** (`diagnostics/newgoalteardown-real.log`). It changed no source, ownership logic or timeout. The historical timeout was 750 ms versus the existing current 1,250 ms; this task did not inflate it. The reported cleanup flake was not reproduced; Windows query/host-load latency remains a candidate, not a confirmed cause or repaired defect.

## Previous paid-profile acceptance (historical)

Previous paid acceptance passed: six main OpenRouter responses cover five 512×512 experiment fixtures and a genuine temporary LIVE admission that survives a cognition-disabled restart. One actual matched Decisions comparison ran separately; one case is insufficient to adopt it, and normal LIVE Decisions remains disabled. All six corrected diagnostic bundles are COMPLETE and replay offline. Earlier offline checks passed **231 tests**, lint/build and **2/2** actual Chromium attention checks. [Draft PR #8](https://github.com/PHead2001/Autonomous-Lumi/pull/8) remains open and unmerged. Final targeted hosted Codex review of `ac08c9c` completed clean with no findings and no unresolved findings. That review and acceptance apply to the previous profile; the current correction has separate checks above and clean hosted review of source `9fc8dbb`. Merging remains the owner's action.

See [Multimodal interpretation and experience](multimodal-experience.md) for configuration, budgets, admission, replay/recovery and exact opt-in commands.

## Offline checks and review

| Check | Actual result | Local output |
| --- | --- | --- |
| `npm test` | **231/231** offline tests passed | `diagnostics/phase2c-tests.log` |
| `npm run lint` | **PASS** | `diagnostics/phase2c-lint.log` |
| `npm run build` | **PASS**, including TypeScript; Vite chunk-size advisory remains | `diagnostics/phase2c-build.log` |
| `npm run vision:attention` | **2/2** actual Chromium checks passed | `diagnostics/phase2c-vision-attention.log` |
| Dashboard helpers | **22/22**, including four new cognition behavior tests | Scoped development check |

The actual attention/image check measured decoded RGB difference approximately **0.0133** for visible material change; the observed automatic frame was captured at tick **1** and received at tick **115**. This is actual rendering and scheduling evidence, not a provider interpretation result.

Independent Astra review/fix/re-review accepted the queued-result delivery and selected 256→512 visual follow-up boundaries. A model-head action that incorrectly granted developer priority was fixed and passed **37 affected tests**, with clean targeted re-review. A subsequent provider world-scope fix passed **13 focused tests** and scoped lint. The CLI acceptance correction passed **9 host/verification tests**, TypeScript and lint, with clean targeted re-review. The latest restart/configured-world-cadence correction passed **8/8 host tests**, lint and TypeScript, with clean targeted re-review. The earlier full-suite result and these later affected checks are distinct evidence, rather than a claimed fresh full-suite rerun.

## Hosted review corrections

The hosted P2 cost-overage finding was fixed and pushed in `808a870`; its thread is resolved. **16 provider tests**, lint and TypeScript passed, and independent boundary re-review is clean. Reported actual overage remains accounted rather than being hidden by an admission reservation; the application ceiling is not a provider-enforced billing cap.

The hosted P1 checkpoint-capacity fix passed **76 affected tests**, owned ESLint and build including TypeScript, with **clean independent Astra review**. Both initial hosted findings are resolved. Targeted hosted Codex re-review of `da6b1b2` completed with no findings and no unresolved findings; independent Astra re-reviews are also clean. The old compact-size guard admitted a counterexample of **1,390,041 compact bytes** whose actual stored envelope was **2,145,509 bytes**, above the **2,097,152-byte** limit. The replacement measures the actual pretty-printed recovery/named envelopes and reserves future activity, synthetic, motor/sensor and terminal-delivery growth. Supplied corrected fixtures measured **1,743,094 actual recovery bytes** for 221 real experiences with a **2,042,291-byte derived budget**, and **1,972,720 named-checkpoint bytes** after LIVE→EXPERIMENT fork with 256 synthetic records and 10,000 activity milestones. Maximum escaped terminal-result and ordered-delivery fixtures measured **23,886 / 12,002 bytes**, below their individual **32 KiB** allowances; combined growth was **35,888 bytes**, below **64 KiB**. These are focused capacity fixtures and affected checks, not a fresh full-suite result.

The later sanitizer correction passed **3 affected tests**, lint and TypeScript, with clean independent re-review. The provider JSON-mode/prompt correction passed **16 provider tests**, lint and TypeScript, with clean focused review. Final hosted re-review of `ac08c9c` includes these corrections and completed clean with no findings or unresolved findings.

## Earlier actual renderer plus explicitly MOCK interpretation

```powershell
npm run build
npm.cmd run cognition:verify -- --mock --serve 180 --out diagnostics/phase2c-mock
```

This command uses real 512×512 images and explicitly labelled mock responses in isolated experiments. The companion reports **MOCK TEST PROVIDER**; it cannot dispatch its mock provider into LIVE. It verifies deterministic assembly, local validation/admission, failure handling, UI and export paths without paid calls. Use the printed loopback URL; type `stop` in the companion process to end serving early. A separate mock refusal branch exercises failed interpretation.

The accepted Chrome walkthrough selected experiment **mock-observation**, inspected **MOCK TEST PROVIDER**, the exact associated frame and a short mock interpretation. The frame hash was:

```text
7250775e212228874d7abcc06826a8e4172cf5cd0e33dab3256ec45df9b397d5
```

Its capture tick was **6**, attention tick **26**, request tick **27**, and encoding tick **28**. The normalized `continue` action was executed locally, independently of successful experiment encoding. “Executed” means the local action started/continued or an intention was queued; it does not prove a completed physical outcome. The request's original capture is shown rather than whichever image became latest.

The browser used the normal **Export diagnostic ZIP** control and received a COMPLETE result. This walkthrough does not establish an actual provider response or positive LIVE encoding.

The unchanged room viewer showed an upright fox girl with visible ears, tail, arms and hands. An idle “Taking a breath” state at **3:06** transitioned to wandering with changed position at **3:13**. The normal slam button enabled audio, but playback was not independently heard and transient door/ear motion was not captured reliably; no new rendered proof of those transients is claimed. Normal disconnect at **3:14** followed by reconnect returned to the same advancing world at **3:47**, with wandering continuing and no reset. The shortest remaining audio/transient check is to press **Slam the door**, listen for the impact and watch the door and ears.

## Actual dashboard bundle and exact offline replay

The exported file is:

```text
diagnostics/phase2c-mock-20261029c/mock-data/lumi/mock-observation/exports/incident-7814744a-702c-4d5a-b4ac-0e79e57b14ea.zip
```

Inspection found **13 entries**, COMPLETE coverage, **64 records**, **6 ordered inputs**, **28 deterministic events**, tick **29**, no evidence gaps and no dropped records. No credential markers or raw image payloads were present. The included assertions confirm matching final state/events, deterministic records and runtime controls. It remains explicitly **EXPERIMENT/MOCK** evidence.

```powershell
npm.cmd run replay -- --bundle diagnostics/phase2c-mock-20261029c/mock-data/lumi/mock-observation/exports/incident-7814744a-702c-4d5a-b4ac-0e79e57b14ea.zip
```

The actual CLI replay **PASS** matched canonical state/events/runtime without provider or renderer calls:

| Evidence | Hash |
| --- | --- |
| State | `859dba0388ba2ce8937aefe45d8fb60af166abfc6322a39942d71b4c44e60d83` |
| Events | `685385ff62bafc09a475523e075f4d22549c5cc500da54abcec37f34ad883f1c` |
| Runtime | `6e17f8a26a52d4a0ce6e4ab526714e4639b1c380cf7aa8d5dfd1fad13d3f9a52` |

Generated bundles, images, logs and reports are local ignored artifacts. They do not imply paid-provider acceptance.

## Previous geometry-assisted paid acceptance (historical)

Source reports are `diagnostics/phase2c-paid-json-20261029/{verification.json,acceptance-summary.json,http-evidence.json}`. The corrected run made **six main calls and one Decisions call**, all HTTP 200, without automated retries. Including the original strict-schema HTTP 404, the aggregate is **seven main calls and one Decisions call**. The initial unavailable preflight and failed first route attempt remain historical evidence in `diagnostics/phase2c-paid-preflight-20261029` and `diagnostics/phase2c-paid-20261029`; they were not erased or counted as successful interpretations.

The same `qwen/qwen3.7-flash` route now uses `response_format: json_object`, the bounded explicit `lumi-vision-prompt-v2` contract and independent strict local validation. The [official model FAQ](https://openrouter.ai/qwen/qwen3.7-flash) distinguishes JSON output from unsupported native JSON-schema enforcement on this route; JSON syntax support is not a promise of contract correctness. Provider revision metadata was unavailable. The qualitative responses describe visible shapes/partial occlusion, report darkness or missing detail, and remain fallible rather than calibrated recognition evidence. All six inputs were actual **512×512** images, with zero forbidden input fields found by the context inspection.

| Case | Provider latency (s) | Ordered request→result wall time (s) | Model uncertainty | Local action result | Bundle / offline replay |
| --- | ---: | ---: | ---: | --- | --- |
| visible | 14.460 | 14.525 | 0.65 | continued | COMPLETE / PASS |
| partial | 11.263 | 11.300 | 0.2 | continued | COMPLETE / PASS |
| dark | 6.871 | 14.655 | 1 | capture_requested | COMPLETE / PASS |
| absent | 9.347 | 11.116 | 0.8 | capture_requested | COMPLETE / PASS |
| hidden | 12.933 | 13.029 | 1 | capture_requested | COMPLETE / PASS |
| temporary-live | 12.080 | 12.122 | 0.85 | look_started | COMPLETE / PASS |

These provider latencies include adapter scheduling/queueing; the separate HTTP measurements in `http-evidence.json` are shorter transport intervals. End-to-end wall time additionally includes ordered delivery and fixture scheduling. Neither metric establishes a long-run throughput distribution. “Look started” or “capture requested” means an action began or was queued, not that its physical outcome completed.

The genuine **temporary LIVE** chain admitted real experience **1** at tick **412**, with `look_started`. Restarting that isolated history with cognition disabled retained **one** real experience in the **same history**. The harness used disposable temporary data; owner LIVE history was not used for these fixtures. The sanitized bundle is `diagnostics/phase2c-paid-json-20261029/temporary-live.zip`; it is COMPLETE and replays at tick 412 with **9 inputs / 61 events**:

Independent inspection of this actual ZIP found **37,311 bytes**, **13 entries** and **106 records**, with zero evidence gaps or drops. Its nine normalized commands preserve the sound → sensor/attention → request/result → local `look_started` validation → LIVE `actual_renderer` `EXPERIENCE_ENCODED` chain under the same correlated identity. Two quota-rejected feedback inputs remain useful failure evidence before the later successful capture. Privacy inspection found no credentials, raw image payloads, full prompts or private evaluation data. Inspection confirmed the script/checkpoint identity results report `survived: true`, `retainedCount: 1` and `sameHistory: true`; the independent artifact check did not rerun that restart.

The documented `npm.cmd` replay command was independently run and **passed**, matching the state/event/runtime hashes below at tick 412, with **9 inputs / 61 events**. Output: `diagnostics/phase2c-paid-live-replay.log`. This is artifact inspection and deterministic replay evidence, not a source-provenance certification.

| Canonical evidence | Hash |
| --- | --- |
| State | `af32a2290f95f5a895b1026e3dc09ea1a23c81fb6b33d7fb56174f021a59bd3d` |
| Events | `dc8ace4f111eee10d5cce3ac9ffd1763dd8dea1e21a93f0faef0a485a78ea659` |
| Runtime | `1c31aa7849c04e59bdfcc55a734c2407fc7923693df8dd009caf04ad3c2a4dc8` |

```powershell
# Offline: makes no provider or renderer calls.
npm.cmd run replay -- --bundle diagnostics/phase2c-paid-json-20261029/temporary-live.zip
```

The six main responses reported **4,931 input / 3,335 output tokens** and **US$0.00058148**. The actual matched partial-view Decisions call used **475 input tokens**, **819.44 ms** adapter latency and estimated **US$0.000130625**. Its confidence was **0.28**; the normalized local fallback was `continue`, and encoding was rejected as `decision_not_experience`. This one matched case does not justify adoption or imply calibrated confidence; normal LIVE Decisions remains disabled.

The durable ledger accounts **US$0.100942505**, with **pending 0 / unknown 1**. This includes **US$0.1002304** retained conservatively for the original failed strict-schema request, not merely the smaller reported successful-call cost. No reservation was refunded by resetting the ledger.

For another explicitly paid run, use a fresh output directory and the local main flag/key. The user's ignored `.env` now persistently enables main cognition; new-install `.env.example` still defaults both flags OFF. Saved Decisions configuration remains false. `--decisions` selects the comparison but does not enable its independent configuration; use a process-only override and restore it afterwards:

```powershell
npm.cmd run cognition:verify -- --paid --out diagnostics/phase2c-paid-repeat

$phase2cPreviousDecisions = $env:LUMI_DECISIONS_ENABLED
try {
  $env:LUMI_DECISIONS_ENABLED = 'true'
  npm.cmd run cognition:verify -- --paid --decisions --out diagnostics/phase2c-paid-decisions-repeat
} finally {
  if ($null -eq $phase2cPreviousDecisions) { Remove-Item Env:LUMI_DECISIONS_ENABLED -ErrorAction SilentlyContinue }
  else { $env:LUMI_DECISIONS_ENABLED = $phase2cPreviousDecisions }
}
```

The optional command also needs the independent local `OPENAI_API_KEY`. Both commands consume the existing shared budget; they are reproduction instructions, not a request to repeat acceptance calls.

| Acceptance | Status |
| --- | --- |
| `2c-1` actual OpenRouter visible/partial/dark/absent/hidden cases | **PASS**, five actual 512×512 fixtures; interpretation quality remains fallible |
| `2c-2` local action/outage boundary | Offline/mock and affected provider/host/CLI checks passed; independent targeted reviews clean |
| `2c-3` inspected bundle and exact offline replay | **PASS**, six corrected actual-provider bundles COMPLETE / replay PASS; earlier dashboard MOCK export retained separately |
| `2c-4` genuine temporary LIVE admission/restart | **PASS**, experience 1 retained with cognition disabled, same temporary history |
| Optional Decisions comparison | One actual matched case evaluated; **insufficient evidence to adopt**, normal LIVE disabled |
| Original viewer browser regression | Upright avatar, walking/idle and advancing-world reconnect observed; audio unverified and no reliable new door/ear transient capture |
| Final review | Initial capacity/cost findings fixed and resolved with clean independent and prior hosted reviews; subsequent JSON-mode/sanitizer focused reviews clean. **PASS:** final hosted review of `ac08c9c` clean, no findings or unresolved findings. Draft PR #8 open/unmerged; owner merge |

## Material limits

The prototype retains at most **256 request records** and **512 real experiences**, subject to the exact **2 MiB (2,097,152-byte)** pretty-printed checkpoint-file limit. Admission measures recovery and named-checkpoint envelopes and reserves future 10,000-milestone activity growth, all 256 synthetic records in both modes, motor/sensor growth and pending terminal-result/delivery growth. Capacity can reject new work before the record-count limits; it fails explicitly without silently trimming/resetting history. The synthetic records remain separate from real experience. Existing recovery timing applies, so logical encoding is not an immediate per-record durable commit. Spending reservations live outside branch checkpoints and survive restore/restart; unknown usage is not treated as free. Real experiences remain fallible interpretations with source/attention provenance, and proposed actions are distinct from actual effects. Phase 2.5 physiology and Phase 3 learning remain outside scope.
