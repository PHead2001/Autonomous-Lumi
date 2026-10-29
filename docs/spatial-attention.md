# Spatial hearing and selective attention

Phase 2b adds local hearing, adaptive attention and bounded automatic use of the existing Virtual Eyes renderer. No model calls or semantic recognition occur. A turn toward an impact does not establish that Lumi knows which object caused it. Real sounds, images and attention decisions do not enter LIVE `FOX_EXPERIENCE`; the experiment-only attended-and-encoded **TEST STUB** path retains its existing gates.

## Try it locally

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5173/?view=dashboard`. In built mode use `npm run build`, `npm start`, and port 3001. Desktop Chrome/Edge/Chromium is required for the isolated renderer; see [Virtual Eyes](virtual-eyes.md) for executable selection and backend setup. The simulation and immediate reflex continue if rendering is unavailable.

1. Record a checkpoint and fork an experiment. Its controls and evidence show the explicit world, branch and current run. Use 1× when observing the demo at an ordinary pace; experiments initially run at 6×.
2. Expand **Experiment sound fixture** under **Hearing & selective attention**. Use **Place source 1 unit ahead of the listening pose**, then emit a nearby abrupt sound. The fields are private source coordinates in room units. The resulting receiver-facing evidence shows normalized intensity/onset, a coarse bearing and uncertainty. Exact source identity, coordinates and barrier measurements appear only in expandable private developer truth.
3. Repeat similar cues to inspect decreasing local salience. Changing only the fixture ID should not restore novelty. Change perceived direction, received strength or onset, or allow the recovery interval, to inspect renewed attention. Immediate reflex thresholds remain separate from attention habituation.
4. Start the existing generic activity. Check commitment, interruption and saved progress. Explicit head controls receive temporary priority; automatic actions obey the existing bounded motion rules.
5. Watch the automatic capture intention, reasons, admission and result. The associated image shows its **original capture tick** alongside its later receipt tick and freshness. A missing image remains missing evidence. **Virtual Eyes** retains the independent manual capture workflow.
6. Save/restore a checkpoint during the sequence. Restore creates a new run. Old renderer handles/results cannot update it. Use the causal timeline and **Export diagnostic ZIP** to inspect the recorded sequence independently of the dashboard.

The fixture emits an actual simulated-world sound with **TEST STUB** source provenance. It is experiment-only. It is distinct from the synthetic experience-admission harness and does not grant personal encoding. A paused experiment must step or resume before a queued emission or sensor result executes.

For the original demo, open the room viewer and press **Slam the door**. Spectator playback remains an independent presentation event: its volume is not the intensity supplied to Lumi’s reflex. Browser audio still requires a user gesture and does not replay historical slams on reconnect. Whether Lumi’s ears flick depends on the received sound at her current position.

## Hearing approximation and units

Room coordinates use the existing scene convention: Y up and +Z forward. Distances are game-room units. Strength, onset and transmission are normalized game values in `[0,1]`; none is a calibrated decibel, sound-pressure or metre measurement.

The source event, listener eye/head position and posed physical scene come from one declared sound-event tick before subsequent movement in that tick. The straight source-to-listener ray tests explicit acoustic barriers from the shared physical scene. Real wall segments and the posed door leaf attenuate sound; spectator cutaways and navigation sweep reservations do not. Segments of the same physical wall share one acoustic group, so crossing overlapping segments or their seam applies one wall transmission. Decorative door panels, knobs and wall trim do not add separate losses. A source on or inside an emitting surface radiates without loss from any segment of that same physical barrier group.

Under current rules, the demo slam emits at the actual posed door-leaf centre. It uses the same generic propagation and surface-emission rule as other sounds. The historical fixed source coordinate remains part of older-rule replay only; it does not force the current reflex to bypass attenuation.

Received strength is:

```text
received = clamp(source_strength / (1 + distance_falloff × distance²)
                 × product_of_crossed_barrier_transmissions, 0, 1)
