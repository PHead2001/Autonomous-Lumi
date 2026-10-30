# Experimental physiology and interoception

Phase 2.5a adds a deterministic experimental game model, `lumi-physiology-v2` (checkpoint 7 / runtime 6) / configuration `experimental-body-v1`. It models normalized satiety, energy reserves, sleep pressure, recoverable fatigue and condition; modes are awake, resting, asleep and incapacitated. BodyState physics/config remain v1 with unchanged rate math; v2 versions execution coupling and internal sampling. These variables are private WORLD_TRUTH, not exact personal knowledge. No medical realism, day/night schedule, food acquisition, home loop or new paid model integration is asserted.

## Activation and local use

New histories and active migration from schemas 1–5 initialize an **inactive** body at the current world tick. They do not age a body retroactively across the old history. A physiology restore preserves its saved gate when no override is supplied. Activation is an explicit server process setting:

```powershell
# Main cognition/Decisions configuration stays independent.
$env:LUMI_PHYSIOLOGY_ACTIVE = 'true'
npm run dev

# For a later start, explicitly freeze the saved body:
$env:LUMI_PHYSIOLOGY_ACTIVE = 'false'
# Or omit an override and preserve a saved physiology gate:
Remove-Item Env:LUMI_PHYSIOLOGY_ACTIVE -ErrorAction SilentlyContinue
```

Only exact `true`, `false` or absence is accepted. This variable is read from the **process environment**, not the repository `.env` file; `.env.example` documents the distinction. The equivalent local server option is `physiology: { active: true|false }`. Explicit override preserves stocks, origin and progress; omission preserves the restored gate. OFF freezes body integration, absorption and circadian phase, with explicit inactive exclusions for pending urgent needs. It preserves stored episodes. Neither a provider nor a dashboard action can enable production physiology. Activation is rejected before changing state if its complete future storage budget cannot fit, including activation during old-schema migration. The PR #9 correction covers old-schema activation as well as an existing physiology gate, with a preflight before any state change.

The default is deliberately staged OFF until recovery affordances exist. Active physiology can eventually force sleep/incapacity even if the model would prefer to continue a task. The laboratory provides labelled fixtures rather than a survival gameplay loop.

## Fixed steps and model calibration

The engine keeps its normal fixed logical `dt = 1/hz`. Acceleration executes those same steps; it does not multiply physics dt or skip body effects. Paused experiments perform no body integration. Host-suspend handling remains unchanged.

One tick executes in this order:

1. Advance the tick and snapshot pre-input state; apply ordered accepted effects immediately.
2. Record interval-start capability after those effects; execute permitted walking, task and head motion.
3. Integrate the body exactly once from actual executed distance/task/head deltas: absorption, expenditure, recovery and hard physical transitions.
4. Enforce endpoint capability: stop movement, cancel head work and suspend the task cursor when asleep/incapacitated.
5. Sense internal state using endpoint capability; account elapsed urgent eligibility using interval-start capability. Attend locally, then perform an independent, fallible encoding step.
6. Continue established sensory/cognition postprocessing.

Satiety and reserves are separate: intake promptly changes satiety, while reserve absorption follows its checkpointed timer. Baseline rates are satiety −0.055/hour, reserves −0.014/hour before activity costs, awake sleep pressure +0.03/hour, quiet rest −0.008/hour and sleep −0.11/hour. Quiet rest is much weaker than actual sleep. Actual walking, task progress and head rotation add bounded reserve costs; duplicate accepted effect sequences cannot repeat intake. Fractional absorption normalizes completion so tiny floating residuals cannot leave an inconsistent pending timer; its 21 reducer checks and independent ordinary review passed.

