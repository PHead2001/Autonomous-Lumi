# Autonomous Lumi — Spatial hearing and selective attention

An original low-poly fox girl wanders upright through a small browser room. Sound reaches her through distance and physical barriers; qualifying received sounds produce an immediate articulated ear reflex. Local attention adapts to repetition and current activity, uses bounded head movement, and requests limited first-person captures. One Node.js process owns the world and keeps updating with **zero browser viewers**. Fixed ticks, complete checkpoints, replay and a bounded flight recorder support isolated experiments and a local developer dashboard. No AI API, credentials, downloaded character assets, or database is required.

## Run locally

Requires Node.js 22 or newer and npm. In PowerShell:

```powershell
cd 'E:\Coding_Projects\Autonomous Lumi'
npm install
npm run dev
```

Open **http://127.0.0.1:5173** in a current desktop Chrome, Edge, or Firefox with WebGL enabled. The world listens on loopback port **3001**; Vite serves the viewer on **5173** and proxies its WebSocket. Keep the terminal running. `Ctrl+C` stops both processes. If 5173 is occupied, use Vite's printed viewer URL.

For a built viewer served by the same Node process:

```powershell
npm run build
npm start
```

Open **http://127.0.0.1:3001**. `PORT` overrides the server port; the development proxy assumes 3001.

## Try Phase 1

1. Watch Lumi walk on two legs and pause at waypoints. Her ears, hair, flared tunic, arms/hands, and bushy tail are original primitive geometry. Drag to orbit, scroll to zoom, and use **Reset view** for the default camera.
2. Press **Slam the door**. This activates browser audio, then sends the server a slam request. The door moves and a short impact plays. Both ear pivots flick independently when the sound received at Lumi meets the local intensity/onset threshold; distance and barriers affect that threshold. Slams are limited to one per 0.9 seconds. Other viewers hear new slams after activating audio with their own first button press.
3. Note the world time, **Disconnect viewer**, wait, and **Reconnect viewer**. Time and position jump to the existing world. Also try closing **all** viewer tabs and reopening the URL while leaving Node running. The simulation does not restart. Unintentional network disconnections retry automatically.
4. For a direct continuity check with all viewers closed, open `http://127.0.0.1:3001/health` twice: `time` and `tick` increase with `viewers` at zero. This is a small local diagnostic, not character knowledge.

Browsers require a user gesture for audio. A newly opened viewer never replays historical slams. If audio is unavailable, the viewer reports it and the visual reflex still works. Disconnection freezes the viewer's last state until reconnection; clients never advance the actual world.

## Checks

```powershell
npm test
npm run lint
npm run build
```

The build includes TypeScript checking.

## Phase 2b: hearing and attention

Open **http://127.0.0.1:5173/?view=dashboard** (port 3001 in built mode) and select a branch. **Hearing & selective attention** shows receiver-facing sound evidence separately from private source/propagation truth, the immediate reflex decision, attention factors, habituation, commitments and head outcomes. Automatic captures show coalesced reasons, host admission, original capture/receipt ticks, freshness, failures and the associated retained frame. Model-response metrics remain **N/A**.

To try controlled cues, record a checkpoint and fork an experiment, then expand **Experiment sound fixture**. Set a nearby source position, strength and suddenness and press **Emit experiment sound**. A paused experiment must step or resume. Repeat a similar received cue to inspect habituation, then change its perceived direction, onset or strength to test renewed attention. Start the existing generic activity to see commitment and interruption/resumption. LIVE rejects fixture emission and scene configuration. The original spectator door control remains available in the room viewer.

Automatic captures share the existing renderer: one automatic request may be outstanding globally, with a two-host-second global interval and five-host-second per-run interval. Logical cooldowns, world-time quotas, coalescing, backoff and freshness are checkpointed. Occasional low-resolution image probes compare rendered RGB evidence for visible change; hidden scene edits do not themselves become perceived novelty. Recorded asynchronous outcomes are ordered simulation inputs, so offline replay uses the original results without rendering again. Hearing and attention do not encode real personal experiences or identify a sound source semantically.

See [Spatial hearing and attention](docs/spatial-attention.md) for configuration, approximations, scheduling/freshness rules, recovery semantics and a reproducible demo. [Phase 2b results](docs/phase-2b-results.md) records the actual verification and diagnostic-bundle evidence.

## Phase 2a: Virtual Eyes

