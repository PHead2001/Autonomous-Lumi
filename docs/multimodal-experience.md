# Multimodal interpretation and real experience

Geometry shape hints are intended assistive evidence (§§6.4/6.8). The current pixel-confidence path retains eligible handles/`inspect`, measures actual paired RGB/private object-mask evidence, and marks weak but positive evidence LOW/uncertain. `rgb-mask-contrast-v2` omits candidates with no raster pixels or zero local RGB support, while retaining positive low-contrast/same-wall evidence as LOW. It does not perform semantic recognition or perfect figure-ground detection. Hidden/out-of-view geometry remains ineligible. The prompt-v4/wire-v2 repair passed 263 offline tests, actual renderer checks and six actual main provider cases; new-patch hosted source review and independent artifact inspection passed. See results for the bounded sample and limitations.

Phase 2c connects explicitly selected actual first-person observations to a replaceable interpretation adapter. Proposals pass local validation and ordered execution. Eligible interpretations may be encoded as fallible real experiences with trusted sensor/attention provenance. The world, immediate reflexes and local attention continue independently of provider latency, failure and budget exhaustion.

## Local configuration

Node.js 22 and the existing isolated Chromium setup are required. Preserve an existing `.env`; for a new setup only, copy `.env.example` to `.env`. Credentials remain server-side and must never use `VITE_` names.

```dotenv
OPENROUTER_API_KEY=your-local-key
LUMI_COGNITION_ENABLED=true
LUMI_COGNITION_MODEL=qwen/qwen3.7-flash
LUMI_COGNITION_BUDGET_USD=1
LUMI_DECISIONS_ENABLED=false
```

Edit the key locally. The ordinary inference credential is sufficient; no admin key is requested. `.env` is ignored by Git. The common loader reads the repository `.env`, then applies process-environment overrides for development, normal startup and explicit integration commands. A key alone enables nothing. Missing credentials or disabled cognition preserve local behavior. New-install `.env.example` defaults main and Decisions OFF. The owner's current ignored `.env` explicitly enables main cognition persistently; Decisions remains saved OFF.

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5173/?view=dashboard`, or build with `npm run build` and use `npm start` on port 3001. Enablement is server configuration; the dashboard has no runtime enable/spend button.

OpenRouter is the default main route at `https://openrouter.ai/api/v1`, using `qwen/qwen3.7-flash`. It receives actual private 512×512 PNG data plus allowlisted context, with bounded JSON output. This route uses `json_object`, the bounded `lumi-vision-prompt-v4` / `lumi-interpretation-v2` contract and strict local validation; it does not support native remote JSON-schema enforcement ([official model FAQ](https://openrouter.ai/qwen/qwen3.7-flash)). JSON output alone does not guarantee a valid proposal. The model remains configurable. Changing it requires an explicit documented full-route context limit; the adapter does not silently fall back to another model. Actual capability/results are reported separately in [Phase 2c results](phase-2c-results.md), never inferred from mocks.

OpenAI Decisions uses its separate `OPENAI_API_KEY`, `LUMI_DECISIONS_ENABLED` flag, `gpt-6-luna` model and `https://api.openai.com/v1/decisions` typed question interface. It does not use the OpenRouter credential or a relabelled chat request. It is restricted to explicit isolated comparisons, remains disabled for normal LIVE use and is not a dependency of the main interpretation path.

## Bounds and accounting

| Default | Limit |
| --- | --- |
| Main/Decisions flags | OFF independently |
| Application budget ceiling | US$1, shared across worlds/runs/providers |
| Concurrent / queued provider work | 1 / 1 |
| Output / overall deadline | 768 tokens / 15 host seconds |
| Retries | 0 |
| Host / world request interval | 10 host seconds / 10 world seconds |
| Request / response bytes | 2,000,000 / 32,768 |
| Filtered context / actual PNG bytes | 24,576 / 1,000,000 |
| Logical pending / total request records | 4 / 256 |
| Real experience records / context window | 512 / most recent 8 eligible records |

The `.env.example` documents adjustable limits. A budget above US$1 requires the owner's explicit `LUMI_COGNITION_ALLOW_HIGHER_BUDGET=true`; configuration can lower it. Admission reserves conservative cost before dispatch, including outstanding requests. Usage records distinguish provider-reported, estimated and unknown amounts. Timeout/cancellation does not mean free: unknown or abandoned work retains its reservation. Cost estimates are admission controls, not a provider-enforced billing cap.

