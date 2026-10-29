# Autonomous Lumi — Phase 1 + 1.5a

An original low-poly fox girl wanders upright through a small browser room. A door slam produces a synthesized impact and a deterministic articulated ear reflex. One Node.js process owns the world and keeps updating with **zero browser viewers**. Phase 1.5a adds fixed ticks, complete restorable checkpoints, deterministic replay, explicit host-sleep handling and a bounded diagnostic flight recorder. No AI API, credentials, downloaded character assets, or database is required.

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
2. Press **Slam the door**. This activates browser audio, then sends the server a slam request. The door moves, a short impact plays, and both ear pivots flick independently. Slams are limited to one per 0.9 seconds. The generic reflex uses sound intensity and suddenness without model calls. Other viewers hear new slams after activating audio with their own first button press.
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

Tests cover the original browser/server lifecycle, movement and reflex behavior plus seeded randomness, strict checkpoint restore, ordered-input replay/hash matching, forbidden simulation randomness, bounded scheduler catch-up and injected multi-hour host gaps. Diagnostic tests cover the sanitized ZIP/replay path, bounded logging and writer failures.

## Deterministic time and restore

The simulation advances one integer tick per `Simulation.step()` at 30 ticks/second. World elapsed seconds are derived as `tick / hz`. Commands enter at a recorded receipt tick, receive a sequence, and execute at the next tick before movement. Invalid commands and cooldown/queue rejections remain part of the ordered evidence. No variable-delta simulation path is retained.

The host scheduler runs at most 8 steps per pump, retains at most 16 steps of backlog, and records discarded short-jitter catch-up. A monotonic or UTC gap of at least 5 seconds freezes local world time across that gap, emits linked `HOST_SUSPEND`/`HOST_RESUME` diagnostics with observed wall downtime and skipped ticks, then resumes ordinary stepping. A gap can represent host sleep, a stall or a clock discontinuity; it is not simulated lived experience. Tests inject these clocks without sleeping the PC. `createWorldServer` accepts scheduler configuration for local integration; the fixed rate comes from the checkpoint configuration.

The complete, versioned private checkpoint contains the route cursor, pause/cooldown deadlines, PRNG seed/state, sound and event/input counters, pending inputs and rolling deterministic event hash. It is separate from public viewer snapshots. Invalid/incompatible checkpoints fail explicitly. A new hosted run has a new identity so restored sound counters do not defeat browser deduplication.

To start from an exported checkpoint in PowerShell:

```powershell
$env:LUMI_CHECKPOINT = 'C:\path\to\checkpoint.json'
npm start
```

Clear that environment variable to start a fresh world. `LUMI_SEED` sets a positive uint32 seed for new worlds. The injected xorshift32 stream is restorable; the existing waypoint policy deliberately does not consume random draws.

See [Diagnostic export and replay](docs/diagnostics.md) for CLI incident ZIP creation, selection, replay, log limits and coverage warnings. Generated `diagnostics/` output is ignored by Git.

Create and replay a real slam/invalid-command incident in PowerShell (`npm.cmd` preserves forwarded flags):

```powershell
npm.cmd run diagnostics:incident -- --out diagnostics/door-invalid-incident.zip
npm.cmd run replay -- --bundle diagnostics/door-invalid-incident.zip
```

## Small architecture

- `server/simulation.ts`, `prng.ts`, `canonical.ts`, `replay.ts`: fixed-step world, full checkpoints, ordered inputs and canonical hashes.
- `server/scheduler.ts`, `world-server.ts`: bounded host scheduling, WebSocket transport, loopback HTTP/static server.
- `server/diagnostics/`: observational buffered flight recorder and sanitized incident ZIP CLI.
- `shared/protocol.ts`: lightweight viewer state and server-owned reflex presentation curve.
- `src/`: Three.js room/avatar, interpolated presentation, Web Audio impact, connection controls.

Automatic continuity lasts while the **server process remains alive**. Restarts create a new world unless a checkpoint is explicitly supplied; this milestone does not add automatic crash recovery or always-on hosting. Cognition, learning, experiment branches, accelerated laboratory controls and dashboards remain deferred. Geometry/audio is generated by original code; dependencies retain their respective licenses. System fonts work if Google Fonts is unavailable.
