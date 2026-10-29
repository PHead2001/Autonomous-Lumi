# Experiment laboratory

Start the existing app with `npm run dev` and open **http://127.0.0.1:5173/?view=dashboard**. The **Experiment laboratory** link in Lumi’s viewer opens the same developer view. A built viewer uses `npm run build`, `npm start`, and **http://127.0.0.1:3001/?view=dashboard**.

The header always names the selected world, branch, mode and current run. LIVE remains continuous at 1×. To change time or inject a test observation, first select a recorded checkpoint and **Fork experiment** under a new branch ID. The fork is automatically selected and runs at 6× by default. The **View selected room** link opens an explicitly scoped spectator view; the ordinary `/` viewer continues to subscribe to LIVE.

## A short experiment

1. Select LIVE, press **Record checkpoint**, choose that checkpoint, and fork `experiment-1`.
2. Press **Pause**. **Step one tick** advances exactly one logical tick and stays paused. **Resume** uses the selected speed without accumulating paused wall time.
3. While paused, start a generic activity with a small duration, such as 120 ticks. Step it, pause/resume the activity, and record another checkpoint. **Fast-forward** executes every intermediate fixed tick, yielding between bounded batches; **Cancel** stops the remaining request.
4. **Restore selected checkpoint** restores this experiment’s full simulation and control state in a new run. Run selection in the timeline keeps older evidence available. Controls carrying the old run cannot mutate the restored run. No experiment restore or experience-promotion control exists for LIVE.

Normal experiment playback defaults to **6×** and supports **1× through 30×**. **Requested unpaused speed** is a control setting; **Achieved** is measured from actual simulated advancement over monotonic host time. The dashboard shows sample duration and world seconds, and explicitly withholds the measured multiplier while paused, fast-forwarding, after host suspension, or while collecting a new sample. Catch-up loss and sustained underperformance are shown when observed. The ceiling is an admission limit, not a guarantee that every machine can sustain the requested speed. **Fast-forward** remains a separate bounded operation.

## Recovery and saved experiments

The **LIVE recovery** panel identifies the persisted LIVE history, its last successfully committed tick/world time and save timestamp, and the startup recovery point. A fallback to a previous valid generation and save failures are visible. Graceful shutdown commits a final recovery checkpoint. After abrupt termination, progress after the last committed checkpoint can be lost. Downtime does not advance world or subjective time. Recovery is independent from logging OFF and diagnostic evidence completeness.

Saved experiment checkpoints are discovered from disk under **Reopen a saved experiment**. After restarting the application, press **Refresh saved checkpoints**, select a checkpoint, enter a new experiment branch ID and press **Reopen saved experiment**. The new run is isolated from LIVE and every other experiment; previous active experiments do not restart automatically. Rejected catalog files are reported beside the selector. A saved speed above the supported normal-playback ceiling fails explicitly rather than silently changing history.

Older Phase 1.5b checkpoints may lack history metadata. The **Explicitly import a legacy checkpoint with unverified history** checkbox authorizes a deliberate experiment-only import; it is not a claim that the old checkpoint belongs to the current LIVE history. Recovery, first initialization, explicit checkpoint overrides and intentional fresh-world startup are described in the [README](../README.md). Automatic recovery never silently resets an existing corrupt or incompatible history.

The activity is a minimal tick-count task for testing saved progress and once-only milestone/completion effects. It does not introduce painting or a task planner.

## Synthetic observations and subjective time

The observation panel is labeled **TEST STUB** and is available only for experiments. It injects numeric fixtures; it is not evidence that Lumi saw, heard, attended to, or read something through real AI perception.

Only a fixture with **Sensed**, **Attended** and **Encoded** all checked can enter this experiment’s `FOX_EXPERIENCE`. An unchecked gate produces private diagnostic evidence about the gate outcome without creating a personal experience. The synthetic clock observation uses the same gates before recalibrating the estimate.

The dashboard shows exact authoritative tick/time and the imperfect subjective estimate with uncertainty in distinct cards. Calibration is labeled as a TEST STUB. Exact developer timestamps do not continuously become character knowledge. Civil time, DST, real watch reading, physiology and cognition remain outside this phase.

## Read and export evidence

Use the timeline’s **Run**, **Category**, **Event class**, **Component**, **Severity**, **Causal identifier**, tick range and search fields. Each row retains world/branch/run identity. Clicking a causal reference filters within the currently selected scope; equal local event numbers in another branch are not linked. The model metric is **N/A** because no model calls exist.

The four categories retain separate labels:

- `WORLD_TRUTH`: authoritative facts and effects.
- `FOX_EXPERIENCE`: only eligible encoded experiment TEST STUB observations.
- `PRIVATE_SENSOR`: measured cue and gate decisions.
- `OPERATIONAL_REPLAY`: controls, scheduling, transport and developer evidence.

**Export diagnostic ZIP** uses the selected branch/run and incident filters through the same exporter as the CLI. The response downloads a local ZIP and reports its evidence status and replay outcome. It does not claim browser playback merely because a notification was queued. A new export can be `INCOMPLETE` when records are disabled, dropped, evicted or unavailable; the dashboard shows health and declared gaps rather than certifying it.

For a compact controlled fault fixture, fork and pause an experiment, leave **Attended** unchecked, check **Encoded**, and inject a synthetic cue. The rejected eligibility gate is an intentional test fault. Step once, record a checkpoint, then export that experiment’s run. Inspect `SUMMARY.md`, `TIMELINE.md` and `manifest.json`, and use the bundle’s CLI reproduction instructions without the dashboard.

Logging OFF/default/verbose and optional closed-log compression are selected under **Flight recorder**. OFF affects evidence collection, not simulation progression or the eligibility gates. Unknown or missing evidence stays explicit. See [diagnostics.md](diagnostics.md) for CLI export/replay, bounds, retention, compression and the reproducible benchmark command.

## Access and failure feedback

The dashboard uses the existing local application boundary and same-origin requests. It is not a public hosting configuration. Mutations carry the explicitly selected world/branch/current run. Unknown targets, stale runs, invalid values or unsupported operations produce visible feedback and are not redirected to LIVE. Identifiers shown in rows and controls are always rendered as text, not interpreted as HTML.