The ledger is application-wide and separate from world/branch checkpoints. Its default Windows directory is `%LOCALAPPDATA%/AutonomousLumi/cognition-budget`; `LUMI_COGNITION_BUDGET_DIRECTORY` selects another deliberate persistent location. Keep it across restart/restore. A corrupt/unavailable ledger fails closed; restarting or restoring a branch does not refund consumed or unknown usage. Never delete/reset it merely to evade a limit.

Finite history is deliberate: at most 256 request records and 512 real experiences are retained, and new work can be rejected before those counts when its storage budget would exceed the exact **2 MiB (2,097,152 bytes)** checkpoint-file limit. Admission measures the actual pretty-printed JSON recovery and named-checkpoint envelopes, including their runtime controls and wrapper metadata, rather than compact simulation JSON. It reserves future activity growth through 10,000 milestones, all 256 synthetic records in both LIVE and EXPERIMENT (LIVE may later fork), motor/sensor state growth and pending terminal-result/delivery growth. A queued result replaces its reserved delivery allowance with measured bytes rather than being counted twice. Request admission and encoding fail explicitly when capacity is unavailable; completed history is never silently trimmed or reset to make room. This is a bounded prototype, not an unbounded personal-history database.

## What is sent and what can happen

The coordinator binds a specific retained image, hash, capture tick and actual attention association before queuing. It copies bounded image bytes rather than fetching whichever image is latest when the provider runs. Eviction/expiry is an explicit unavailable outcome. Routine 256×256 visual probes remain cheap; selected interpretation uses 512×512, including a bounded richer follow-up for a selected probe when required.

The provider receives the actual image plus filtered observation-scoped shape hints, received-only sound, activity status and bounded eligible prior interpretations. Shape hints retain coarse bearing/distance and opaque handles; they are geometry-assisted candidates, not recognized objects. Current shapes carry `uncertainty: geometry_candidates_pixel_checked` and bounded `qualityFlags` explaining weak support. Private geometry/engine identities, source coordinates, masks, measured private IDs and evaluation labels are not sent.

The renderer (`three-room-pixel-evidence-v2`) provides a paired private object mask for the original RGB/camera snapshot. `rgb-mask-contrast-v2` measures per-channel median interior-versus-ring RGB contrast in the final 8-bit display image: one-pixel erosion defines the interior and a three-pixel exterior ring supplies comparison pixels. Relative contrast is maximum channel difference divided by `max(16, interior luminance, ring luminance)`; corrected contrast subtracts 0.75 times robust RGB spread. The mask is private measurement machinery, not perfect visual recognition. Missing, malformed or mismatched paired evidence yields zero handles and `paired_pixel_evidence_unavailable_or_invalid`; the RGB frame can remain usable.

| Confidence check | Current threshold |
| --- | --- |
| Basic support | 32 visible / 16 interior / 24 ring pixels; interior fraction ≥0.1 and ring/boundary ratio ≥0.5 |
| Basic RGB contrast | absolute ≥14/255, relative ≥0.12, spread-corrected ≥8/255 |
| HIGH support | 128 visible / 64 interior / 64 ring pixels |
| HIGH contrast | absolute ≥28/255, relative ≥0.22, corrected ≥18/255 |
| HIGH measured display signal | maximum interior/ring median luminance ≥48/255 |

These thresholds lower confidence for weak positive evidence. Candidates with `no_pixel_support` (no mask raster pixels) or `no_rgb_support` (all-zero local RGB support) are omitted rather than exposing geometry-only existence. Weak, tiny, dim, same-colour or cluttered candidates with positive evidence remain LOW with flags such as `limited_pixel_resolution`, `low_rgb_signal`, `low_pixel_contrast` or `clutter_limited_pixel_contrast`. Measured signal below 6/255 is weak positive evidence when any local RGB support remains; it is not automatically absence. No world-light cutoff is substituted for pixels. Geometrically hidden and out-of-view candidates remain excluded. The 48/255 HIGH cap is an engineering display-signal threshold, not physiology or a Phase 2.5 day/night system.

The normalized proposal separates interpretation/uncertainty, evidence references and one permitted action:

