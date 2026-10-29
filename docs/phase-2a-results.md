# Phase 2a acceptance results

Virtual Eyes extends the existing fox-girl viewer and isolated laboratory with a shared physical scene, server-owned head/eye pose, deterministic turn/look/scan actions, an isolated on-demand Chromium renderer, and sight-limited spatial evidence. Operating instructions are in the [README](../README.md), [Virtual Eyes guide](virtual-eyes.md), and [renderer comparison](renderer-benchmarks.md).

The runtime, renderer, diagnostic export/replay and final normal checks below have completed. Independent local review and targeted re-review have no actionable findings remaining. Draft PR **#6** is open; hosted Codex review has been requested and remains pending.

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

The accepted local benchmark artifacts are under ignored `diagnostics/vision-benchmarks/phase2a-final/`. The actual renderer verification passed **6/6**, including physical/appearance checks on both backends, delayed snapshot identity, renderer crash/timeout and subsequent retry, continued world/reflex progress with zero viewers, and contained cleanup failure. The first actual frame was visually inspected.

## Browser and continuity evidence

The actual dashboard/viewer walkthrough used separate temporary test data, preserving the owner’s saved LIVE history. Lumi’s upright walking and idle transitions remained visible. The door control enabled browser audio; an articulated ear flick was visibly inspected in a paused experiment at tick **2241**. Audible output was not independently heard during this pass; the owner previously confirmed audio passes.

The final dashboard check recovered the saved head yaw of **−6°**, queued a directional look toward **−75°**, then advanced **25 fixed ticks**. An observed-target request outside the head’s limits was visibly rejected; this is rejection-path evidence, not a claim that target admission succeeded through the UI. A dark capture at tick **2265** produced zero eligible shapes; the lit capture at **2266** produced one. The inspected dashboard reported no console errors. The local private screenshot is `diagnostics/vision/phase2a-dashboard.png`.

The normal spectator slam control in the paused experiment also showed the door open at the first stepped tick **2267** and closed at **2270**. The upright two-legged avatar remained visible with the idle caption “taking a breath”; the viewer console error list was empty. The earlier tick-2241 inspection remains the articulated ear-flick evidence. These observations add no independent audible-output claim.

Disconnect/reconnect returned to the same running world. A separate zero-viewer CLI check observed LIVE advance from tick **6972** to **7011** in the same run, with the actual independent first-person capture fixed at tick **6991**. Advancement was observed while viewers were absent, rather than reconstructed after reconnection.

Historical Phase 1.5b and 1.5c diagnostic artifacts both replayed successfully with their original semantics. Current migration and recovery preserve history identity and existing state while adding the complete head/action/camera/scene fields. Frame bytes and renderer resource observations remain outside authoritative checkpoints.

## Diagnostic deliverable and final checks

The actual final dashboard export is **`diagnostics/phase-2a-virtual-eyes.zip`** (14,882 bytes, 13 entries), scoped to world `lumi`, branch `eyes-final`, run `9414a1b0-c050-4e62-8aae-7d800910fb1a`. It reports **COMPLETE** retained evidence for ticks **2238–2266**: 40 records, 3 ordered inputs and 11 deterministic events, with no declared gaps, drops or writer failures.

The ZIP’s reproduction notes, saved head/scene state, directional-look input, 25-tick fast-forward, capture metadata and assertions were inspected. Captures at ticks **2263**, **2265** and **2266** carry 512-square PNG format/hash/pose and the actual Chrome 156 / RTX 5070 Ti / ANGLE-D3D11 backend identity. Eligible-shape counts are **1 / 0 / 1**; the tick-2263 target request is explicitly rejected for exceeding head limits. No experience was encoded. The archive contains no raw image files or base64 pixel payloads. Generated diagnostics and raw private frames remain ignored by Git.

The documented offline command passed, ending at tick **2266**, with exact hashes:

| Evidence | SHA-256 |
|---|---|
| Complete runtime/control state | `6bd5c6b59c3b5bacf4c4df935a653c89c250d661692e6f9b5822a4ef915bb3e0` |
| Simulation state | `fff294efd2f7015373bde661896d6fc6c6679dcbba543765d382149163563373` |
| Deterministic events | `10cc4390af149da71c65226bbb1dddbc817ff14ee034cacb90003cc407bc8266` |

Offline replay reconstructs the recorded simulation and action path without a renderer. Capture metadata identifies the original image evidence; replay does not claim to regenerate pixels. Bundle completeness applies to its stated retained interval, not all prior history or browser hearing.

```powershell
npm.cmd run replay -- --bundle diagnostics/phase-2a-virtual-eyes.zip
npm test
npm run lint
npm run build
```

Final normal checks passed:

- `npm test`: **120/120**, approximately **9.78 seconds**.
- `npm run lint`: **PASS**.
- `npm run build`: **PASS**, including TypeScript checking. Vite retains the existing nonblocking chunk-size advisory above 500 kB.

The actual local logs are `diagnostics/phase2a-final-test-storage-fix.log`, `diagnostics/phase2a-final-lint-storage-fix.log` and `diagnostics/phase2a-final-build-storage-fix.log`. Passing results were reused; the logging benchmark matrix from the previous milestone was not rerun.

Independent ordinary UI review and the architect’s final targeted re-review found no actionable defects remaining after corrections. A real recorder concurrency failure—ENOENT/Windows EPERM during concurrent retention and publication—was fixed with a branch-scoped, process-local filesystem serializer. Its meaningful regression exercises eight writers across twenty flush rounds and compression. The final normal checks above include that fix. The serializer coordinates writers within the application process; existing data-directory ownership/lease protections remain the boundary against competing server processes.

Draft [PR #6](https://github.com/PHead2001/Autonomous-Lumi/pull/6) has been pushed and hosted `@codex` review requested. Hosted review is pending and is not reported as passed here. The owner retains the final merge decision.

## Material limits

There are zero model calls. A successful frame does not establish attention, understanding, recognition or autobiographical memory. LIVE’s synthetic-experience barrier remains in place. Sound attenuation, sound-driven head policies, automatic capture scheduling and visual interpretation remain later milestones.

Geometric visibility uses multiple samples and a conservative illumination/projected-size proxy. It is not a calibrated retinal model, exact visible-pixel fraction or semantic confidence. Engine identities and exact private geometry are confined to developer/replay evidence; filtered sensory output contains unknown shapes and scoped handles.

Rendering is not cross-GPU byte deterministic. PNG hashes identify actual returned bytes; canonical simulation state/event replay remains exact. The renderer comparison is short and sequential on one Windows desktop; no long-soak, hosting-cost, GPU-utilization or cross-platform resource guarantee is claimed. Renderer absence, timeout, crash or frame eviction is an explicit missing/stale observation while the simulation continues.
