# Virtual Eyes

Phase 2a adds explicit first-person capture and deterministic head actions. The server continues running with zero spectator viewers. A successful image is uninterpreted sensor evidence: no model, attention decision, understanding or personal memory is created. LIVE still rejects synthetic experiences.

## Setup and dashboard

Use Node.js 22 or newer and an installed desktop Chromium browser. `npm install` installs the renderer client libraries; it does not download another browser. The renderer finds Google Chrome or Microsoft Edge in their normal Windows installation locations, or common Chromium/Chrome paths on Linux. If needed, set the executable explicitly before starting the server:

```powershell
$env:LUMI_CHROMIUM_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run dev
```

Open `http://127.0.0.1:5173/?view=dashboard`, or build with `npm run build`, run `npm start`, and open `http://127.0.0.1:3001/?view=dashboard`. The dashboard and private APIs use the existing loopback Host/Origin checks. Do not expose this development server as a public service.

1. Select a world and branch. Virtual Eyes always uses that branch’s **current run**, independently of the timeline’s historical-run filter.
2. In **Server-owned head**, submit a relative turn, body-relative directional look, bounded scan, or cancellation. Watch current and target angles. These controls also work in LIVE; fixture changes remain experiment-only.
3. In a paused experiment, use **Step one tick** or **Resume** to apply queued actions and advance them. Head movement uses fixed ticks rather than instantly jumping to the requested direction.
4. Choose 256, 512 or 1024 square pixels and press **Capture viewpoint**. The snapshot is fixed when the request is admitted. Walking and head movement may continue while Chromium renders it.
5. Inspect the actual frame and its captured tick, pose, scene/state version, PNG hash, reason, duration and reported WebGL backend. A later world tick does not make this an image of that later tick.
6. **Filtered observation** contains unknown shapes, opaque observation handles, approximate bearings/distance bands and measured sample visibility. **Private developer world-truth comparison** is a separate expandable diagnostic view. It includes measurements the filtered observation cannot expose.
7. **Look toward observed bearing** uses a selected opaque handle. The server checks its world/branch/run, age, scene revision and current eligibility; it checks deterministic visibility again when applying the ordered action. A handle expires after 300 world ticks and becomes invalid after a scene change, run replacement or frame eviction. Refreshing the dashboard does not refresh the observation: request another capture.

Capture statuses include queued, pending, success, unavailable, timeout, failed and stale. A retained image after a pending or failed request is explicitly labelled **PREVIOUS successful capture**. Evicted images are marked stale and cannot be displayed or targeted. Renderer cleanup warnings appear separately from capture status: a successfully returned image can coexist with a later cleanup failure. Switching branch or restoring into a new run clears the preview, targeting context and delayed responses. The status refresh follows the dashboard’s existing 1.2-second cadence only while a capture is pending, with a bounded deadline; **Refresh captures** retries a status query. Renderer failure never becomes a successful empty observation or an object-table description.

## Coordinates, camera and physical room

Room coordinates use +Y up and the avatar’s local +Z forward. Positive yaw rotates toward room +X from the body’s forward heading; positive pitch looks up. The UI accepts degrees; validated action payloads use radians. `turn_head` carries `yawDelta` and `pitchDelta`: at execution it adds them to the current head pose and clamps the target to yaw ±75° and pitch −40° to +45°. `look_at` carries a body-relative absolute yaw/pitch or an eligible observation handle. Head turns are limited to a combined angular speed of 90° per world second. A new action interrupts the previous action; cancellation holds the current pose without teleporting it.

The baseline camera is 512×512 at 80° **horizontal** FOV. Its vertical FOV is `2 * atan(tan(horizontalFov / 2) / aspect)`. Eye position and orientation use the same body heading, head pivot, yaw/pitch and deterministic body bob as the avatar. The first-person render hides only the avatar’s own head geometry so the camera does not see the inside of its face or hair; environmental occluders stay present.

One versioned physical-scene definition supplies render geometry, navigation colliders and multi-point visibility checks. The spectator’s front/right-wall cutaways change presentation only. The fox camera retains those walls. The door opens through an actual doorway, without the old opaque decorative backing plate. The painted window remains opaque decoration on a solid wall.

An experiment’s **Experiment scene fixture** section can change illumination, fixture color, doorway override and small visibility-test objects. Submit the configuration, step/resume, and request a fresh capture. An overlapping collision fixture is rejected instead of embedding Lumi in a solid object. These controls never change LIVE. The fixed renderer benchmark fixture is separately defined in `shared/vision-fixture.ts`; it does not load or alter saved LIVE data.