- `continue`: continue the existing activity.
- `look`: orient toward a locally validated coarse bearing/elevation.
- `inspect`: orient toward an eligible observation-scoped handle and request fresh sensor evidence through the normal pipeline. LOW hints remain inspectable; intent is locally validated and is not an already completed observation.
- `request_observation`: request another bounded observation when evidence is insufficient.

Local validation checks identity, association, age, captured pose, motion limits, permissions, cooldowns and action preconditions. Complete normalized results enter the established ordered input path; callbacks/partial output do not move the head or append experience. Own rotation may re-express an observed bearing; hidden source movement does not retarget it. A stale/foreign/duplicate/unsupported proposal fails explicitly without blocking world/reflex progress.

**Executed means the local action started or a capture intention was queued. It does not prove physical completion or the intended observed outcome.** The dashboard displays proposed action, local outcome and encoding independently. An otherwise eligible interpretation may survive a rejected action; an unexecuted proposal is never remembered as a completed event.

## Admission, recovery and replay

Real experience follows server-owned proof: actual sensory result → explicit attention selection → correlated interpretation → successful encoding. Provenance includes world/history/branch/run ancestry, observation/frame references, original capture/attention/interpretation/encoding timing, uncertainty and idempotent encoding identity. The model cannot assert itself real, LIVE, sensed, attended or encoded.

Admissible mistaken interpretations remain fallible perceptions rather than being corrected from private truth. Fabricated references, debug-only captures, ignored cues, failed encoding, Decisions comparison outputs and TEST STUB ancestry cannot manufacture LIVE autobiography. Experiment-produced experiences cannot be promoted into LIVE. Personal experience is separate from developer diagnostics and does not depend on optional diagnostic logging being enabled.

Schema 5 / `lumi-cognition-v1` checkpoints logical requests, result associations, deduplication/cooldowns, normalized outcomes and admitted records. Credentials, provider clients, promises and raw images are excluded. Active migration preserves LIVE history/tick, attention and motor/activity progress. Interrupted requests reconcile without waiting for dead callbacks or automatically resending a paid batch. Disabling cognition does not invalidate existing admitted records. Historical schema-5 requests must retain their exact prior offline replay/hash semantics and stored history. Current provider diagnostics label the profile `pixel_checked_v4`; prompt revision is `lumi-vision-prompt-v4` and wire output schema is `lumi-interpretation-v2`. Handle-based actions remain. The model returns only interpretation, uncertainty, evidence handles and action; it is not asked to copy observation identifiers or frame hashes. The server binds immutable request identifiers after strict remote parsing, then independently checks references and local action/encoding rules. The prompt asks for plain first-person perception, not developer descriptions of geometry candidates. Pixel-qualified v3 memories remain verbatim stored history and eligible context; older geometry-only history retains prior offline semantics. Historical geometry-only shape records keep `geometric_samples_only` and their original field/replay semantics; current shapes require bounded quality flags. Older paid evidence remains historical rather than proof of current pixel calibration.

Experiences follow the existing recovery guarantee: graceful shutdown saves final state; abrupt termination can lose changes since the last successful recovery checkpoint, normally 30 real seconds. Logical encoding is not an immediate per-experience disk transaction. Capacity/save failures stay visible. The provider spending ledger has its own durable reservations and is not rolled back with a world checkpoint.

Offline replay injects recorded model outcomes at their original receipt ticks/order. It reproduces local validation/actions/encoding with zero provider and renderer calls. Sanitized exports retain the normalized content needed for exact hashes; if redaction/evidence loss prevents replay, they must say INCOMPLETE. Default exports exclude credentials, raw image payloads and sensitive full prompts.

```powershell
npm.cmd run replay -- --bundle 'C:\path\to\the-actual-incident.zip'
```

## Bounded rejection diagnostics and harness completion

Malformed results may carry an optional bounded `validationError`: `invalid_json`, `schema`, `unsupported_action`, `frame_hash_mismatch`, `observation_mismatch`, `unknown_handle`, `provider_envelope`, `incomplete_output` or `model_mismatch`. The API, ordered diagnostics and bundles retain the category, never raw rejected reply content. Historical results without this optional field retain exact replay behavior.

