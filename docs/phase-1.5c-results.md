# Phase 1.5c continuity and scheduler hardening results

Operating instructions are in the [README](../README.md), [continuity guide](continuity.md), [dashboard guide](dashboard.md) and [diagnostics guide](diagnostics.md).

## Recovery guarantee

Graceful shutdown commits a final complete LIVE checkpoint. Abrupt termination resumes the last successfully committed checkpoint, preserving history identity and allocating a new runtime run ID. Downtime does not advance authoritative or subjective world time. The default periodic interval is 30 real seconds; progress after the last committed save can be lost, and save failures can widen that window. The health response and dashboard expose the successful save point and failures. Checkpoint age includes any unsaved uptime before a crash and is not measured downtime.

Recovery publication is atomic and serialized, with a previous valid generation retained. Invalid existing history produces a visible fallback or explicit failure, never a silent new life. Logging OFF does not disable recovery. Older Phase 1.5b history needs an explicit first import; saved experiment checkpoints can be deliberately reopened into new isolated experiment runs. Reset/import commands and their preservation boundaries are documented in the continuity guide.

## Checks actually run

- Final normal suite: **83/83 tests passed**. `npm run lint` and `npm run build` passed; build includes typechecking and retains the nonblocking Three.js bundle-size advisory.
- Actual process tests exercised graceful restart, abrupt termination and development watcher restart with temporary data directories. The owner's LIVE history and checkpoints were not used as test fixtures.
- The actual Phase 1.5b diagnostic ZIP still replayed successfully with its original runtime hash, demonstrating compatibility with that recorded artifact.
- Focused regressions cover active speed admission, observational rate states, recovery publication/failure/fallback, history and mode isolation, named checkpoint reopening, transactional restore, process ownership/containment, captured dashboard controls and export selection.

## Browser and runtime evidence

The walkthrough used a separate temporary data directory on port **3002**, preserving the owner's LIVE data. At requested 30×, the measured report showed **30.0021159×**, derived from **30.433333 world seconds / 1.0143729 monotonic host seconds**. A 60× request produced a visible rejection; paused playback withheld an achieved multiplier. This is a short actual-runtime check, not a general throughput guarantee. The nine-cell logging benchmark was not repeated.

A real filesystem-triggered development restart retained history `ee594aff…`, allocated a new run and recovered tick **6698**. A later final restart recovered tick **25518**. A saved experiment was reopened from disk at tick **39819**, paused at requested 30×, under a fresh branch/run.

The LIVE viewer showed walking and idle transitions, accepted the slam control and browser audio activation, and automatically reconnected. Audible output was not independently heard during this walkthrough. Ear/reflex rendering and audio synthesis code remain unchanged from previously accepted checks; screenshots in this pass were not precisely timed to independently measure the brief ear motion.

## Actual diagnostic deliverable

The dashboard exported `diagnostics/phase-1-5c-recovery.zip`. Its summary and evidence were inspected. It reports **COMPLETE** coverage for ticks **25518–25844**; CLI replay passed with **2 deterministic events** and runtime hash:

```text
f6225e89c02fcd703f24aeffd53524f160d8e99b33da0c308c1f5bf472100863
```

```powershell
npm.cmd run replay -- --bundle diagnostics/phase-1-5c-recovery.zip
```

The bundle explains its recovery point. Successful checkpoint recovery does not establish complete diagnostic replay of pre-crash history: this bundle's completeness applies to its stated recovered-run range. Generated ZIPs and recovery data remain ignored by Git.

## Review outcome and limits

Independent focused Codex review, fixes and targeted re-review completed with no actionable findings remaining. Accepted corrections included dormant replay behavior, suspension telemetry, retirement-cleanup feedback, exclusive process ownership, parent-junction containment, form payload capture before busy rendering, and pinned LIVE export checkpoints.

The implementation remains local recovery with a bounded loss window, not recovery to the exact crash instant or always-on hosting. No Phase 2 capability or new long-running benchmark program was added.
