# Autonomous Lumi — A little home

An original low-poly fox girl lives in a small browser home, with a reachable pantry and bed, locally perceived needs and resources, and server-owned food/rest actions. Sound reaches her through distance and physical barriers; qualifying received sounds produce an immediate articulated ear reflex. Local attention adapts to repetition and current activity, uses bounded head movement, and requests limited first-person captures. Optional Phase 2c cognition interprets selected actual images, proposes locally validated actions and admits eligible fallible experiences. One Node.js process owns the world and keeps updating with **zero browser viewers**. The default local demo needs no provider credentials, downloaded character assets or database.

## Run locally

Requires Node.js 22 or newer and npm. In PowerShell:

```powershell
cd 'E:\Coding_Projects\Autonomous Lumi'
npm install
npm run dev
```

Open **http://127.0.0.1:5173** in a current desktop Chrome, Edge, or Firefox with WebGL enabled. The world listens on loopback port **3001**; Vite serves the viewer on **5173** and proxies its WebSocket. Keep the terminal running. `Ctrl+C` stops both processes. Vite uses strict port 5173: if it is occupied, startup fails visibly rather than moving to 5174/5175. Verify the existing app and stop an obsolete duplicate deliberately; keep the normal app on these fixed ports.

For a built viewer served by the same Node process:

```powershell
npm run build
npm start
```

Open **http://127.0.0.1:3001**. The normal world port is 3001; the development proxy targets that same port. Keep one normal app/data owner rather than launching another copy on a new port.

## Development updates and runtime check

`npm run dev` watches `server/`, `shared/` and the current first-person render dependencies `src/capture-renderer.ts`, `src/render-scene.ts`, `src/avatar.ts`: these edits request graceful save-and-exit, then start a new server child and recover the same `LUMI_DATA_DIRECTORY` (default `diagnostics/runs`). This refreshes the server-cached actual-eye bundle as well as the viewer. Other viewer/style edits use Vite HMR/reload on the same port 5173 without restarting the world. Keep the working directory and data directory stable. Checkpoint format changes require an explicit compatible migration or a visible failure; they do not authorize a fresh world or another port.

Edits made in an isolated worktree are watched only by an app launched from that worktree. Editing or pushing there does not reload the server launched from `E:\Coding_Projects\Autonomous Lumi`. Integrate the tested commit into that canonical checkout first, keeping its existing data directory and fixed ports, then verify its watcher/recovery/viewer. Isolation during format changes avoids exposing the running app to half-written migrations.

A Git push publishes commits; it does not itself change local files or restart an app. The watcher normally loaded edits when they were saved before the push. After pushing, verify the current runtime: inspect the watcher's latest child-ready/recovery output, check `/health` for the intended same history/current run and advancing tick, and confirm the viewer reflects the change. If the running process is stale, use one controlled graceful restart on the same ports/data directory, then repeat those checks. [Continuity and recovery](docs/continuity.md) describes the save boundary and failure behavior.

## Try Phase 1

1. Watch Lumi walk on two legs and pause at waypoints. Her ears, hair, flared tunic, arms/hands, and bushy tail are original primitive geometry. Drag to orbit, scroll to zoom, and use **Recenter** for the default camera.
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

## Phase 2.5b: home life and Observe

The default page opens the ongoing LIVE home. The owner-facing activity label and recent timeline distinguish selected intentions, actions in progress, interruptions, failures and confirmed outcomes; they are not Lumi’s memories. New/migrated playable home histories activate physiology only after a safe furniture layout is available. Explicit process `LUMI_PHYSIOLOGY_ACTIVE=false` keeps it OFF, and that owner-disabled policy persists on later restore. Existing body/history/memories are preserved, without retroactive needs or invented meals.

Observe cameras are local to each browser: **1 Orbit**, **2 Free**, **3 Follow**, **4 Fixed**. Drag/scroll in Orbit or Follow; focus the scene in Free and use **W/A/S/D** or arrows to fly, **Q/E** vertically, drag to look and **Shift** to move faster. **R** or **Recenter** resets the current camera. Camera movement creates no visitor or sensory event and never controls Lumi’s head. **Ring doorbell** sends a real server sound request with a shared ten-world-second cooldown; she may ignore it. Door slam remains in its expandable control. Audio requires a user gesture.

The **Guided Lab** card in the normal viewer and Advanced creates a separate food/bed experiment, opens it in the ordinary viewer with an EXPERIMENT label, and reports actual RUNNING/PASS/FAIL/INCONCLUSIVE evidence and a diagnostic export. It makes no paid calls and does not alter owner LIVE. The bed demo explicitly uses 6× search/fresh-cue waiting, 1× selected travel/interaction and bounded fixed-step sleep time-lapse. Use the downloaded ZIP with `npm.cmd run replay -- --bundle <path>` for exact offline replay. See [Home life and Observe](docs/home.md) for authored RGB recognition, resource/action rules, continuity and limitations. The frozen candidate passed 357 tests and actual food/bed lab exports/replays. [Phase 2.5b results](docs/phase-2-5b-results.md) records the food/camera/narrow browser checks and completed browser-bed timeline/pose walkthrough and remaining hosted review and canonical integration gates; no audible playback claim is made.