Open **http://127.0.0.1:5173/?view=dashboard** (or port 3001 in built mode), select a branch, and use **Virtual Eyes** to turn/look/scan, request an actual first-person frame, and inspect its captured tick, camera pose, scene version, PNG hash, backend and visibility evidence. **Look toward observed bearing** uses the captured coarse direction and Lumi's own turning, without tracking a target's true current position. Filtered sample visibility uses low/medium/high bands; exact geometric fractions stay in private diagnostics. A paused experiment must step/resume to advance queued head actions. Captures work with no spectator tabs open. LIVE remains at 1×; scene fixtures stay experiment-only. A successful capture supplies sensor evidence; it does not establish interpretation or personal memory.

Install desktop Chrome/Edge/Chromium for the isolated renderer; `npm install` does not download a browser. Set `LUMI_CHROMIUM_PATH` if the executable is outside a standard location. Windows defaults to measured ANGLE/D3D11; `LUMI_RENDER_BACKEND` can explicitly select `angle-d3d11` or `swiftshader` (the latter requires the trusted-local security opt-in described in the guide). See [Virtual Eyes setup and walkthrough](docs/virtual-eyes.md) and [Phase 2a results](docs/phase-2a-results.md) for head controls, zero-viewer CLI capture, renderer limits, benchmark reproduction, coordinate conventions, visibility limits and checkpoint compatibility. Current LIVE state upgrades without resetting its history or tick; old diagnostic replays retain their original semantics.

Tests cover the original browser/server lifecycle, movement and reflex behavior plus seeded randomness, strict checkpoint restore, ordered-input replay/hash matching, forbidden simulation randomness, bounded scheduler catch-up and injected multi-hour host gaps. Diagnostic tests cover the sanitized ZIP/replay path, bounded logging and writer failures.

## Phase 1.5b: isolated experiments

Open **http://127.0.0.1:5173/?view=dashboard** in development, or the same query on port 3001 in built mode. Select a branch, save its complete checkpoint, and fork a named experiment. LIVE stays at 1×; each experiment starts at 6× with independent state, PRNG, queues, counters, controls, scheduler and recorder. Experiments can pause, single-step, request normal playback through 30×, run bounded interruptible fast-forward, restore saved checkpoints and run a small generic cursor activity. The dashboard reports actual achieved playback separately from the requested multiplier. Controls require the selected world, branch and current run; stale runs and unknown targets fail visibly. Restore creates a new run.

The dashboard shows exact world ticks/time separately from a drifting subjective estimate and uncertainty. Synthetic cue/clock controls are labelled **TEST STUB** and only operate in experiments. Sensed, attended and encoded must all be true before a synthetic observation enters that branch's experience; an eligible clock stub recalibrates its estimate. This is a harness interaction, not visual watch reading. Diagnostic records cannot create personal experience, and experimental runtime or experiences cannot be restored into LIVE.

Timelines and causal links stay scoped to the chosen world/branch/run. Dashboard exports use the same sanitized ZIP and offline replay as the CLI. Logs, recorded checkpoints and exports live under `diagnostics/runs/<world>/<branch>/`; run rotation/retention is restricted to that branch's `runs/` directory. Checkpoints and exports have separate namespaces. The local registry holds up to eight branches, 32 saved checkpoints per branch and 32 dashboard exports per server process. LIVE now automatically recovers its last committed local checkpoint. Saved experiment checkpoints can be explicitly reopened from the disk catalog into fresh experiment runs; old active branches are not all restarted.

See [Dashboard walkthrough](docs/dashboard.md) and [Diagnostic export and replay](docs/diagnostics.md) for controls, filters, logging modes, optional compression, retention and the bounded benchmark command. `world_seconds_per_model_response` is **N/A** because no models are integrated.

## Deterministic time and restore

The simulation advances one integer tick per `Simulation.step()` at 30 ticks/second. World elapsed seconds are derived as `tick / hz`. Commands enter at a recorded receipt tick, receive a sequence, and execute at the next tick before movement. Invalid commands and cooldown/queue rejections remain part of the ordered evidence. No variable-delta simulation path is retained.

The host scheduler runs at most 8 LIVE steps per pump with 16 steps of backlog; experiment budgets are 48/96 so default 6× can handle ordinary jitter. Discarded catch-up is diagnosed. A monotonic or UTC gap of at least 5 seconds is detected before acceleration, freezes local world time across that gap and emits `HOST_SUSPEND`/`HOST_RESUME` diagnostics with observed downtime and skipped ticks. Paused experiments accumulate no catch-up. A gap can represent host sleep, a stall or a clock discontinuity; it is not simulated lived experience. Tests inject these clocks without sleeping the PC.

