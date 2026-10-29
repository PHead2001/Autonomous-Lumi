# Phase 2a acceptance results

Virtual Eyes extends the existing fox-girl viewer and isolated laboratory with a shared physical scene, server-owned head/eye pose, deterministic turn/look/scan actions, an isolated on-demand Chromium renderer, and sight-limited spatial evidence. Operating instructions are in the [README](../README.md), [Virtual Eyes guide](virtual-eyes.md), and [renderer comparison](renderer-benchmarks.md).

Current verification passed **156/156 normal tests**, **8/8 actual renderer cases in one command**, lint and build/typecheck. Independent architect review accepted the Windows teardown hardening with no actionable findings; hosted code re-review of that latest correction is pending. The observed-direction correction's earlier clean review, renderer benchmark and browser evidence remain applicable as described below. [PR #6](https://github.com/PHead2001/Autonomous-Lumi/pull/6) remains open and ready, unmerged; the owner retains the merge decision.

## Run and try it

Requires Node.js 22+ and installed Chrome/Edge/Chromium. Renderer libraries install through npm; no browser download or external service is required.

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5173/?view=dashboard`. For built mode, run `npm run build`, then `npm start`, and open `http://127.0.0.1:3001/?view=dashboard`.

1. Select LIVE or an experiment and use **Virtual Eyes**. Submit a relative turn, directional look, scan or cancellation. Commands advance through fixed world ticks. A paused experiment must step or resume to apply them.
2. Press **Capture viewpoint**. The frame identifies its original tick, scene/state revisions, eye pose, reason, backend and actual PNG hash, even if the world has moved during rendering.
3. Inspect **Filtered observation**, then separately expand **Private developer world-truth comparison**. Shapes have unknown identity and observation-scoped handles; hidden objects do not enter the filtered output. Try **Look toward observed bearing** before its context expires.
4. Record a checkpoint, fork an experiment, pause it, and exercise the experiment scene fixture. Change illumination, material color or door override, step/resume, and request a fresh frame. LIVE rejects these fixture changes.
5. Close every spectator viewer and request a frame through the CLI below. The dashboard does not subscribe as a spectator. Reopen the room afterward to reconnect to the still-running LIVE world.

```powershell
$branches = (Invoke-RestMethod 'http://127.0.0.1:3001/api/branches').branches
$live = $branches | Where-Object mode -eq 'LIVE' | Select-Object -First 1
npm.cmd run vision:capture -- --url http://127.0.0.1:3001 --world $live.worldId --branch $live.branchId --run $live.runId --size 512 --out diagnostics/vision/live.png
```

`LUMI_CHROMIUM_PATH` overrides the browser executable. Windows defaults to measured ANGLE/D3D11. `LUMI_RENDER_BACKEND=swiftshader` deliberately selects the tested software configuration, including Chromium’s explicit trusted-local SwiftShader security opt-in. The renderer retains its browser for at most 30 idle seconds after a capture, then removes its owned process tree/profile. See the guide for exact settings and failure behavior.

## Actual renderer comparison

The accepted six-cell comparison used the same fixed fixture for D3D11 and SwiftShader at 256, 512 and 1024 square pixels. Each cell included two cold launches, one warm-up, five timed warm captures and a 1.2-second kept-warm observation. The full table, environment, actual backend strings, child-process CPU/RSS sampling and limitations are in [Renderer comparison](renderer-benchmarks.md).

| Baseline 512×512 | Cold p50 / p95 ms | Warm p50 / p95 ms | Sampled peak RSS MiB | Warm sampled peak CPU % |
|---|---:|---:|---:|---:|
| ANGLE/D3D11 | 608.0 / 611.1 | 15.3 / 16.0 | 799.4 | 8.7 |
| Explicit SwiftShader | 717.7 / 757.3 | 59.3 / 65.9 | 826.4 | 461.2 |

CPU 100% means one logical core. Measurements include the owned Chromium/esbuild process tree, exclude the benchmark/sampler, and are short local observations rather than hosting guarantees. The Windows default was selected from these results: D3D11 had lower baseline warm latency and CPU demand. Both configurations started successfully and exercised actual pixels, occlusion, darkness, door pose and appearance changes. Matching hashes within a backend identify repeatable artifacts for this fixture; cross-backend pixel differences are reported separately from exact simulation replay.

```powershell
npm.cmd run vision:benchmark -- --out diagnostics/vision-benchmarks/my-run
npm.cmd run vision:verify
```