## Phase 2.5a: experimental body and internal senses

The deterministic body model adds satiety, reserves, sleep pressure, fatigue and condition, plus coarse hunger/sleep/discomfort perceptions. The current review correction introduces checkpoint 7 / runtime 6 (`lumi-physiology-v2`): actual movement/task slowdown and bounded seeded ordinary internal-sensor noise/attention lapses, preserving the severe-need awareness guard. Final isolated verification passed 316/316 with clean local reviews and exact diagnostic replay; owner-runtime integration and hosted review are not yet claimed. Checkpoint-6/v1 evidence remains historical. The Phase 2.5a foundation staged new/migrated LIVE physiology inactive; the Phase 2.5b home policy above closes that staging gap after safe home installation, while preserving an explicit owner disable. This is an experimental game model, not human physiology; no day/night routine or autonomous food/recovery loop is included.

```powershell
# Prepared isolated lab: no owner history, paid calls or renderer needed.
npm.cmd run physiology:lab -- --out diagnostics/physiology-lab/hunger-during-task.zip
npm.cmd run replay -- --bundle diagnostics/physiology-lab/hunger-during-task.zip
```

The lab emits a sanitized ZIP and `.summary.json` containing actual PASS/FAIL/INCONCLUSIVE assertions and a timeline. **Physiology & present sensations** in the dashboard separates current attended perceptions from private body numbers and encoded episodes. Its prepared lab card gives the CLI command; it is not an interactive launcher. Supplied nutrition is explicitly a test fixture, not proof Lumi found or ate food.