There are exactly two fatigue cross-effects: low reserves and high sleep pressure increase fatigue. V2 applies the existing bounded impairment outputs to actual walking distance, head speed, ordinary attention and task progress. With load `clamp(max(fatigue, (sleepPressure−0.4)/0.6))`, walking scale is 0.7–1, head scale 0.6–1, task scale 0.5–1 and ordinary attention scale 0.4–1. Collision/emergency/reflex behavior retains its original rules; slower movement still uses the same collision path.

Task slowdown uses checkpointed fractional credit associated with the activity ID: each eligible task tick adds its current task scale, and a whole unit advances the actual cursor once. Paused, sleeping/incapacitated or otherwise blocked ticks accrue no credit. A new activity resets credit; restore preserves it. Hard incapacity still suspends the cursor and completed effects without replaying them. Waking resumes only a task still marked running; an independent user pause remains paused. Earlier v1 head/attention impairment met the Phase 2.5a minimum; wiring unused scales and correcting ordinary sensing stays within that phase.

Measured default idle reducer calibration from initial stores, in world hours:

| Transition | Measured time |
| --- | ---: |
| Mild / moderate / severe hunger | 5.4547 / 10.0003 / 13.6364 h |
| Severe sleep pressure | 21 h |
| Forced sleep / automatic wake | 27.3333 / 34.3336 h |

These are measurements of this configuration, not claims about real biology. Circadian phase is a checkpointed, **tracked-only** relative oscillator; it currently has no behavioral rate modifier and that coupling is explicitly deferred; civil-clock/DST synchronization and a day/night system are outside this phase.

## Present sensation, urgent attention and encoding

Hunger, sleepiness and discomfort are coarse `mild|moderate|severe` internal signals. Sensing does not imply attention; attention does not imply encoding. Present attended sensations remain usable for 120 world seconds even when their encoder is disabled or fails. Provider context exposes only `kind`, `band`, `description`, `uncertainty: coarse_internal_signal`; it never exposes exact body stocks, timestamps, thresholds, exclusion counters or private physiology objects. Trusted correlation separately retains internal observation/attention identifiers and `SIMULATED_INTEROCEPTION` provenance.

Under v2, ordinary mild/moderate sensing uses a separate checkpointed `xorshift32-v1` sampling stream, with a five-world-second active/awake sampling cadence and uniform bounded ±0.04 normalized-need noise. Migration seeds that dedicated stream without draws and schedules its first sample five seconds after the current tick; inactive/asleep intervals consume no draws, and overdue sampling does not replay a catch-up loop. Each capable sample takes two stable-order draws per hunger/sleep/discomfort channel (noise and attention), even when no cue exists. Sampled thresholds can miss or fluctuate around mild/moderate boundaries. Eligible ordinary attention succeeds when its draw is below the current bounded scale 0.4–1, replacing the old all-or-nothing impairment cutoff. Task focus, commitment, explicit safety preemption and incapacity still have their separate rules.

The severe monitor checks exact private body truth every fixed step; it bypasses sampling noise/cadence/lapses for crossing and deadline forcing. Thus noise cannot hide a severe need indefinitely or create a false severe crossing. Ordinary sensory uncertainty follows scratchpad v0.23.1 §9.6, while the separate forced-awareness guard follows §§9.7/18.11. Exact parameters remain an experimental game-model choice, not physiology. A first severe crossing has a **maximum 30 eligible world-second** attention delay. The guard forces one fixed step before that maximum: 29 seconds at 1 Hz or 29.9667 seconds at 30 Hz when uninterrupted. This bounds local awareness, not encoding or a recovery action. Safety preemption, incapable intervals and inactive intervals are tracked separately from eligible time; they are not silently removed from wall/world elapsed time. Coalescing/retries preserve the original crossing and deadline. The interval's start capability determines elapsed eligibility; the endpoint capability determines whether a sensation can be sensed/attended now. Thus the last awake interval is counted, and a wake endpoint can attend immediately.

