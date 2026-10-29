# Phase 2b verification results

Phase 2b adds listener-relative hearing, deterministic local attention, bounded automatic capture scheduling and replayable sensor feedback. Final checks after hosted-review fixes passed: **186/186** tests, lint, build/typecheck and **2/2** actual image/attention cases. The unchanged renderer retains its earlier **8/8** actual verification. The actual zero-viewer scenario, normal Chrome dashboard export and exact offline replay passed; the same ZIP replayed with unchanged hashes after the fixes. Independent targeted architect review and [hosted Codex re-review](https://github.com/PHead2001/Autonomous-Lumi/pull/7#issuecomment-6503987525) are clean, with no actionable findings or unresolved review threads. [PR #7](https://github.com/PHead2001/Autonomous-Lumi/pull/7) remains open and unmerged. Audible browser output was activated but not independently heard.

See [Spatial hearing and attention](spatial-attention.md) for configuration, approximations, recovery/replay and the reproducible demo. Phase 2c remains outside this change, and merging belongs to the owner.

## Acceptance evidence

| Requirement | Evidence and result |
| --- | --- |
| `2b-1` propagation | `attention-core.test.ts` covers near/far/behind, wall/open/shut door, quiet/coincident/invalid source, physical-wall seam grouping, filtered receiver evidence, and immediate pre-movement-tick reflex. The actual scenario received sound and started its reflex at tick 1. |
| `2b-2` attention | Core regressions cover repetition/change/recovery, private-ID equivalence, commitment/cooldown/activity resume, developer arbitration, fixed perceived bearing/own rotation, restore and historical replay. The actual scenario completed a bounded 30° head turn at tick 10. |
| `2b-3` captures | Core and host tests cover coalescing, later-cause deferral, logical/host quotas, fair sharing, pause/fast-forward/resume, queue/backoff, stale/retired/recovered work and ordered feedback. Actual decoded RGB comparisons distinguish visible material change from duplicates and hidden changes. |
| Zero-viewer chain | Real isolated server: sound → received evidence → reflex → attention → head → automatic image, with no spectator WebSockets. Capture tick 10 and receipt tick 31 remain distinct; zero experiences were encoded. |
| Browser workflow | Chrome verified selected world/branch/run, source/receiver separation, associated image, event filters, causal navigation, sound/step, fast-forward/activity progress, manual capture and normal dashboard ZIP export. LIVE upright walking, idle, door motion, articulated ears and disconnect/reconnect were observed. |
| Diagnostic artifact | `diagnostics/phase2b-spatial-attention.zip`: **22,456 bytes**, **13 entries**, COMPLETE, 61 records, no gaps/drops, no raw pixels or encoded image payloads. Exact offline replay passed. |
| Review | Initial hosted PR #7 review raised three P2 findings; all were fixed with five regressions. Independent targeted boundary review and hosted Codex re-review are clean. All three review threads are resolved; no actionable findings remain. No new security scan is claimed. |

## Accepted checks

```powershell
npm test
npm run lint
npm run build
npm run vision:verify
npm run vision:attention
```

| Command | Result | Retained local log |
| --- | --- | --- |
| `npm test` | **186/186** after five review regressions | `diagnostics/phase2b-review-tests.log` |
| `npm run lint` | **PASS** after review fixes | `diagnostics/phase2b-review-lint.log` |
| `npm run build` | **PASS**, including TypeScript, after review fixes | `diagnostics/phase2b-review-build.log` |
| `npm run vision:verify` | Earlier **8/8** retained; renderer unchanged by review fixes | `diagnostics/phase2b-renderer.log` |
| `npm run vision:attention` | **2/2** actual image/attention cases rerun after review fixes | `diagnostics/phase2b-review-attention-real.log` |

The existing nonblocking viewer-chunk advisory remains, approximately **539.20 kB**. The real RGB test measured visible material-change difference approximately **0.0133**, above the configured **0.01** threshold. Duplicate, hidden and behind-wall differences were zero. These are decoded image measurements, not PNG-byte differences.

The pre-review canonical run passed **181/181**, lint/build and both actual-renderer commands (`diagnostics/phase2b-{tests,lint,build,renderer,attention-real}.log`); the final affected checks above supersede their narrower evidence. Earlier targeted dashboard lint/typecheck and **18/18** existing helper regressions also passed. The Phase 2a renderer comparison and prior logging benchmarks were reused without rerunning their matrices.

## Actual isolated scenario and browser walkthrough

```powershell
npm run build
npx.cmd tsx server/vision/attention-demo.ts --run
```

The helper used fresh `diagnostics/phase2b-demo/run-mgNcxW`, leaving owner LIVE recovery data untouched. The `attention-demo` experiment had a stationary body, fixed listening pose, physical visibility fixture and the existing generic activity at 1×. Two equal perceptible cues with different private IDs supplied a repeated-cue suppression case. Source emission, received evidence and reflex began at tick **1**. A **30°** head action completed at tick **10**. Capture `49097bb7-2467-45cf-a3e6-bac4faedf8aa` describes tick **10**, arrived at tick **31**, and was applicable with coalesced `salient_sound` and `head_milestone` reasons. The helper paused at tick **38**, with **zero experiences**.

Actual frame hash:

```text
f27aa1a25a3647f7d9e29f9172e89668328b9d1b08454aeb761910447e2ca1e0
```

Chrome displayed the explicitly selected experiment/run, received versus private source evidence, decision factors and the associated original-tick frame. The `ATTENTION_DECISION` filter returned two records. With other filters cleared, clicking **Caused by simulation:9** returned the three scoped `SOUND_RECEIVED`, `REFLEX_DECISION` and `ATTENTION_DECISION` records. A normal near-sound emission and single-step reached tick **39**. Fast-forward reached tick **69**, preserving activity cursor **24/600**; a manual Virtual Eyes capture at tick 69 succeeded. Dashboard screenshot: `diagnostics/phase2b-dashboard.jpg`.

The LIVE viewer visibly walked upright, idled at a waypoint and moved the door on slam. Articulated ears were compared with a stationary body/head in the paused experiment: neutral tick **69**, then a near-sound reflex at tick **70** and a visibly outward ear pose at tick **72**. Attention was ignored under cooldown while the immediate reflex still ran. Screenshots are `diagnostics/phase2b-ears-neutral.jpg` and `diagnostics/phase2b-ears-flick.jpg`.

Using normal **Disconnect viewer**, `/health` reported **zero viewers** at LIVE ticks **12,398** and **12,894**, in the same run `a2f7cc2d-151c-4152-93c4-2d05ac4d8d3b`. **Reconnect viewer** returned to the advancing existing world; displayed time advanced from the disconnected **4:21** to **7:18**. This proves live ticking while disconnected, rather than reconstructing time on reconnect.

Audio was enabled by the normal user gesture and the viewer reported sound enabled, but audible playback was **not independently heard** in this pass. The shortest remaining audio check is to open the viewer, press **Slam the door**, and listen for the impact. The owned demo process was shut down cleanly after inspection; its generated evidence remains available.

## Dashboard bundle and exact offline replay

The actual ZIP was exported through the normal dashboard control and inspected independently of the running page. Its manifest reports COMPLETE coverage, **61 records**, no gaps and no dropped evidence. All **13 entries** are text/JSON/replay data. Raw PNGs and encoded image payloads are absent; compact comparison state, original frame metadata/hash and causal links remain. The bundle includes the investigated cue and repeated-cue suppression case.

```powershell
npm.cmd run replay -- --bundle diagnostics/phase2b-spatial-attention.zip
```

Offline replay **PASS**: tick **38**, **4 inputs**, **33 deterministic events**, without Chromium. The same inspected archive was replayed again after the review fixes and kept all hashes below. Original output: `diagnostics/phase2b-artifact-replay.log`; accepted post-fix output: `diagnostics/phase2b-review-artifact-replay.log`. Use `npm.cmd` in PowerShell as shown so the bundle flag is forwarded correctly.

| Canonical evidence | Hash |
| --- | --- |
| State | `dc57a4b3c4cb66bf8c505cb4e37ce985679d5cb66a979ed3cf8e042c3a45c69c` |
| Events | `ca329b5724456e817fc9a0e4d790123df63a36bd597e1cde90ae61656f346bb3` |
| Runtime | `24bffce4aa2321385f497fc7378e5aa78e0637290e025dc45f94a89090c99fb6` |

The ZIP, screenshots, run directory and logs are generated local artifacts ignored by Git. `demo-session.json` and `scenario-result.json` locate the run and successful scenario; they do not substitute for the inspected archive.

## Corrections during verification and review

The initial canonical run passed **180/181**, catching a normal-slam reflex regression. Current rules now emit from the actual posed door-leaf centre through the generic surface-emission rule, retaining received thresholds. An initial existing real-renderer run passed **6/8** because two older assertions required source strength 1; they now require positive attenuated received strength and immediate onset. Final **181/181** and **8/8** results above passed after correction. Earlier failures remain distinguishable from final accepted evidence.

Focused review also corrected physical-wall acoustic grouping/emitting-surface handling, capture causal fields through sanitization/export, and deferred intention timing. Later causes cannot be attached to an earlier immutable capture, including before admission feedback executes. Targeted re-review accepted these boundaries without actionable findings.

The owner's additional PR #6 movement finding is fixed in current schema 4 with a swept segment check. A regression uses supported `hz=1`, `speed=5`, position `(2.6, 2.3)` and waypoint 0: the path cannot tunnel through `fixture-partial` despite a clear endpoint. Historical schema 3 keeps its original endpoint-only collision semantics for exact replay. The final normal suite includes this regression.

Hosted review of PR #7 then identified three P2 boundary defects. Capture restoration now waits for a queued admission acknowledgement to execute through the ordered input path before reconciling orphaned work, preserving capture-ID ownership. A rejected explicit head command no longer clears automatic ownership or grants developer priority. Inaudible cues no longer mutate, prune or evict the exposure summaries used for habituation. Five regressions cover these cases, bringing the normal suite to **186/186**. Lint/build, the actual attention renderer checks and the existing diagnostic ZIP replay passed after correction. Independent targeted boundary re-review accepted all three fixes. [Hosted Codex re-review of the corrected implementation](https://github.com/PHead2001/Autonomous-Lumi/pull/7#issuecomment-6503987525) completed cleanly with no new or actionable findings, and all three review threads are resolved. PR #7 remains open and unmerged for the owner.

## Material limits

Hearing is a normalized straight-ray game approximation. The 4×4 RGB signature may miss small changes and does not recognize objects. There are no model calls, semantic source identification, real autobiographical admission, learned associations, microphone input or hosting changes. Model-response metrics remain **N/A**. Audible playback is explicitly unverified. Stop before Phase 2c and leave merging to the owner.
