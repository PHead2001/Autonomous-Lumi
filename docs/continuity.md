# Phase 1.5c: local continuity and scheduler hardening

LIVE runs at 1×. An experiment defaults to 6× and accepts normal playback from 1× through the shared **30×** limit. Bounded fast-forward remains a separate paused operation using whole fixed ticks. Requested speed and achieved speed are separate dashboard fields. Achieved speed is actual simulated elapsed seconds divided by measured monotonic host seconds; paused, fast-forwarding, suspended and insufficient-sample states do not masquerade as measured normal playback. Catch-up loss and sustained underperformance are visible in the recorder and dashboard. The ceiling supplies scheduler headroom, not a throughput guarantee for every host.

Offline replay retains supported historical operations up to the former 60× limit with their original values and hashes. Starting an active experiment from a saved rate above 30× fails with an actionable error; there is no silent clamp or migration.

## Recovery guarantee and storage

The production entry point (`npm start`) and development watcher (`npm run dev`) automatically recover the latest valid committed LIVE recovery checkpoint. Graceful shutdown waits for a final commit. Abrupt termination recovers the last successful periodic commit; progress after that checkpoint may be lost. The default interval is 30 real seconds, configurable with `LUMI_RECOVERY_INTERVAL_MS` (100–3,600,000 ms). A failed save can widen the actual loss window; inspect the last successful save rather than assuming a fixed maximum.

`LUMI_DATA_DIRECTORY` defaults to `diagnostics/runs`. Authoritative recovery generations are stored under `.recovery/<historyId>/`, with a separate active-history pointer. Payloads are complete validated runtime envelopes: simulation, queued inputs/cursors, PRNG, subjective/activity state, controls and scheduler backlog. Saves are serialized, flushed to sibling temporary files and atomically published. The committed manifest retains the latest and previous generation. New history selection is published only after its first recovery checkpoint commits. Optional recorder retention and logging OFF cannot remove or disable these recovery saves.

The application entry point acquires an exclusive local OS lease for the canonical data directory before opening recovery data. A second process using that directory fails before it can replace a checkpoint, even when it chooses another HTTP port. Windows uses a named pipe, Linux an abstract local socket, and other platforms use a deterministic loopback lease endpoint with an explicit collision/busy error. Abrupt process termination releases ownership automatically. Linked/junction components below the selected data root are rejected for checkpoint and recovery storage.

`/health`, `/api/recovery` and the dashboard expose history ID, current run ID, last committed tick/world time/save timestamp, startup recovery point, fallback status and save errors. History ID persists across recovery; each process receives a new run ID. Identities and host timestamps are operational metadata outside canonical deterministic hashes. `checkpointAgeMs` measures the interval since the recovered checkpoint was saved, which includes any unsaved uptime before an abrupt stop; it is an upper bound on process downtime, not verified downtime. Host clocks rebase at activation, and no offline hours advance world or subjective time.

If the newest payload is corrupt or incompatible, the previous valid generation may be used only from the same committed history, with visible fallback. Corrupt/ambiguous identity or manifest, or no valid generation, fails startup and preserves the files. The application never interprets a recovery error as permission to start at tick zero.

## First initialization, import and deliberate reset

An empty data directory initializes a new history. Existing Phase 1.5b files without recovery metadata require a one-time intentional LIVE checkpoint import or a deliberate fresh history. No largest-tick search or cross-run lineage guess is performed.

Explicit `LUMI_CHECKPOINT` takes precedence over automatic recovery. It accepts a validated LIVE runtime envelope, a named LIVE wrapper with matching owner/mode, or an explicit legacy simulation schema 1 checkpoint. An experiment or bare lab simulation schema 2 cannot enter LIVE. Import creates a new history rather than claiming verified continuity of an unknown source:

```powershell
$env:LUMI_CHECKPOINT = 'C:\path\to\known-live-runtime.json'
npm start
# After stopping that intentional import, clear the override before the next launch:
Remove-Item Env:LUMI_CHECKPOINT
npm start
```

To deliberately initialize a fresh history while preserving older history directories:

```powershell
$env:LUMI_NEW_WORLD = '1'
npm start
# After stopping the intentionally fresh world, clear this before the next launch:
Remove-Item Env:LUMI_NEW_WORLD
npm start
```

You can instead set `LUMI_DATA_DIRECTORY` to a new empty directory. Reset/import never silently deletes the previous history. Keeping the reset or import variable set for later independent launches deliberately repeats that action. Within one development watcher session the override is consumed after the first successful start; subsequent source restarts recover that session's running history.

The development supervisor uses local IPC to request save-and-exit before replacing the Node child, including on Windows where process termination signals may be abrupt. It waits up to five seconds, then reports termination and the last-commit recovery boundary. This is local process recovery, not power-failure certification or always-on hosting.

## Reopen saved experiments

Named checkpoints continue to use `<data>/<world>/<branch>/checkpoints/`. Each new file has a unique ID, ownership/mode/history metadata and a complete runtime envelope. A successful catalog entry appears only after the file is persisted. Startup reuses existing same-history LIVE named checkpoints rather than adding one per restart.

Use the dashboard's **Saved experiment checkpoints** catalog after restart, select a source checkpoint and supply an unused experiment branch ID. Reopening explicitly creates a fresh EXPERIMENT run; it does not restart every old branch. Size (2 MiB), schema, identifiers, ownership, mode and history metadata are validated. The catalog is bounded to 64 branch directories and 256 files and reports invalid files. Nothing is automatically pruned to satisfy these bounds.

Bare Phase 1.5b runtime checkpoint files appear as legacy with unverified history. Enable the explicit legacy-import option only for the selected owned EXPERIMENT file. Import allocates an isolated experiment history and records `LEGACY EXPLICIT IMPORT` provenance. It does not assert lineage with LIVE. Wrong-mode or conflicting ownership fails, and a saved rate above 30× cannot be activated.

Restoring an active experiment prepares a dormant replacement and its failable writer initialization first. Preparation failure cleans the candidate and leaves the old branch usable. A successful guarded swap activates a new run before retiring the old runtime; stale controls and concurrent restore requests are rejected. Cleanup failure after the swap is reported while the working replacement stays active.

## Diagnostics and checks

Recovery and restore events are operational evidence. A successful recovery save proves a committed state checkpoint; it does not prove complete logs before a crash. Diagnostic ZIP manifests continue to declare replay completeness independently. Summary/timeline exports include recovery commits/failures, recovered points and restore preparation/retirement outcomes.

```powershell
npm test
npm run lint
npm run build
npm.cmd run replay -- --bundle diagnostics/your-incident.zip
```

The retained process tests use temporary data directories and exercise real graceful stop/start, abrupt termination and a real filesystem-triggered development watcher restart. The logging benchmark matrix is unchanged; this hardening pass does not rerun it without a new performance concern.