To deliberately activate a local server, set the process variable `$env:LUMI_PHYSIOLOGY_ACTIVE = 'true'` before `npm run dev` or `npm start`. Explicit `'false'` freezes body integration while preserving state/history; removing the variable preserves an existing owner-disabled home policy; without one, a safe playable home defaults active. This gate is a process setting, not a `.env` file setting. Activation checks checkpoint capacity first; no dashboard/model action silently enables it. See [Physiology and interoception](docs/physiology.md) for rates, fixed-step order, severe-need eligibility, provenance and replay. [Phase 2.5a results](docs/phase-2-5a-results.md) records focused/browser checks and historical provider/lab evidence. [PR #9](https://github.com/PHead2001/Autonomous-Lumi/pull/9) review found three defects that are now locally fixed: explicit LIVE import-history continuity, migration activation-capacity preflight and fractional absorption completion. Final tests passed 308/308, lint/build and independent local re-reviews are clean. Regenerated current-schema lab inspection/replay passed; hosted re-review is pending; previous artifact results are historical.

## Phase 2c: interpretation and experience

New-install cognition and Decisions are **OFF by default**. The owner's current ignored `.env` explicitly enables main cognition persistently; saved Decisions remains OFF. To enable main interpretation, create a local `.env` from `.env.example` if one does not already exist, preserve any existing settings, set `OPENROUTER_API_KEY` locally and set `LUMI_COGNITION_ENABLED=true`. Development and normal startup use the same server-side loader. The default route is OpenRouter `qwen/qwen3.7-flash`, using JSON-object output, a bounded explicit response contract and strict local validation; native remote JSON-schema enforcement is unsupported on this route ([official model FAQ](https://openrouter.ai/qwen/qwen3.7-flash)). Keys alone do not enable inference. Never use a `VITE_` prefix for server credentials.

Open the existing dashboard with `?view=dashboard` and select a world/branch. **Interpretation & experience** shows the specific observation/frame bound to each request, a short fallible interpretation, uncertainty, proposed versus locally started/queued action, encoding outcome, provider timing/usage/cost basis and admitted real experiences. It never substitutes the latest image for an older request. “Started / queued” does not mean a physical action completed. Geometry-assisted observation handles and `inspect` remain available as fallible hints, not recognized facts. Paired actual RGB/object-mask measurements calibrate their confidence: weak, dim, small or cluttered eligible candidates remain LOW/uncertain, while hidden/out-of-view geometry remains ineligible. Missing/corrupt paired evidence yields zero handles and an operational failure. HIGH requires adequate pixel contrast, size and measured display signal. This is an engineering heuristic, with no day/night system. Historical state/replay remains preserved. Only the trusted actual-sensor → attention → interpretation → encoding path admits real experience; manual previews, ignored cues, unsupported guesses and TEST STUB ancestry cannot create LIVE autobiography.

The default application-wide spending ceiling is **US$1**, with durable reservation accounting separate from branch checkpoints and preserved across restart/restore. Pending and unknown-usage requests remain charged conservatively. Finite request/experience capacity fails visibly rather than silently trimming history. Admission budgets actual pretty-printed recovery/named-checkpoint envelopes against the 2 MiB file limit, reserving future activity, synthetic, motor/sensor and pending-result growth; see the capacity details in [the guide](docs/multimodal-experience.md). The existing recovery checkpoint window still applies; logical encoding is not an immediate per-record durable transaction. Disabling cognition preserves admitted records and local walking/reflex/attention behavior.

OpenAI Decisions has an independent `OPENAI_API_KEY` and enable flag. It uses the actual Decisions endpoint for explicit isolated comparisons, remains disabled for normal LIVE use and does not gate reflexes or the main model. Main and Decisions measurements are separate; `world_seconds_per_model_response` stays **N/A** without successful main responses. Ordinary `npm test` never makes paid calls.

See [Multimodal interpretation and experience](docs/multimodal-experience.md) for configuration, budgets, action/provenance boundaries, replay/recovery and explicit integration commands. [Phase 2c results](docs/phase-2c-results.md) separates previous paid acceptance from the pixel-confidence correction. The new prompt-v4/wire-v2 repair binds observation/frame identifiers on the server and reports bounded validation reasons without raw rejected replies. Its final full run passed 263/263, lint/build and actual renderer checks. Six actual v4 main responses succeeded, including black/no-hint evidence and temporary LIVE perception surviving restart; a rejected look did not become a completed action in memory. Six new COMPLETE bundles replay exactly. New-patch hosted source review and independent artifact inspection passed; previous bundles retain exact replay. Latencies, cost accounting and remaining cleanup/audio limits are explicit.

## Phase 2b: hearing and attention

Open **http://127.0.0.1:5173/?view=dashboard** (port 3001 in built mode) and select a branch. **Hearing & selective attention** shows receiver-facing sound evidence separately from private source/propagation truth, the immediate reflex decision, attention factors, habituation, commitments and head outcomes. Automatic captures show coalesced reasons, host admission, original capture/receipt ticks, freshness, failures and the associated retained frame. Main-model metrics remain **N/A** until successful responses exist.

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

See [Dashboard walkthrough](docs/dashboard.md) and [Diagnostic export and replay](docs/diagnostics.md) for controls, filters, logging modes, optional compression, retention and the bounded benchmark command. `world_seconds_per_model_response` is **N/A** without successful main interpretation responses.

## Deterministic time and restore

The simulation advances one integer tick per `Simulation.step()` at 30 ticks/second. World elapsed seconds are derived as `tick / hz`. Commands enter at a recorded receipt tick, receive a sequence, and execute at the next tick before movement. Invalid commands and cooldown/queue rejections remain part of the ordered evidence. No variable-delta simulation path is retained.

The host scheduler runs at most 8 LIVE steps per pump with 16 steps of backlog; experiment budgets are 48/96 so default 6× can handle ordinary jitter. Discarded catch-up is diagnosed. A monotonic or UTC gap of at least 5 seconds is detected before acceleration, freezes local world time across that gap and emits `HOST_SUSPEND`/`HOST_RESUME` diagnostics with observed downtime and skipped ticks. Paused experiments accumulate no catch-up. A gap can represent host sleep, a stall or a clock discontinuity; it is not simulated lived experience. Tests inject these clocks without sleeping the PC.

The complete private checkpoint contains the route cursor, pause/cooldown deadlines, PRNG seed/state, counters, pending inputs and rolling event hash. Schema 2 adds subjective time, synthetic experiences and generic activity; schema 3 adds head/scene state; schema 4 adds hearing/attention and ordered sensor feedback. Schema 5 adds cognition request/result associations, deduplication, normalized proposals and admitted real experiences. Schema 6 / runtime envelope 5 adds complete body, absorption, internal attention/encoding and capability-interruption state. Schema 7 / runtime envelope 6 adds restorable ordinary sensor sampling and fractional task credit. Current schema 8 / runtime envelope 7 adds home layout/resources, observed affordances, utility/action/route progress, authoritative posture and bounded owner timeline; active schema-6 migration preserves its existing history/body/cues/episodes and initializes only new state at the current tick; old schemas replay under their original rules. The runtime envelope saves control/scheduler state. Host timers rebase on restore, interrupted requests are reconciled without uncontrolled paid resends, and historical schema/rule replay preserves its original semantics. Active upgrades preserve LIVE history/tick/state; invalid checkpoints fail explicitly. Retired results cannot mutate a replacement run.

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

LIVE continues with zero viewers and automatically recovers its last committed complete checkpoint after restart. Graceful shutdown commits final state; abrupt termination may lose progress since the last successful save (30 real seconds by default, longer after save failures). Startup fails visibly if existing history cannot be recovered; it never silently replaces it with a fresh world. See [Continuity and recovery](docs/continuity.md) for the precise loss boundary. This remains local process recovery, without always-on hosting. Phase 2.5b adds the bounded home care loop. Exterior/shops/Visit are 2.5c; full daily-life balancing and multi-day trials are 2.5d; prediction/learning remains Phase 3. Geometry/audio is original code; dependencies retain their licenses. System fonts work if Google Fonts is unavailable.