The accepted local benchmark artifacts are under ignored `diagnostics/vision-benchmarks/phase2a-final/`. The latest **`npm run vision:verify` passed 8/8 in one command**, approximately **17.90 seconds**, recorded in `diagnostics/teardown-final-real-reallocated.log`. This includes physical/appearance checks on both backends, delayed snapshot identity, renderer crash/timeout and subsequent retry, continued world/reflex progress with zero viewers, contained cleanup failure, refusal of an eye inside an opaque occluder followed by a successful safe capture, and a surviving profile process that remains an explicit cleanup failure until a later retry succeeds. The teardown verification sequence is detailed below. The first actual benchmark frame was visually inspected.

## Browser and continuity evidence

The actual dashboard/viewer walkthrough used separate temporary test data, preserving the owner’s saved LIVE history. Lumi’s upright walking and idle transitions remained visible. The door control enabled browser audio; an articulated ear flick was visibly inspected in a paused experiment at tick **2241**. Audible output was not independently heard during this pass; the owner previously confirmed audio passes.

The initial dashboard acceptance check recovered the saved head yaw of **−6°**, queued a directional look toward **−75°**, then advanced **25 fixed ticks**. An observed-target request outside the head’s limits was visibly rejected; this is rejection-path evidence, not a claim that target admission succeeded through the UI. A dark capture at tick **2265** produced zero eligible shapes; the lit capture at **2266** produced one. The inspected dashboard reported no console errors. The local private screenshot is `diagnostics/vision/phase2a-dashboard.png`. These checks are distinct from the refreshed post-review bundle below.

The normal spectator slam control in the paused experiment also showed the door open at the first stepped tick **2267** and closed at **2270**. The upright two-legged avatar remained visible with the idle caption “taking a breath”; the viewer console error list was empty. The earlier tick-2241 inspection remains the articulated ear-flick evidence. These observations add no independent audible-output claim.

Disconnect/reconnect returned to the same running world. A separate zero-viewer CLI check observed LIVE advance from tick **6972** to **7011** in the same run, with the actual independent first-person capture fixed at tick **6991**. Advancement was observed while viewers were absent, rather than reconstructed after reconnection.

Historical Phase 1.5b and 1.5c diagnostic artifacts both replayed successfully with their original semantics. Current migration and recovery preserve history identity and existing state while adding the complete head/action/camera/scene fields. Frame bytes and renderer resource observations remain outside authoritative checkpoints.

## Diagnostic deliverable and final checks

The retained dashboard acceptance export is **`diagnostics/phase-2a-virtual-eyes.zip`** (14,625 bytes, 13 expected text/JSON entries), scoped to world `lumi`, branch `eyes-reviewed`, run `f6437afa-1c77-4a3e-959a-41836aae00bc`. It reports **COMPLETE** retained evidence for ticks **2238–2265**: 37 records, 3 ordered inputs and 11 deterministic events, with zero gaps, dropped/critical-dropped records, writer failures or evictions. The previous artifact is preserved separately as `diagnostics/phase-2a-pre-clearance.zip`. This bundle was recorded under `lumi-eyes-v1`; it remains historical replay evidence rather than proof of the later observed-direction correction.

The reproduction guidance, saved head/scene checkpoints and all 13 archive entries were inspected. Three 512-square PNG captures report the actual ANGLE/D3D11 / Chrome 156 / RTX 5070 Ti backend:

| Captured tick | Illumination | Eligible shapes | Actual frame SHA-256 |
|---|---|---:|---|
| 2263 | Lit | 1 | `845d332feec825b15534f96e2150ab162e451415ffddedec631c815261a6e637` |
| 2264 | Dark | 0 | `9df7f9e9f29c47591d050a8ab4aff403dc1dfd94e5bb1ae18de02ec78238b2ea` |
| 2265 | Lit | 1 | `a7846647529c29427caacadb3c142c325714fd80dfa803373c3a3fce62f27dbe` |

That historical bundle contains no target-rejection event; the earlier target-rejection browser observation remains a separate valid check. Both saved checkpoints contain zero experiences, no `FOX_EXPERIENCE` record was produced, and the archive contains no raw image or base64 payload. Generated diagnostics and private frames remain ignored by Git.

The documented CLI replay passed at tick **2265**, with exact hashes:

| Evidence | SHA-256 |
|---|---|
| Complete runtime/control state | `512cd09324ee54da29ca6a9abe6be14a166f2cc15d957744b41ac841af0b6742` |
| Simulation state | `9531f27cd9cf72e54e56358a4b06445c0ffa4c72f632fe99878f66c8945f79cc` |
| Deterministic events | `70ed6baa8319c117a2861f6f3202de398e9a7b39d6692569b61eff5f0a8043f5` |

Offline replay reconstructs the recorded simulation and action path without a renderer. Capture metadata identifies the original image evidence; replay does not claim to regenerate pixels. Bundle completeness applies to its stated retained interval, not all prior history or browser hearing.