The harness attempts all six cases after a case failure while retaining an overall failure unless strict acceptance succeeds. It always attempts the LIVE recovery check. Case-local immutable identity/generation/deadline, abortable pacing and a final synchronous dispatch guard prevent delayed work from spilling into another case; pacing beyond the 60-second case budget times out without a late call. Verification includes a case-failure path and prevents false acceptance. The six-call actual v4 run passed without retries; old paid-v2 evidence remains historical.

## Dashboard walkthrough

Select the current world/branch/run. **Interpretation & experience** reports enabled/disabled/unavailable state, application-wide budget and provider queue, main versus Decisions status, and bounded request history. Select a request to inspect its exact associated frame, original tick/hash, allowlisted context, interpretation/uncertainty, proposed versus started/queued action, encoding reason and measured usage/cost basis. An evicted frame stays unavailable; no latest-image substitute is shown. Successfully admitted real experiences appear separately from private source truth, diagnostics and the TEST STUB harness.

`world_seconds_per_model_response` is world seconds from the first included main interpretation request to the latest successful main response, divided by successful main responses. It is N/A without a successful main response. Decisions evaluation samples and latency/cost remain separate; confidence/uncertainty is a model estimate, not calibrated accuracy or a hidden monologue.

## Explicit integration checks

Normal `npm test` is offline and must not spend money. The explicit harness is registered as `cognition:verify`:

```powershell
# Explicit paid opt-in; requires enabled main cognition and its local key.
npm.cmd run cognition:verify -- --paid --out diagnostics/cognition-checks/my-paid-check

# Optional comparison: --decisions does not itself enable configuration.
# Requires independent OPENAI_API_KEY; restore the process-only flag afterwards.
$phase2cPreviousDecisions = $env:LUMI_DECISIONS_ENABLED
try {
  $env:LUMI_DECISIONS_ENABLED = 'true'
  npm.cmd run cognition:verify -- --paid --decisions --out diagnostics/cognition-checks/my-paid-decisions-check
} finally {
  if ($null -eq $phase2cPreviousDecisions) { Remove-Item Env:LUMI_DECISIONS_ENABLED -ErrorAction SilentlyContinue }
  else { $env:LUMI_DECISIONS_ENABLED = $phase2cPreviousDecisions }
}

# Actual renderer + explicitly MOCK provider; no paid provider acceptance claim.
npm run build
npm.cmd run cognition:verify -- --mock --serve 180 --out diagnostics/cognition-checks/my-mock-check
```

Use a fresh output directory. The default is a timestamped directory under `diagnostics/cognition-checks/`. Choose exactly one of `--paid` or `--mock`. `--serve` accepts 1–600 seconds and is available only for the mock dashboard companion; use the printed loopback URL and select its experiment, then export normally. The paid harness bounds itself to at most six main interpretation calls and, with `--decisions`, one optional Decisions call, all subject to the shared budget/admission limits. Missing main enablement/key reports unavailable before paid requests or rendering. Configured keys alone do not launch evaluation. Actual command results and any credential-dependent gaps remain explicit in [Phase 2c results](phase-2c-results.md).

The previous prompt-v2 paid acceptance run covered 512×512 visible/partial/dark/absent/hidden images and the genuine temporary LIVE admission/restart path; its six bundles remain historical geometry-assisted evidence. It does not establish new paid acceptance of the pixel-calibrated confidence profile. The final repair run passed **263/263**, lint/build and renderer checks. A new six-main-call v4 paid run passed with all six bundles COMPLETE/offline replay PASS, including an actual black image with no hints and a temporary LIVE perception retained through disabled-cognition restart despite its proposed look being rejected. All six old paid ZIPs still replay exactly. Hosted source review of `dfcf49c` is clean with no findings or unresolved findings, and independent inspection/replay of the new artifacts passed. One previous actual matched Decisions sample was insufficient to adopt it. See the results for latency, cost, retained failed-request accounting and limitations. Future paid acceptance must use actual images and the genuine temporary LIVE path. A mock companion can demonstrate deterministic integration and UI but cannot prove provider image capability or real paid LIVE acceptance. Decisions requires a small matched ambiguous-case comparison; no measurable benefit is an acceptable outcome and does not enable normal LIVE use automatically. This correction adds no Phase 2.5 day/night system. Stop before Phase 2.5 or Phase 3.
