# Phase 2a renderer comparison

The actual bounded run used the same [`createVisibilityFixture`](../shared/vision-fixture.ts) for both configurations. Reproduce it with:

```powershell
npm.cmd run vision:benchmark -- --out diagnostics/vision-benchmarks/my-run
npm.cmd run vision:verify
```

The benchmark writes PNGs, `benchmark.json` and `SUMMARY.md` under the selected ignored output directory. The accepted local run is `diagnostics/vision-benchmarks/phase2a-final/`. It started at **2026-10-29 13:55:41 UTC**. Each cell includes **two cold launches, one warm-up capture, five timed warm captures and a 1.2-second kept-warm observation**; cells lasted 3.68–4.49 seconds. No spectator browser or simulation is needed by the benchmark. Separate actual-server/browser checks establish LIVE continuity.

Environment: Windows 10.0.26200, Node 22.16.0, Chrome **156.0.8078.48**, Intel i7-13700K (24 logical CPUs), 31.7 GiB RAM, NVIDIA RTX **5070 Ti**. The WebGL backend strings were checked against the requested configuration:

- `angle-d3d11`: `ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 Ti ... Direct3D11 vs_5_0 ps_5_0, D3D11)`; flags `--use-gl=angle --use-angle=d3d11 --disable-software-rasterizer`.
- `swiftshader`: `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) ...), SwiftShader driver)`; flags `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`.

## Actual measurements

Latency is milliseconds; p95 is the maximum of these small samples. RSS is the sampled sum of the owned Chromium/esbuild process tree, excluding the benchmark and sampler. CPU peak is a sampled rate where **100% means one logical core**, so values can exceed 100%.

| Configuration | Size | Cold p50 / p95 | Warm p50 / p95 | Peak RSS MiB | Warm last RSS MiB | Peak CPU % | Warm sampled peak CPU % |
|---|---:|---:|---:|---:|---:|---:|---:|
| D3D11 | 256 | 571.4 / 723.9 | 13.3 / 14.1 | 803.1 | 796.2 | 233.7 | 4.5 |
| D3D11 | 512 | 608.0 / 611.1 | 15.3 / 16.0 | 799.4 | 799.4 | 308.8 | 8.7 |
| D3D11 | 1024 | 623.2 / 691.4 | 16.4 / 17.5 | 813.5 | 813.5 | 262.2 | below sampled resolution |
| SwiftShader | 256 | 692.6 / 741.0 | 52.7 / 56.8 | 843.9 | 810.0 | 490.0 | 88.4 |
| SwiftShader | 512 | 717.7 / 757.3 | 59.3 / 65.9 | 826.4 | 826.4 | 572.2 | 461.2 |
| SwiftShader | 1024 | 742.4 / 755.2 | 75.0 / 90.3 | 871.9 | 871.9 | 448.3 | 432.5 |

The JSON also retains observed cumulative CPU, benchmark-parent CPU, sample counts (8–10 tree samples per cell and 3–4 during each warm interval), individual backend identity, and GPU allocation observations. Process identity includes creation time: Windows can reuse parent PIDs, and older unrelated processes must not join the measured tree. A focused regression exercises that actual selection function. An initial measurement without this protection was discarded after implausible resource totals; its results were not used for selection.

## Correctness and lifecycle decision

Both configurations started successfully and passed the actual fixture checks: a visible red object, a yellow object visible around its center blocker, a hidden magenta object beyond a physical wall, an object outside the FOV, color-change output, and a black frame at zero illumination. The first frame was visually inspected. The actual renderer regression additionally checks closed/open door pixels and grounding, delayed snapshot reproduction, startup crash, request timeout, subsequent capture, zero-viewer world/reflex progress, and contained idle-cleanup failure.

All seven timed cold/warm images within each size/configuration had the same PNG hash. The cross-backend 512-square comparison had mean RGBA-channel difference **0.044/255**, maximum **43/255**, and **0.141%** of channels differed by more than 8. These are observations on this fixture, not a universal graphics tolerance. Pixel hashes identify the returned artifact; simulation replay hashes remain exact independently of GPU/driver rendering.

After each of five warmed captures, WebGL retained **one shared geometry and zero textures**. Per-capture geometry and shadow resources were released. The renderer process was killed and a subsequent explicit capture succeeded for each configuration.

The Windows default is **D3D11**, selected for the observed baseline warm latency and lower CPU demand. `LUMI_RENDER_BACKEND=swiftshader` explicitly selects the tested software path; other operating systems default to that explicit software configuration. Missing or unsuitable backends fail visibly rather than silently switching. Browser sandboxing is retained. SwiftShader's opt-in JIT flag carries Chromium's weaker security caveat; only this application's trusted, bundled render source is loaded, with external page requests blocked.

The renderer stays warm for **30 seconds after a capture**, then its owned browser process tree and temporary profile are removed. This avoids paying roughly 0.6–0.8 seconds for every adjacent developer capture while bounding the roughly 0.8 GiB measured resident cost to an idle window. This is not a claim about an affordable CPU-only VPS or an always-on service.

## Limits

Runs were short, sequential and local, with no CPU isolation or randomized order. CIM sampling can miss brief processes and fast CPU bursts; cumulative warm CPU includes coarse sample-boundary effects, while the warm rate column uses only pairs inside that interval (including the idle observation). RSS is a sampled peak, and shared memory can be counted in multiple process working sets. The software backend's CPU cost is visible; the hardware backend's short bursts are often below this sampler's resolution. GPU memory and GPU utilization are not measured. Resource sampling currently uses Windows CIM; another operating system needs an equivalent sampler before claiming comparable resource measurements. No long soak, hosting cost extrapolation or cross-GPU byte-determinism claim is made.
