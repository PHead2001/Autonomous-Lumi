# Phase 1.5b acceptance results

The isolated experiment laboratory extends the existing Phase 1 viewer and Phase 1.5a deterministic server. Setup and controls are documented in the [README](../README.md), [dashboard guide](dashboard.md) and [diagnostics guide](diagnostics.md).

## Functional evidence

- The settled full suite passed **48/48**; four later UI selection-helper regressions passed **4/4** (52 covered tests across those runs, not one full 52-test run). Affected lint and build checks passed. Build includes typechecking and retains the nonblocking Three.js bundle-size advisory.
- Browser walkthrough checked explicit branch/run scope, experiment controls, checkpoint restore into a new current run, timeline filters, scoped causal links, `world_seconds_per_model_response = N/A`, and logging OFF reporting incomplete evidence.
- The viewer showed upright fox-girl geometry with arms/hands and tail, walking and idle transitions, door movement and a bent-ear reflex pose after a slam. Disconnect/reconnect worked and no viewer console warnings/errors were observed.
- Explicit experiment-viewer subscription showed branch `acceptance-final` at 1:01, distinct from LIVE. Browser resume/pause controls were also verified on a sibling experiment.
- LIVE advanced with zero viewers from tick 4283 to 4468 in the same run (`84ec4923` prefix), then reconnected. This observes advancement before reconnection rather than reconstructing elapsed time afterward.
- Audio was previously confirmed audible by the owner. Current browser audio activation was verified; audible output was not independently heard in this walkthrough.
- Independent targeted review accepted five backend boundary fixes and the restore-selection race fix. The architect accepted the final selection-helper integration review with no actionable findings. Final built-browser restore of a sibling experiment selected its new current run (`7d29569e` prefix).

## Actual dashboard incident

The dashboard downloaded a sanitized fault bundle for UI incident `97d1665c`. The local generated deliverable is `diagnostics/phase-1-5b-dashboard-fault.zip`; generated diagnostics are ignored by Git and are not embedded in this tracked report.

The controlled case begins with saved activity cursor 5/10 and resumes to 10/10 with completion count 1. A sensed but unattended TEST STUB cue remains outside `FOX_EXPERIENCE`. An eligible synthetic clock observation supplies 80 seconds with 0.5 seconds uncertainty; authoritative world time is separately 61.367 seconds.

The 13-entry ZIP was inspected, including its recorded operations, exact replay command, gating and completion expectations. Its included restoration path was exercised:

```powershell
npm.cmd run replay -- --bundle diagnostics/phase-1-5b-dashboard-fault.zip
```

Result: **PASS**, ending tick 1841, 8 deterministic events, with runtime/control hash:

```text
d2c1b82ba3bb5c8a8cd74880a75aaebb7bee859feb3756d10fad7d790a130df6
```

The bundle includes complete simulation/runtime checkpoints, ordered operations, causal records, coverage and integrity hashes, and case-specific reproduction notes. Recorder notifications establish transport evidence; the bundle does not claim to observe browser display or hearing.

## Actual bounded logging matrix

```powershell
npm.cmd run diagnostics:benchmark -- --duration-ms 2000 --out diagnostics/benchmarks
```

The actual nine-cell run is recorded in `diagnostics/benchmarks/20261029041833774/SUMMARY.md` and `benchmark.json` (ignored generated files). Each cell lasted 2019–2033 ms. All modes/scales produced matching state/event hashes at logical tick 58 using the same seeded activity, cue/clock and door-input fixture. There were **zero dropped records**. OFF deliberately reports `INCOMPLETE`; default/verbose recorder health remained healthy.

| Pace / mode | Ticks | Actual ticks/s | Tick p50 / p95 ms | CPU ms | RSS MiB before→after | Heap MiB before→after | Disk KiB | Max writer records |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
|1× OFF|60|29.6|0.0170 /0.0922|15|63.91→65.14|7.99→8.31|3.87|0|
|1× default|60|29.7|0.0155 /0.0953|63|65.16→66.76|8.45→8.92|18.12|11|
|1× verbose|60|29.6|0.0646 /0.1138|63|66.78→68.62|9.07→10.87|42.18|14|
|6× OFF|360|178.6|0.0057 /0.0484|62|68.62→60.26|11.00→7.90|3.92|0|
|6× default|360|178.6|0.0059 /0.0761|46|60.38→59.30|8.15→8.22|35.17|24|
|6× verbose|360|178.2|0.0183 /0.0769|157|59.33→59.20|8.45→7.90|180.91|43|
|30× OFF|1800|893.0|0.0033 /0.0187|109|59.20→60.08|8.11→7.89|3.97|0|
|30× default|1800|888.0|0.0039 /0.0153|141|60.08→61.52|8.50→8.17|109.27|41|
|30× verbose|1800|891.5|0.0105 /0.0631|672|61.52→64.88|8.79→9.83|858.51|186|

Maximum observed scheduler backlog was 1/3/15 ticks at 1×/6×/30×. The harness yielded after at most 32 whole steps. Verbose 30× increased CPU and disk use; measured tick p95 stayed below 0.1 ms in that stress cell and queues remained bounded without weakening limits.

Environment: Node 22.16.0, Windows build 10.0.26200, Intel Core i7-13700K, 24 logical CPUs and approximately 31.7 GiB RAM. Cells were short and sequential in one local process, without CPU isolation or warm/cold randomization. The 1× p95 has only 60 samples. Memory values are endpoints, not peaks; CPU includes asynchronous writing/final flush, while tick latency measures step plus recorder enqueue. Requested scale is harness pacing intent; achieved throughput is shown separately. These results do not certify production host-suspend behavior or a long soak.
