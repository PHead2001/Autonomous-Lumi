# Phase 2c verification results

Offline implementation and an actual-renderer **MOCK provider** workflow have been verified. The latest supplied full offline run passed **231 tests**, lint and build; real Chromium attention checks passed **2/2**. Chrome inspected the normal dashboard and exported a COMPLETE replayable experiment bundle. **Actual OpenRouter image capability, positive provider-backed temporary LIVE admission/restart and the optional Decisions comparison remain unverified.** Mock evidence does not satisfy those acceptance requirements. [Draft PR #8](https://github.com/PHead2001/Autonomous-Lumi/pull/8) is open and unmerged with these paid-acceptance gaps explicit; no hosted review is claimed.

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

## Actual renderer plus explicitly MOCK interpretation

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

## Paid preflight and remaining acceptance gaps

The actual paid preflight reported **unavailable**, `actualProviderAcceptance: false`, a US$1 ceiling and **zero paid calls**, before renderer/provider execution. Report: `diagnostics/phase2c-paid-preflight-20261029/verification.json`. Its message requires main enablement and `OPENROUTER_API_KEY` to be configured locally; credentials alone do not enable calls.

With the local main flag/key configured, the remaining explicit check is:

```powershell
npm.cmd run cognition:verify -- --paid --out diagnostics/phase2c-paid

# Only with the independent OpenAI flag/key configured:
npm.cmd run cognition:verify -- --paid --decisions --out diagnostics/phase2c-paid-decisions
```

The harness bounds paid work to at most six main calls covering five image cases plus the temporary LIVE path, and one optional Decisions call, subject to the same durable application-wide US$1 budget. Use a fresh output directory. No sample count, latency, usage, model capability or adoption benefit is fabricated when a call did not occur.

| Acceptance | Status |
| --- | --- |
| `2c-1` actual OpenRouter 512×512 visible/partial/dark/absent/hidden cases | **UNVERIFIED**, credential-dependent |
| `2c-2` local action/outage boundary | Offline/mock and affected provider/host/CLI checks passed; targeted CLI and restart/cadence re-reviews clean |
| `2c-3` inspected bundle and exact offline replay | **PASS for actual-renderer/MOCK experiment**; real-provider sequence not yet exercised |
| `2c-4` actual provider-backed temporary LIVE admission/restart | **UNVERIFIED**; mock experiment encoding is not a substitute |
| Optional Decisions comparison | **UNVERIFIED**; no benefit/adoption conclusion, normal LIVE use remains disabled |
| Original viewer browser regression | Upright avatar, walking/idle and advancing-world reconnect observed; audio unverified and no reliable new door/ear transient capture |
| Final independent/hosted review | Core/CLI and restart/cadence targeted re-reviews clean. Draft PR #8 open/unmerged; hosted review not yet claimed |

## Material limits

The prototype retains at most **256 request records** and **512 real experiences**, subject to explicit 1.4/1.5 MB checkpoint-size guards; capacity failure is visible and does not silently trim/reset history. The inherited synthetic limit stays separate. Existing recovery timing applies, so logical encoding is not an immediate per-record durable commit. Spending reservations live outside branch checkpoints and survive restore/restart; unknown usage is not treated as free. Real experiences remain fallible interpretations with source/attention provenance, and proposed actions are distinct from actual effects. Phase 2.5 physiology and Phase 3 learning remain outside scope.