The independent local encoding policy, `first-severe-per-need-v1`, admits at most one episode per severe crossing. It requires actual internal sensing and attention, an eligible history and successful capacity/encoding checks. Encoded provenance is `ATTENDED_INTERNAL_SENSOR`, with world/history/branch/run identity, sensory correlation, fallible subjective time and separate private audit ticks. An episode asserts a sensation, never an unperformed meal/action. Present awareness can exist with zero episodes.

Post-genesis private body fixtures permanently mark future internal LIVE encoding `debug-tainted`; toggling activation cannot clear that taint. Existing memories/transients remain. Explicit server gate configuration is exempt from debug taint but cannot remove prior taint. Experiment records never become LIVE autobiography. Mild/ignored cues, TEST STUB diagnostics and records merely labelled experience cannot bypass admission. There are at most 128 internal episodes/encoding keys and bounded internal cue/absorption queues; failures remain explicit rather than trimming history.

## Dashboard, private API and prepared laboratory

Select a current world/branch/run in the local dashboard. **Physiology & present sensations** shows the activation/capability state and current internal percepts. Advanced private evidence exposes body, urgent eligibility/exclusions, origin, encoding and interruption state. These exact values are developer diagnostics, not Lumi's knowledge.

`GET /api/physiology?worldId=lumi&branchId=live&runId=<current-run>` returns scoped activation, mode and present sensations; `&advanced=true` adds private body/interoception/runtime/episode evidence. Requests use the established local/same-origin boundary and reject stale run selection. No public diagnostics service or general body-edit API is introduced.

```powershell
npm.cmd run physiology:lab -- --out diagnostics/physiology-lab/hunger-during-task.zip
npm.cmd run replay -- --bundle diagnostics/physiology-lab/hunger-during-task.zip
```

The dashboard card is a prepared CLI entry, not a polished scenario launcher. The lab always creates a fresh `lab-<UUID>` directory under its output namespace (optional `--directory <parent>`). It does not load owner recovery, `.env`, credentials or the durable provider budget. Cognition and automatic capture are disabled. An explicit 1 Hz disposable genesis uses production rates/stores, a stationary warmup and a 100,000-work-unit task (the existing wire field remains `totalTicks`). It demonstrates ignored mild hunger, rising need, severe local awareness, a transient sensation with encoding disabled, and labelled nutrition-fixture recovery/absorption. It writes the actual sanitized ZIP and `<zip>.summary.json` with expected/observed PASS, FAIL or INCONCLUSIVE assertions and a timeline, then runs offline replay. Supplied intake is not evidence that Lumi found, acquired or ate food.

## Optional single active-profile provider integration

Ordinary tests and the hunger lab make no paid calls. A separate explicit check exists when main cognition is enabled and its key is configured locally:

```powershell
npm.cmd run cognition:verify -- --paid --physiology --out diagnostics/physiology-provider-check
```

Use a fresh output directory. This mode is limited to exactly one main request, zero Decisions calls, and the existing durable US$1 application ledger; it does not reset the ledger or raise the ceiling. It uses a labelled disposable LIVE acceptance-fast genesis and actual renderer. Active requests use `lumi-vision-prompt-v5` (inactive keeps v4); `internalSensations` contains only attended coarse kind/band/description/uncertainty, not body numbers. A provider success with empty internal context is not active-profile acceptance. Reports preserve an INCOMPLETE/failed check, response/input/budget evidence and any available COMPLETE replayable bundle across cleanup/restart failures rather than silently trying again. The two actual development attempts and their costs are documented in results. Their pre-`legacyImport` paid ZIPs remain unmodified historical development-contract artifacts and visibly reject current-schema replay; the final regenerated hunger-lab ZIP is the current independent replay proof. No extra paid rerun was made merely to replace those originals.

## Checkpoints, recovery and evidence limits

