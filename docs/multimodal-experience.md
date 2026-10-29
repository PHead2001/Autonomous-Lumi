# Multimodal interpretation and real experience

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

Edit the key locally. The ordinary inference credential is sufficient; no admin key is requested. `.env` is ignored by Git. The common loader reads the repository `.env`, then applies process-environment overrides for development, normal startup and explicit integration commands. A key alone enables nothing. Missing credentials or disabled cognition preserve local behavior.

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5173/?view=dashboard`, or build with `npm run build` and use `npm start` on port 3001. Enablement is server configuration; the dashboard has no runtime enable/spend button.

OpenRouter is the default main route at `https://openrouter.ai/api/v1`, using `qwen/qwen3.7-flash`. It receives actual private 512×512 PNG data plus allowlisted context, with bounded JSON output. The model remains configurable. Changing it requires an explicit documented full-route context limit; the adapter does not silently fall back to another model. Actual capability/results are reported separately in [Phase 2c results](phase-2c-results.md), never inferred from mocks.

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

Finite history is deliberate: the 256 request-record or 512 real-experience limit, whichever applies first, rejects further admission explicitly. Requests exceeding approximately 1.4 MB checkpoint size are rejected; encoding beyond approximately 1.5 MB fails visibly. Records are not silently trimmed or reported encoded after being dropped. The inherited synthetic 256-entry experiment harness remains separate. This is a bounded prototype, not an unbounded personal-history database.

## What is sent and what can happen

The coordinator binds a specific retained image, hash, capture tick and actual attention association before queuing. It copies bounded image bytes rather than fetching whichever image is latest when the provider runs. Eviction/expiry is an explicit unavailable outcome. Routine 256×256 visual probes remain cheap; selected interpretation uses 512×512, including a bounded richer follow-up for a selected probe when required.

Provider context contains filtered unknown shapes/handles and coarse bearings, related received sound with relative timing, activity status and a bounded set of legitimately admitted interpretations. Private `WorldState`, grounding, geometry/engine identities, exact hidden coordinates, source causes, evaluation labels and operational clock knowledge are excluded. Phase 2b's received-only hearing estimates and hidden-revision protection remain in force.

The normalized proposal separates interpretation/uncertainty, evidence references and one permitted action:

- `continue`: continue the existing activity.
- `look`: orient toward a recorded coarse bearing/elevation.
- `inspect`: orient toward an eligible observation-scoped handle and request further sensor evidence through the normal pipeline.
- `request_observation`: request another bounded observation when evidence is insufficient.

Local validation checks identity, association, age, pose, motion limits, permissions, cooldowns and action preconditions. Complete normalized results enter the established ordered input path; callbacks/partial output do not move the head or append experience. Own rotation may re-express an observed bearing; hidden source movement does not retarget it. A stale/foreign/duplicate/unsupported proposal fails explicitly without blocking world/reflex progress.

**Executed means the local action started or a capture intention was queued. It does not prove physical completion or the intended observed outcome.** The dashboard displays proposed action, local outcome and encoding independently. An otherwise eligible interpretation may survive a rejected action; an unexecuted proposal is never remembered as a completed event.

## Admission, recovery and replay

Real experience follows server-owned proof: actual sensory result → explicit attention selection → correlated interpretation → successful encoding. Provenance includes world/history/branch/run ancestry, observation/frame references, original capture/attention/interpretation/encoding timing, uncertainty and idempotent encoding identity. The model cannot assert itself real, LIVE, sensed, attended or encoded.

Admissible mistaken interpretations remain fallible perceptions rather than being corrected from private truth. Fabricated references, debug-only captures, ignored cues, failed encoding, Decisions comparison outputs and TEST STUB ancestry cannot manufacture LIVE autobiography. Experiment-produced experiences cannot be promoted into LIVE. Personal experience is separate from developer diagnostics and does not depend on optional diagnostic logging being enabled.

Schema 5 / `lumi-cognition-v1` checkpoints logical requests, result associations, deduplication/cooldowns, normalized outcomes and admitted records. Credentials, provider clients, promises and raw images are excluded. Active migration preserves LIVE history/tick, attention and motor/activity progress. Interrupted requests reconcile without waiting for dead callbacks or automatically resending a paid batch. Disabling cognition does not invalidate existing admitted records. Historical replay keeps its prior schema/rule semantics.

Experiences follow the existing recovery guarantee: graceful shutdown saves final state; abrupt termination can lose changes since the last successful recovery checkpoint, normally 30 real seconds. Logical encoding is not an immediate per-experience disk transaction. Capacity/save failures stay visible. The provider spending ledger has its own durable reservations and is not rolled back with a world checkpoint.

Offline replay injects recorded model outcomes at their original receipt ticks/order. It reproduces local validation/actions/encoding with zero provider and renderer calls. Sanitized exports retain the normalized content needed for exact hashes; if redaction/evidence loss prevents replay, they must say INCOMPLETE. Default exports exclude credentials, raw image payloads and sensitive full prompts.

```powershell
npm.cmd run replay -- --bundle 'C:\path\to\the-actual-incident.zip'
```

## Dashboard walkthrough

Select the current world/branch/run. **Interpretation & experience** reports enabled/disabled/unavailable state, application-wide budget and provider queue, main versus Decisions status, and bounded request history. Select a request to inspect its exact associated frame, original tick/hash, allowlisted context, interpretation/uncertainty, proposed versus started/queued action, encoding reason and measured usage/cost basis. An evicted frame stays unavailable; no latest-image substitute is shown. Successfully admitted real experiences appear separately from private source truth, diagnostics and the TEST STUB harness.

`world_seconds_per_model_response` is world seconds from the first included main interpretation request to the latest successful main response, divided by successful main responses. It is N/A without a successful main response. Decisions evaluation samples and latency/cost remain separate; confidence/uncertainty is a model estimate, not calibrated accuracy or a hidden monologue.

## Explicit integration checks

Normal `npm test` is offline and must not spend money. The explicit harness is registered as `cognition:verify`:

```powershell
# Explicit paid opt-in; requires enabled main cognition and its local key.
npm.cmd run cognition:verify -- --paid --out diagnostics/cognition-checks/my-paid-check

# Optional isolated Decisions comparison, with its independent flag/key configured.
npm.cmd run cognition:verify -- --paid --decisions --out diagnostics/cognition-checks/my-paid-decisions-check

# Actual renderer + explicitly MOCK provider; no paid provider acceptance claim.
npm run build
npm.cmd run cognition:verify -- --mock --serve 180 --out diagnostics/cognition-checks/my-mock-check
```

Use a fresh output directory. The default is a timestamped directory under `diagnostics/cognition-checks/`. Choose exactly one of `--paid` or `--mock`. `--serve` accepts 1–600 seconds and is available only for the mock dashboard companion; use the printed loopback URL and select its experiment, then export normally. The paid harness bounds itself to at most six main interpretation calls and, with `--decisions`, one optional Decisions call, all subject to the shared budget/admission limits. Missing main enablement/key reports unavailable before paid requests or rendering. Configured keys alone do not launch evaluation. Actual command results and any credential-dependent gaps remain explicit in [Phase 2c results](phase-2c-results.md).

Paid acceptance must use actual 512×512 visible/partial/dark/absent/hidden images and the genuine temporary LIVE admission path. A mock companion can demonstrate deterministic integration and UI but cannot prove provider image capability or real paid LIVE acceptance. Decisions requires a small matched ambiguous-case comparison; no measurable benefit is an acceptable outcome and does not enable normal LIVE use automatically. Stop before Phase 2.5 or Phase 3.
