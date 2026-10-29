# Phase 2b verification results

Current `lumi-attention-v2` corrects the sensory truth leaks found by Claude: eligible uncertainty/distance fields now use received loudness only, and a hidden global scene revision cannot reject automatic visual feedback or change backoff. Schema 4 is retained, with explicit active migration and exact historical v1 replay. [PR #7](https://github.com/PHead2001/Autonomous-Lumi/pull/7) remains open and unmerged.

The correction passed **192/192 tests**, lint, build/typecheck, **2/2 actual image/attention checks**, an actual zero-viewer scenario, Chrome dashboard inspection/export and exact offline replay. Independent Astra boundary review is clean; a new hosted review is pending. The reported intermittent renderer-cleanup flake was not encountered in this run, but the full eight-case renderer suite was not rerun and no cleanup repair is claimed. Audible playback remains unverified.

## Current sensory boundaries

- Physical attenuation still uses the source, listener and actual geometry. Receiver-facing distance/uncertainty derives solely from received intensity: at least 0.6 → near / 30° / 0.5; at least 0.2 → middle / 60° / 0.75; lower audible → far / 90° / 1; inaudible → unknown / 180° / 1. An unresolved bearing always has 180° uncertainty. These are ambiguous loudness heuristics, not measured physical ranges. Confusable source configurations with equal received features produce equal eligible evidence and attention.
- Automatic visual applicability keeps age, pose, ordering, capture association and run protections. The original scene revision remains diagnostic; it no longer acts as a hidden sensory rejection/backoff signal. Actual image comparison still detects visible novelty. Manual Phase 2a head-command scene validation remains an explicit developer-control guard.
- Active v1→v2 migration preserves history/time/state/queues while sanitizing old `lastReceived` derived fields, archiving source recovery data and recording `STATE_RULES_MIGRATED`. Explicit offline replay retains v1 mechanics and hashes. No real sensory experience admission or model call is added.

Defaults, limits, approximations and setup are in [Spatial hearing and attention](spatial-attention.md).

## Current checks

| Command | Result | Local output |
| --- | --- | --- |
| `npm test` | **192/192** | `diagnostics/phase2b-boundary-tests.log` |
| `npm run lint` | **PASS** | `diagnostics/phase2b-boundary-lint.log` |
| `npm run build` | **PASS**, including TypeScript; existing viewer-chunk advisory remains | `diagnostics/phase2b-boundary-build.log` |
| `npm run vision:attention` | **2/2** actual image/attention cases | `diagnostics/phase2b-boundary-attention-real.log` |

Focused regressions cover confusable acoustic sources, hidden versus visible scene changes, preserved freshness safeguards, explicit active migration and historical replay. Applicable Phase 1/1.5/2a and earlier Phase 2b regressions remain in the full suite. Existing physical propagation, habituation, motor/activity arbitration, capture ownership, quotas and replay checks are retained.

The earlier full `vision:verify` result was **8/8** (`diagnostics/phase2b-renderer.log`). It was not rerun for this sensory-boundary correction. Claude's separate intermittent cleanup report did not occur during the 192-test run or two actual attention cases; this observation does not establish a fix. The existing renderer comparison and earlier logging benchmarks were reused without new matrices.

## Actual v2 scenario and Chrome dashboard

```powershell
npm run build
npx.cmd tsx server/vision/attention-demo.ts --run
```

The helper created fresh `diagnostics/phase2b-demo/run-9ndK7N`, leaving owner LIVE recovery data untouched. The `attention-demo` experiment ran at 1× with a stationary body, fixed pose, visibility fixture and the existing activity. Its actual automatic capture completed with **zero spectator WebSockets** in run `3b028cec-7b77-4cdb-879a-761b87be97a2`.

Chrome's normal dashboard verified private source versus eligible received evidence. Received intensity approximately **0.878** displayed the expected heuristic **near**, **30° direction uncertainty** and **0.5 distance uncertainty**. The bounded head action completed and the frame was captured at tick **10**; feedback arrived at tick **32**. The result was applicable, with coalesced `salient_sound` / `head_milestone` reasons. The helper paused at tick **37**, with **zero experiences**. Screenshot: `diagnostics/phase2b-hearing-v2-dashboard.jpg`.

Capture `e7447d9d-faba-4c2c-aac9-335f6044cb9d` retained its original snapshot tick. Actual frame hash:

```text
f27aa1a25a3647f7d9e29f9172e89668328b9d1b08454aeb761910447e2ca1e0
```

The normal dashboard **Export diagnostic ZIP** control produced the inspected v2 bundle below. The helper was stopped cleanly after inspection. `demo-session.json` and `scenario-result.json` locate the actual run but do not substitute for the exported bundle.

## Current v2 diagnostic ZIP and offline replay

`diagnostics/phase2b-hearing-v2.zip` is the actual dashboard export: **22,390 bytes**, **13 text/JSON/replay entries**, COMPLETE, **61 records**, no evidence gaps or drops, and no raw pixels or encoded image payloads. It contains the sound → received evidence → reflex → attention → head → capture chain and a repeated-cue suppression case.

```powershell
npm.cmd run replay -- --bundle diagnostics/phase2b-hearing-v2.zip
```

Replay **PASS** without Chromium: tick **37**, **4 inputs**, **33 deterministic events**. Output: `diagnostics/phase2b-hearing-v2-replay.log`. Use `npm.cmd` in PowerShell so forwarded flags remain intact.

| v2 canonical evidence | Hash |
| --- | --- |
| State | `11c1eb0f2f319fdfe739c99abcaa062abfc4a63ba6750b58de207731c41f5ecb` |
| Events | `ccc063f9a2da85cec1dfaf679a9605f9b8218fbc1cdef77a81c34042093eb6da` |
| Runtime | `aef2cfcf351623569658da08bd3d375de77ced0d5df87002192f762d9090d367` |

## Historical v1 artifact and retained demo evidence

The original `diagnostics/phase2b-spatial-attention.zip` is unchanged: **22,456 bytes**, **13 entries**, COMPLETE, **61 records**, no raw pixels. It remains a historical `lumi-attention-v1` artifact and still replays its original mechanics and hashes after the v2 correction:

```powershell
npm.cmd run replay -- --bundle diagnostics/phase2b-spatial-attention.zip
```

Historical replay **PASS** at tick **38**, **4 inputs**, **33 events**:

| v1 canonical evidence | Hash |
| --- | --- |
| State | `dc57a4b3c4cb66bf8c505cb4e37ce985679d5cb66a979ed3cf8e042c3a45c69c` |
| Events | `ca329b5724456e817fc9a0e4d790123df63a36bd597e1cde90ae61656f346bb3` |
| Runtime | `24bffce4aa2321385f497fc7378e5aa78e0637290e025dc45f94a89090c99fb6` |

Earlier Chrome checks covered event filtering and a three-record scoped causal link, sound/single-step, fast-forward with activity cursor **24/600**, manual capture, upright LIVE walking/idle/door motion and articulated ears. A stationary neutral tick-69 versus reflex tick-72 comparison is retained as `diagnostics/phase2b-ears-{neutral,flick}.jpg`. Normal disconnect left **zero viewers** while the same LIVE run advanced from tick **12,398** to **12,894**; normal reconnect returned to its current state. These earlier rendered checks were retained rather than repeated for the isolated sensory correction. Audio was enabled by user gesture but not independently heard; the shortest remaining check is to press **Slam the door** and listen.

## Review and correction history

Earlier implementation checks caught the posed-slam reflex regression and two outdated renderer assertions. Focused review corrected wall-group/self-emission handling, causal export fields and later-cause deferral. The owner's low-Hz/high-speed collision finding is fixed by current schema-4 swept movement; historical schema 3 retains endpoint-only replay. Hosted review then found queued-admission restore ownership, rejected-head arbitration and inaudible-exposure defects; five regressions brought that accepted v1 baseline to **186/186**, with clean [hosted re-review](https://github.com/PHead2001/Autonomous-Lumi/pull/7#issuecomment-6503987525).

Claude subsequently identified the two sensory truth leaks addressed by v2. The current checks, actual v2 artifact and unchanged historical replay above verify those corrections. Independent Astra boundary review is clean; fresh hosted review of this latest correction is pending. No new security scan or cleanup repair is claimed.

## Limits

Hearing remains a normalized straight-ray game approximation. Loudness-based distance bands are fallible and confusable. The 4×4 RGB signature can miss small changes and does not recognize objects. There are no model calls, semantic source identification, real autobiographical admission, learned associations, microphone input or hosting changes; model metrics remain **N/A**. Generated artifacts/screenshots/logs are local and ignored by Git. Audible playback and the separately reported intermittent cleanup flake retain the explicit limits above. Stop before Phase 2c and leave merging to the owner.