Current simulation checkpoint **7**, runtime envelope **6**, covers body/config/gate, absorption/effect cursor, internal candidates/transients, severe crossing/deadline/exclusions, encoding keys/episodes, origin/taint, hard-incapacity task interruption and bounded unconscious sensor windows, dedicated sampling PRNG/cadence and fractional task credit/activity association. `physiology.legacyImport` is mandatory: either `null` or an explicit marker `{kind: explicit-unverified-import-v1, sourceHistoryId, destinationHistoryId, importTick}`. Only the explicit bare legacy EXPERIMENT import path creates that marker. It preserves source origin, old episodes (including an episode encoded at the import tick) and existing debug taint, but permanently blocks future internal encoding as `legacy_unverified`; present awareness continues. Encoding toggles cannot remove the restriction, and secondary unverified imports are rejected. Ordinary forks/restores retain their established verified identity rules. Historical schemas 1–6 replay with their original classes/rules, including exact checkpoint-6 `lumi-physiology-v1` behavior. Active 6→7 migration preserves body, cue/deadline state, memories, activation gate and history at the current tick; only new sampling/cursor fields are initialized, without inventing past samples or retroactive impairment. For older schemas, active migration preserves history, tick, queues, cognition records, pose and activity before declaring the body genesis at that tick. No missing body history is invented.

A separate verified LIVE import chain supports the existing explicit `LUMI_CHECKPOINT` RecoveryStore path, which creates a fresh history. Mandatory `physiology.verifiedCheckpointImports` is an array of at most eight `{kind: explicit-live-checkpoint-import-v1, sourceHistoryId, destinationHistoryId, importTick}` edges. Only `RecoveryStore.open` validating a source LIVE checkpoint under an explicit override can append an edge on a clone and change current identity; ordinary restore cannot infer authority. An older LIVE override initializes or migrates body state at its current tick, then records the edge under the same explicit validation boundary. Invalid capacity or a ninth edge rejects visibly while preserving the source.

Origin, old visual/internal episodes and debug taint remain unchanged. Source records are valid through the edge import tick; destination records must be strictly after its incoming import tick. Legitimate new encoding remains allowed, with eligible verified-ancestor context available under the same chain rules. Ordinary experiment forks carry the chain. A later explicit unverified EXPERIMENT legacy import uses the chain tip as its source, preserving ancestor records and edges while still permanently blocking future internal encoding via the separate legacy marker. Experiments cannot enter LIVE. Local tests/re-reviews and independently checked current-chain lab replay passed; [results](phase-2-5a-results.md) separately record pending hosted review.

The actual pretty-printed recovery/named-checkpoint limit remains **2 MiB (2,097,152 bytes)**. Active physiology reserves **384 KiB** of bounded future growth; inactive state reserves **8 KiB**. The maximum-shape measurement including all eight verified import edges is **338,421 bytes**, leaving **54,795 bytes** within the 393,216-byte active allowance. Existing data and other future cognition/activity allowances are still measured/reserved; nothing is silently pruned to fit. Activation/admission/encoding fail visibly if the full budget does not fit. The ordinary recovery window still applies: logical internal encoding is not an immediate per-record durable disk transaction. Offline replay consumes recorded ordered inputs/results without paid calls and reproduces canonical state/event/runtime evidence. An awake capture first delivered while asleep cannot create visual attention, update the visual baseline or start cognition selection. An interpretation of an already attended pre-sleep request may arrive later, while its action remains subject to current incapacity checks.

V2 targeted mechanics, actual-renderer/FAKE integration, historical compatibility, current diagnostic replay and final 316/316 suite passed; independent ordinary and high-risk reviews are clean. Owner-runtime integration and hosted review are separate, unclaimed gates. See [Phase 2.5a results](phase-2-5a-results.md) for current versus historical evidence; earlier v1 passes do not establish v2 acceptance. The results separate current v2 checks/artifact from historical v1 and paid-wire evidence, with honest full-suite/review status and short-runtime limitations. No new paid call or actual owner-runtime migration is inferred from isolated compatibility tests.