The complete private checkpoint contains the route cursor, pause/cooldown deadlines, PRNG seed/state, counters, pending inputs and rolling event hash. Simulation schema 2 adds subjective-clock/calibration state, gated synthetic experiences and generic activity effects; schema 3 adds head/camera/action/scan and physical-scene state. Current schema 4 adds hearing/attention adaptation, commitments, capture intentions, comparison baselines and ordered sensor feedback. The runtime envelope also saves mode, pause/speed, pending fast-forward, operation cursor and scheduler configuration/fractional backlog. Host clock baselines rebase on restore. Historical schema 1/2/3 replay retains its original semantics. Active worlds migrate new systems explicitly while preserving existing state and LIVE history. Invalid/incompatible checkpoints fail explicitly. New run identity resets sound deduplication after restore and rejects retired sensor results.

Current rules use the posed door leaf as the slam emitter and validate swept movement against physical colliders, including large supported fixed steps. Older-rule replay retains its recorded source and collision semantics. See the [hearing and compatibility details](docs/spatial-attention.md).

Authoritative TypeScript under `server/` and `shared/` must use the injected seeded PRNG; ESLint rejects `Math.random` recursively, including future nested modules. Browser presentation randomness such as synthesized audio in `src/audio.ts` is allowed. The two owner-supplied prompting/engineering reference files at the repository root are local-only and ignored by exact filename.

To start from an exported checkpoint in PowerShell:

```powershell
$env:LUMI_CHECKPOINT = 'C:\path\to\checkpoint.json'
npm start
```

Clear that environment variable to resume automatic recovery. To deliberately initialize a fresh history while preserving the previous one, set LUMI_NEW_WORLD=1 for that intentional launch and then clear it. Startup accepts a LIVE runtime envelope or an explicit legacy schema 1 checkpoint; bare lab snapshots and EXPERIMENT runtime envelopes are rejected for LIVE. `LUMI_SEED` sets a positive uint32 seed for new worlds. The injected xorshift32 stream is restorable; the existing waypoint policy deliberately does not consume random draws.

See [Diagnostic export and replay](docs/diagnostics.md) for CLI incident ZIP creation, selection, replay, log limits and coverage warnings. Generated `diagnostics/` output is ignored by Git.

Create and replay a real slam/invalid-command incident in PowerShell (`npm.cmd` preserves forwarded flags):

```powershell
npm.cmd run diagnostics:incident -- --out diagnostics/door-invalid-incident.zip
npm.cmd run replay -- --bundle diagnostics/door-invalid-incident.zip
```

## Small architecture

- `server/simulation.ts`, `prng.ts`, `canonical.ts`, `replay.ts`: fixed-step world, full checkpoints, ordered inputs and canonical hashes.
- `server/scheduler.ts`, `branch-runtime.ts`, `branch-registry.ts`, `world-server.ts`: branch ownership, bounded scheduling, controls, scoped WebSocket/HTTP API.
- `server/diagnostics/`: observational buffered flight recorder and sanitized incident ZIP CLI.
- `shared/protocol.ts`: lightweight viewer state and server-owned reflex presentation curve.
- `shared/physical-scene.ts`, `shared/eye-pose.ts`, `src/render-scene.ts`, `server/vision/`: shared physical room, deterministic eye pose, isolated first-person capture, filtered grounding and renderer benchmark/CLI.
- `src/`: Three.js room/avatar, interpolated presentation, Web Audio impact, connection controls.

LIVE continues with zero viewers and automatically recovers its last committed complete checkpoint after restart. Graceful shutdown commits final state; abrupt termination may lose progress since the last successful save (30 real seconds by default, longer after save failures). Startup fails visibly if existing history cannot be recovered; it never silently replaces it with a fresh world. See [Continuity and recovery](docs/continuity.md) for explicit reset/import commands, saved experiment reopening, playback limits and the precise loss boundary. This remains local process recovery, without always-on hosting. Cognition, semantic visual interpretation, real experience admission, learning and physiology remain deferred. Geometry/audio is generated by original code; dependencies retain their respective licenses. System fonts work if Google Fonts is unavailable.