```powershell
npm.cmd run replay -- --bundle diagnostics/phase-2a-virtual-eyes.zip
npm test
npm run lint
npm run build
```

The final Windows teardown correction checks passed:

- `npm test`: **156/156**, approximately **9.54 seconds**, recorded in `diagnostics/teardown-final-tests-reallocated.log`.
- `npm run lint`: **PASS**, recorded in `diagnostics/teardown-final-lint.log`.
- `npm run build`: **PASS**, including TypeScript checking, recorded in `diagnostics/teardown-final-build.log`. Vite retains the existing nonblocking approximately 540 kB viewer-chunk advisory above 500 kB.
- `npm run vision:verify`: **8/8 in one command**, approximately **17.90 seconds**. The full result is described above.

The normal suite includes the earlier deadline regressions: automatic completion after 95 seconds, a bounded 105-second deadline, and fresh budgets for later captures after an earlier deadline or terminal result. It also covers captured-direction aiming, active motor-anchor restore, migration, historical replay and the new cleanup result/stream/profile-query regressions.

The renderer benchmark remains valid and was reused; the logging benchmark matrix from the previous milestone was not rerun.

Independent ordinary UI review accepted the dashboard. A real recorder concurrency failure—ENOENT/Windows EPERM during concurrent retention and publication—was fixed with a branch-scoped, process-local filesystem serializer. Its meaningful regression exercises eight writers across twenty flush rounds and compression. The serializer coordinates writers within the application process; existing data-directory ownership/lease protections remain the boundary against competing server processes.