Visibility uses 27 points per observable box, camera-frustum tests and opaque oriented-box segment intersections. A blocked center alone does not make an object fully hidden. Statuses distinguish visible, partially occluded, fully occluded, outside frustum and poor observability. Low-light flags use a conservative scene-illumination proxy tied to rendered lighting, and projected-size flags depend on capture resolution. The sample fraction is a geometric estimate, not a calibrated retinal model, exact pixel fraction, recognition probability or semantic confidence. Identity remains unknown.

## Capture without a viewer

Keep the server running, close every spectator tab, and request a real frame through the CLI. The dashboard itself is not a spectator subscription.

```powershell
$branches = (Invoke-RestMethod 'http://127.0.0.1:3001/api/branches').branches
$live = $branches | Where-Object mode -eq 'LIVE' | Select-Object -First 1
npm.cmd run vision:capture -- --url http://127.0.0.1:3001 --world $live.worldId --branch $live.branchId --run $live.runId --size 512 --out diagnostics/vision/live.png
```

Use the selected experiment’s identifiers to capture an experiment. Run identifiers are deliberate: a restarted or restored world rejects an old run instead of redirecting the request. The CLI writes the explicitly requested private PNG and metadata and uses the server’s completion endpoint. `/health` reports viewer count and advancing LIVE ticks independently of capture.

The renderer runs a separate owned headless Chromium process with no simulation loop or recovery-data lease. One renderer job runs at a time; admission is bounded to four jobs. Requests have a 20-second render deadline, up to four frames per run and sixteen total retained frames. Idle renderer processes close after 30 seconds. A timeout or crash cleans up the worker; a later explicit request can try again. There is no unbounded automatic restart loop. Captures and frame bytes stay outside authoritative checkpoints.

The measured Windows default is ANGLE/D3D11 with a 30-second idle renderer lifetime. [Phase 2a results](phase-2a-results.md) and the [renderer comparison](renderer-benchmarks.md) record the actual measurements and limitations. To explicitly choose a configuration before starting the server:

```powershell
$env:LUMI_RENDER_BACKEND = 'angle-d3d11'
# Or explicitly opt into the trusted-local software renderer:
$env:LUMI_RENDER_BACKEND = 'swiftshader'
```

Clear the variable to restore the platform default. Reproduce the bounded comparison with:

```powershell
npm.cmd run vision:benchmark -- --out diagnostics/vision-benchmarks/local
```

The Windows hardware configuration explicitly requests ANGLE/D3D11 and rejects a software fallback. The software alternative explicitly selects SwiftShader with its required `--enable-unsafe-swiftshader` opt-in. That flag weakens renderer security guarantees and is suitable only for this trusted local renderer source; normal browser sandboxing remains enabled. Actual Chromium/WebGL vendor, renderer and launch flags are recorded with each successful capture. Local measurements do not establish a VPS price or cross-platform performance guarantee.

## Checkpoints, diagnostics and replay

Current simulation schema 3 adds complete head/camera/action/scan and physical-scene state; the runtime envelope advances to schema 2. Active worlds deliberately migrate supported older checkpoints. Existing LIVE history identity, tick and old simulation fields are preserved. Startup records the migration and preserves the pre-upgrade schema-2 recovery payload under its history’s `pre-vision-schema2-…` archive. Do not delete recovery files, set `LUMI_NEW_WORLD`, or create a new world to install this phase. Named checkpoints and experiment restores use the same validation and migration path. Corrupt or incompatible state fails explicitly.

Historical schema-1/schema-2 offline replay keeps its original simulation semantics and hashes. Current head commands replay from normalized ordered inputs and supporting observation evidence; replay does not launch Chromium, mint new handles or call a model. Internal replay evidence may contain private target identity needed for deterministic eligibility checks. It is not the filtered sensory payload.

Capture request, snapshot association, completion/failure, stale-result discard and target validation are recorded causally without per-tick capture spam. **Export diagnostic ZIP** reuses the existing recorder/export/replay path. Default bundles contain sanitized metadata, pose, frame/state hashes and declared evidence gaps; raw PNG bytes/base64 are excluded. A private PNG saved explicitly by the capture CLI is a separate artifact. Ordinary bundles do not claim to reproduce graphics-driver-specific pixels.

```powershell
npm.cmd run replay -- --bundle diagnostics/phase-2a-virtual-eyes.zip
```

The actual acceptance bundle and replay outcome are listed in the Phase 2a results. Simulation state/event replay is exact. A PNG hash identifies the returned image bytes; it does not promise identical pixels across GPUs, drivers or Chromium versions. Image comparison uses the documented backend-specific fixture tolerances separately from canonical simulation hashes.