```

Default parameters live in `shared/attention-protocol.ts` and are included in complete checkpoints:

| Parameter | Default | Meaning |
| --- | ---: | --- |
| Distance falloff | 0.035 | Inverse game-distance-squared falloff coefficient |
| Wall transmission | 0.22 | Remaining fraction per real wall barrier |
| Door transmission | 0.42 | Remaining fraction through the posed leaf |
| Other declared object transmission | 0.65 | Remaining fraction through a declared acoustic object |
| Hearing floor | 0.015 | Below this, direction/distance remain unresolved |
| Reflex received intensity / onset | 0.34 / 0.65 | Independent immediate ear-reflex thresholds |
| Bearing quantization | 15° | Head-relative angular bins |

Bearing uncertainty increases with distance, obstruction and weaker received intensity. Very close sources with no supported horizontal direction receive a null bearing rather than a fabricated angle. Near/middle/far distance evidence is fallible and includes explicit uncertainty. The hearing path covers directions behind the head and outside the visual field. Invalid or unknown sources fail validation before propagation.

The eligible `ReceivedSound` object contains correlation/tick metadata, received strength/onset, coarse bearing and uncertainties, distance band, and Lumi’s own listening orientation. Exact source coordinates, private identities, actual cause and crossed-barrier measurements remain private diagnostics. Own-body/head orientation is retained to compensate subsequent motor motion without remeasuring a hidden source.

## Local attention and activity

The compact deterministic score uses received intensity and suddenness, perceptible novelty/change, direction uncertainty, bounded recent exposure, activity commitment and switching cost. Repetition keys derive from received cue features rather than engine IDs. At most eight exposure summaries are retained. Similar cues accumulate habituation, with recovery in world ticks; renewed perceived strength/onset/direction can regain salience.

| Policy parameter | Default at 30 Hz |
| --- | ---: |
| Glance / investigate score thresholds | 0.52 / 0.83 |
| Habituation penalty per recent exposure | 0.24 |
| Exposure recovery interval | 900 ticks / 30 world seconds |
| Attention cooldown | 90 ticks / 3 world seconds |
| Attention commitment | 45 ticks / 1.5 world seconds |
| Explicit developer head priority | 90 ticks / 3 world seconds |

The immediate physical reflex runs before this policy and does not wait for a head action or image. Attention decisions may ignore, glance, investigate, or report an unreachable direction. Motion uses the existing head validator, yaw/pitch limits and 90°/second rate. Captured visual turns keep the Phase 2a captured-bearing contract. Sound-driven turns preserve the received uncertain direction and compensate only Lumi’s own rotation; they never track a source’s newer hidden coordinates.

Explicit developer head controls take priority over automatic investigation. Cooldown, commitment and bounded activity interruption prevent ordinary repeated sounds from restarting the same action continuously. The generic activity retains its cursor and once-only milestone/completion effects when resuming. Ignored cues may update bounded adaptation state; they are not remembered personal episodes.

## Automatic captures and visible change

Automatic scheduling sits above the existing single `CaptureManager`. It supports salient sound, head milestones, visible change, meaningful viewpoint change, generic activity outcome and uncertainty probes. A world holds one pending/submitted intention and at most one deferred intention that coalesces later reasons. A cue arriving after an image snapshot cannot be attributed to that earlier image; it remains deferred for a subsequent capture opportunity. Expiry, cooldowns, counters, baseline and backoff are complete checkpoint state.

| Logical policy | Default |
| --- | ---: |
| Capture cooldown | 90 ticks / 3 world seconds |
| Routine low-resolution probe | 900 ticks / 30 world seconds |
| Intention lifetime | 300 ticks / 10 world seconds |
| Per-world window | At most 6 intentions per 1,800 ticks / 60 world seconds |
| Initial / maximum failure backoff | 150 / 1,800 ticks |
| Meaningful viewpoint motion | 1 room unit or 45° |
| Maximum result age | 600 ticks / 20 world seconds |
| Mean normalized image-change threshold | 0.01 |

Host protection is separate: automatic frames are 256×256, one automatic job may be outstanding globally, starts are at least two host seconds apart globally and five host seconds apart per run. LIVE and waiting experiments share opportunities; experiments rotate. Automatic work leaves the other existing queue slots available for developer captures. The existing queue capacity four, 20-second render deadline, five-second cleanup deadline and shared 105-second client completion budget remain in force.

Paused and fast-forwarding experiments do not launch accumulated automatic captures. Logical expiry and backoff avoid a catch-up storm on resume. Host monotonic timers rebase on process restart and are not simulation time. Their admission/refusal outcomes enter the ordered input stream when they can affect future behavior.

Each successful automatic PNG is decoded within bounded image limits and reduced to 4×4 area-averaged RGB cell means: 48 integer channel values. Mean absolute normalized channel difference measures actual rendered appearance or illumination, independent of PNG encoding and hidden object identity. Private scene invalidation does not itself prove a visible change. An occluded color edit produces no perceived novelty merely because engine state changed. Expected camera motion establishes a viewpoint baseline rather than repeatedly causing new head turns.

This coarse signature can miss small/local changes and cannot recognize objects. It is a bounded local change detector. A probe is sensor work, not interpretation or personal encoding.

## Freshness, restore and replay

A successful render proves that an image was produced for its original snapshot. It does not prove that the frame is suitable for a later decision. Logical applicability checks association, capture age, pose, scene context and ordering. Current policy rejects evidence older than 600 ticks, from a changed scene, sufficiently displaced/rotated poses, or older than already accepted evidence. Advancing a few simulation ticks while rendering is allowed. Freshness failures never establish that a suspected source is absent.

Callbacks submit normalized `sensor_feedback` through the runtime’s ordered input path. Admission, failure/quota outcomes, original captured tick/pose/context, compact signature/hash and actual receipt order are recorded. They do not directly mutate head or attention state. Cross-branch and retired-run results are rejected. A successful stale historical frame remains inspectable while retained and is never relabelled as the present scene.

Schema 4 (`lumi-attention-v1`) persists bounded exposure/adaptation state, commitments, developer arbitration, automatic action association, pending/deferred capture reasons, inspected-view signature, retry/cooldown windows and deterministic counters. Raw PNGs, Chromium processes, promises and transport handles remain outside checkpoints. Active upgrade preserves LIVE history, tick, existing pose, queues and recovery data; historical schema/rule replay retains its original mechanics. In-flight work restored into a new run is explicitly reconciled as interrupted rather than waiting for a dead renderer.

Current schema 4 movement also validates the whole swept body segment against physical colliders, including supported low-Hz/high-speed configurations. A fixture cannot be tunnelled through merely because the next endpoint is clear. Migrated overlap may only escape without moving through a deeper overlap. Historical schema 3 retains its original endpoint-only collision behavior for exact offline replay.

The guarantee is **same initial checkpoint + same ordered inputs, including recorded sensor outcomes = same canonical state/events**. Offline replay injects recorded outcomes; it does not launch Chromium, wait for host deadlines or regenerate images. Fresh 1× and accelerated executions can legitimately differ when real sensor results arrive at different logical ticks.

Default diagnostic exports include sanitized metadata, comparison evidence, causal records and canonical replay data. Automatic capture records retain intention/reason/origin associations and causal links through sanitization; a later cause is never attached to a pre-existing immutable capture. Raw pixels and encoded image payloads are excluded. See [Diagnostic export and replay](diagnostics.md) and [Phase 2b results](phase-2b-results.md) for the actual acceptance bundle, replay result and evidence gaps. Model-response metrics remain **N/A**; operational timestamps do not calibrate subjective time.

## Checks

```powershell
npm test
npm run lint
npm run build
npm run vision:verify
npm run vision:attention
```

Use the short actual end-to-end scenario documented in the results alongside these commands. `2b-1` covers propagation/reflex/information boundaries; `2b-2` covers adaptation, bounded motor arbitration and restore; `2b-3` covers actual image change, scheduling, stale/failure behavior and zero-viewer capture. The Phase 2a backend comparison and previous logging benchmarks are retained unless a concrete change invalidates them.

## Reproducible isolated dashboard scenario

Build the viewer once, then start the bounded helper from the repository root:

```powershell
npm run build
npx.cmd tsx server/vision/attention-demo.ts --run
```

The helper chooses a free loopback port and a new unique `diagnostics/phase2b-demo/run-*` directory. It never reads or resets the owner's LIVE recovery namespace. Its LIVE branch keeps walking normally. Its labelled experimental fixture starts at 1× with a stationary body, a fixed listening pose, the visibility objects and the existing generic activity. The `--run` option queues two equal perceptible sounds with distinct private IDs through normal private HTTP controls, resumes the experiment, waits within the shared capture budget for applicable real sensor feedback, then pauses it for inspection. The second cue supplies a useful repeated-cue suppression case.

Use the printed `ATTENTION_SCENARIO_READY` result, then open the printed dashboard URL and select **attention-demo**. Inspect the source → received → reflex → attention → head → capture causal chain, associated image and original capture/receipt ticks. Clear timeline filters and press **Export diagnostic ZIP**. The helper does not generate a substitute export; this action uses the same dashboard bundle path as the application. Save the actual ZIP path and replay it with:

```powershell
npm.cmd run replay -- --bundle 'C:\path\to\the-downloaded-incident.zip'
```

For a fully interactive version, omit `--run`: the experiment is prepared and paused, and the normal dashboard controls trigger the sequence. `--port 3102` explicitly chooses a port; default `--port 0` uses a free one. Type `stop` and Enter in the helper's terminal, press Ctrl+C, or send IPC `{ "type": "lumi:shutdown" }` to shut down cleanly. The unique evidence directory is preserved. `demo-session.json` records the local URLs and target; a successful `--run` adds `scenario-result.json`. Neither file substitutes for the exported diagnostic bundle or browser inspection.