Hosted Codex review of [PR #6](https://github.com/PHead2001/Autonomous-Lumi/pull/6) initially raised two P2 findings: the CLI wait needed to cover admitted queue delay and cleanup, and camera/near-plane clearance needed to prevent a viewpoint clipping through opaque geometry. Both were corrected, retained focused regressions, and passed independent architect re-review. A subsequent review found that the dashboard still used a shorter deadline. The CLI and dashboard now import one shared **105-second** queue/cleanup/transport calculation; the dashboard associates its deadline with the capture ID and clears it on a terminal result, so the next capture cannot inherit an old expired budget.

Navigation reserves approximately **0.498 world units** for the baseline head/eye/near-plane envelope and the normal door’s future slam sweep; actual captures validate their clipping volume against the physical scene. Saved schema-2 positions/history survive migration, with deterministic escape from a newly introduced future-only reserve instead of resetting or teleporting the character. Invalid capture geometry now records an explicit request/snapshot/failure/timing path without rendering, exposing a frame or encoding experience. Those admission and dashboard deadline corrections passed independent re-review. That earlier hosted Codex round reported **no findings and no unresolved findings**; its three superseded GitHub review threads were resolved after their fixes and that clean result were verified.

## Observed-direction review correction

A later review found that observation-scoped aiming re-measured an object's true current bearing and checked true visibility again. Current `lumi-eyes-v2` actions instead use the captured 15° bearing/elevation and captured head/body orientation. They compensate only for Lumi's own orientation changes, including body turns before execution and throughout the bounded motor action. The checkpointed `head.observedAim` retains that coarse world-direction anchor through mid-turn restoration. A body turn that places the direction outside anatomical limits cancels the action and holds the current local head pose; it does not clamp or reacquire true geometry. A body translation or a target becoming hidden does not grant a newer or more precise target direction. A new capture can reveal that the shape is no longer visible. World/branch/run, retained handle, 300-tick age, scene-revision and anatomical limits remain enforced.

Filtered shapes expose only `sampleVisibilityBand` (`low`, `medium` or `high`), using one-third/two-thirds thresholds. Exact 27-ray fractions stay in private diagnostics. This geometric sensor approximation produces no `FOX_EXPERIENCE`; future experience/memory must use the proper perceptual, attention and encoding path rather than copying geometric scene truth.

The rules change keeps checkpoint schema 3 and runtime schema 2. Active upgrades preserve history, tick, pose, counters and queued ordering; original recovery data is archived as `pre-vision-rules-v1-…` and `STATE_RULES_MIGRATED` records the old and new rules. A legacy queued private-ID target is rejected explicitly at its original execution tick because no captured coarse bearing exists to reconstruct. Existing motor turns/scans continue from committed state. Historical `lumi-eyes-v1` replay retains its original semantics and hashes.

Independent architect review accepted this correction with no actionable findings. Hosted code re-review of the pushed correction and documentation also completed with **no findings and no unresolved findings**. This refreshed code review does not represent a new security scan. The renderer benchmark is unchanged and remains reusable.

The actual corrected-rules diagnostic artifact is **`diagnostics/observed-aim-regression.zip`** (14,732 bytes). Its 13 entries were inspected: **COMPLETE** coverage for ticks **0–24**, 67 records, 2 ordered inputs and 8 deterministic events, with zero gaps, dropped records, writer failures or evictions. A real Chrome 156 / NVIDIA ANGLE/D3D11 capture supplies the observation. After a 10° head turn, the targeted action uses the captured **−15°** coarse bearing; normalized current action evidence contains no engine target ID. The sanitized ZIP contains no image payload and no experiences.

The standard CLI replay passed with exact hashes:

| Evidence | SHA-256 |
|---|---|
| Complete runtime/control state | `1d3ad2ea7f0d6a276703bf3cb0522c95f56ef6063c95689cde09c67e8f3f1e79` |
| Simulation state | `0d52082f7a817523037864da71fd848db364ad94e73ba889323232507a266d86` |
| Deterministic events | `79389f3f3948dbf6400c22a60116ac3496828e91c3895b118d20a4819e63c267` |

```powershell
$env:LUMI_AIM_DIAGNOSTIC_OUT = Join-Path (Get-Location) 'diagnostics/observed-aim-regression.zip'
npx.cmd tsx --test --test-name-pattern '^captured coarse target commands' tests/vision-observed-aim.test.ts
Remove-Item Env:LUMI_AIM_DIAGNOSTIC_OUT
npm.cmd run replay -- --bundle diagnostics/observed-aim-regression.zip
```

The environment variable explicitly selects the real renderer for this bounded fixture; the ordinary test uses a stub. Logs are `diagnostics/observed-aim-{tests,lint,build,renderer,historical-replay,artifact}.log`. The retained `lumi-eyes-v1` acceptance ZIP was also replayed again and kept its original runtime hash `512cd093…b6742`.

## Windows teardown hardening

Two instrumented baseline `vision:verify` runs both passed. They nevertheless observed `taskkill` exit code 128 followed by the owned Chromium root exiting **35–53 ms** later. These were passing baseline runs, not failed renderer suites.

The narrow correction reconciles only a normally exited, nonzero helper result. It requires bounded owned-root exit and a read-only exact-profile absence check. UTF-8 output must be complete before a query can prove absence. Helper timeout/launch/signal failure, query failure and a surviving profile process remain explicit failures, retaining child/profile ownership for a later explicit retry. Profile-query PIDs never become termination targets. An already-exited root also retains profile ownership until absence is proved.

Three consecutive full **8/8** real-renderer runs passed in **19.02, 19.88 and 18.55 seconds** (`diagnostics/teardown-final-real-{1,2,3}.log`). The final encoding correction also passed actual Unicode-profile and stream regressions. A subsequent parallel normal-suite run exposed a **750 ms query deadline** that was too short: **154/155** passed, with the failure retained in `diagnostics/teardown-final-tests.log`. The budget was reallocated to **500 ms** for root-exit reconciliation and **1,250 ms** for the profile query plus **250 ms** to terminate an overdue query; the existing two-second helper and five-second manager budgets remain unchanged. A loaded query measured **815.8 ms**, confirming why the previous allowance was insufficient.

After that timing correction, the final **156/156** normal suite, lint/build/typecheck and another full **8/8** actual renderer run passed as listed above. Exact matching was exercised with Unicode, spaces and prefix-confusable profile paths. Independent architect re-review accepted the stream/encoding and final timing corrections with no actionable findings; hosted code re-review is pending. No new security scan is claimed. The aiming/replay artifacts and renderer benchmark were reused; no new browser audible-output claim is made.

## Material limits

There are zero model calls. A successful frame does not establish attention, understanding, recognition or autobiographical memory. LIVE’s synthetic-experience barrier remains in place. Sound attenuation, sound-driven head policies, automatic capture scheduling and visual interpretation remain later milestones.

Geometric visibility uses multiple samples and a conservative illumination/projected-size proxy. It is not a calibrated retinal model, exact visible-pixel fraction or semantic confidence. Engine identities and exact private geometry are confined to developer/replay evidence; filtered sensory output contains unknown shapes and scoped handles.

Rendering is not cross-GPU byte deterministic. PNG hashes identify actual returned bytes; canonical simulation state/event replay remains exact. The renderer comparison is short and sequential on one Windows desktop; no long-soak, hosting-cost, GPU-utilization or cross-platform resource guarantee is claimed. Renderer absence, timeout, crash or frame eviction is an explicit missing/stale observation while the simulation continues. The conservative clipping-volume bounding-sphere guard can reject unusual lens configurations; it fails visibly rather than granting an unsafe view.
