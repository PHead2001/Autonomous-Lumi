# Diagnostics, branch checkpoints, replay and bounded logging benchmarks

Node owns fixed-tick LIVE and isolated EXPERIMENT branches with private local flight recorders. The Phase1 viewer still receives lightweight presentation state. Synthetic test experience is explicitly distinct from world truth; no LLM, real vision, learning or physiological system is introduced.

## Capture and export one incident

```powershell
npm.cmd run diagnostics:incident -- --out diagnostics/door-invalid-incident.zip
npm.cmd run replay -- --bundle diagnostics/door-invalid-incident.zip
```

The incident command starts a real ephemeral loopback world, connects over WebSocket, sends a door slam and an invalid command, waits for the acoustic notification, disconnects, and closes the world with a final complete checkpoint. It then runs the ordinary exporter. The invalid request deliberately contains private fixture fields; admission keeps only the normalized rejection enum, so the values never reach the recorder or archive.

The replay command reads only the ZIP contents and current code. Legacy schema1 bundles still restore `checkpoint-start.json` and replay ordered inputs. Schema2 bundles additionally restore `runtime-start.json`, replay `operations.jsonl` (controls, input admission and coalesced whole-step advances), and compare `runtime-end.json` including scheduler/control state, activity and subjective-clock state. Canonical state/event/input hashes and a separate full-record integrity hash cover operational notifications as well as deterministic events. Missing inputs, altered event records, incompatible checkpoints and incomplete evidence fail explicitly. Record-integrity hashes include observational timestamps; canonical simulation state/event hashes exclude them.

## Export an existing local run

```powershell
npm.cmd run diagnostics:export -- --run <run-id> --out diagnostics/incident.zip
npm.cmd run diagnostics:export -- --run <run-id> --from-tick 0 --to-tick 300 --out diagnostics/range.zip
npm.cmd run diagnostics:export -- --run <run-id> --incident 1 --out diagnostics/command-1.zip

# Phase1.5b branches require an explicit namespace:
npm.cmd run diagnostics:export -- --world <world-id> --branch <branch-id> --run <run-id> --out diagnostics/branch-incident.zip
npm.cmd run diagnostics:export -- --world <world-id> --branch <branch-id> --run <run-id> --category PRIVATE_SENSOR --search REFLEX --out diagnostics/reflex.zip
```

These PowerShell examples use `npm.cmd` so argument forwarding retains flags. Omit `--run` to select the most recently modified run within the explicitly selected namespace (or the legacy directory). `--directory` overrides `diagnostics/runs`. Branch logs are stored at `<directory>/<world>/<branch>/runs/<run>`, with branch checkpoint/export directories outside that run-retention root. Branch/run identity is validated before timeline filters or export selection; unknown targets never fall back to LIVE. Tick selectors must lie within checkpoint coverage. An incident selector means a deterministic input sequence, not a visitor identifier.

Timeline/export selectors include category, event type/class, component, severity, causal ID, tick range and search. Dashboard queries first bind the exact world/branch/run, then apply those filters. Causal references are interpreted only within that bound scope. A filtered bundle includes the wider replay warm-up interval; filtering changes its human focus, not the evidence needed for verification.

For legacy running worlds, the latest durable checkpoint is captured periodically. The branch dashboard captures a current complete runtime boundary before export. Stop gracefully with Ctrl+C for a final checkpoint; forced termination may leave only the most recent durable boundary. An archive declares the requested range and wider replay range; all warm-up inputs and operations from its starting checkpoint are included.

Open `SUMMARY.md` first, then `TIMELINE.md`. Each timeline line links a recorder ID to its deterministic input/event and causal references. `manifest.json` declares seed, PRNG state, fixed step, simulation configuration/rules, available Git revision and Node/build metadata, hashes and evidence coverage. `REPRODUCTION.md` gives the exact replay path; `assertions.json` contains actual exporter assertions, and explicitly does not pretend to be an external test-suite report.

An export is `COMPLETE` only when retained inputs and, for schema2, runtime/control operations reproduce the ending complete checkpoints and event hash, and every structured record passes its integrity/coverage checks. Loss, eviction, writer errors or mismatches produce `INCOMPLETE`; replay refuses to certify such an archive. A raw log file is never a substitute for the bundle.

## Channels and evidence boundaries

- `WORLD_TRUTH`: actual authoritative movement, door, acoustic and reflex-state transitions.
- `PRIVATE_SENSOR`: reflex factors/threshold decisions and explicitly synthetic cue/gate traces. A sensed but unattended or unencoded cue remains here, outside experience.
- `OPERATIONAL_REPLAY`: ordered inputs, controls and runtime advances, input validation, scheduler discontinuities, transport attempts and runtime health.
- `FOX_EXPERIENCE`: only an EXPERIMENT `TEST STUB` observation that is sensed, attended and encoded. Setting that category on a generic diagnostic record does not bypass the gate or create personal experience. Synthetic clock recalibration is not evidence of visual watch reading in LIVE.

`VIEWER_NOTIFICATION` says whether a message was queued for connected viewers. It cannot establish that the browser displayed the ear flick or played audible sound. Presentation is explicitly unavailable in incident evidence; browser/manual checks must be reported separately. Logs and exported ground truth are never fed into character knowledge.

## Bounds, rotation and failure handling

The default writer buffers at most 1,024 records / 1 MiB, including its asynchronous in-flight batch. Of those slots, 128 are reserved for critical input and deterministic-event evidence. Individual records are capped at 16 KiB. The writer flushes asynchronously every 100 ms; it does no synchronous per-tick or per-frame writes.

JSONL files rotate at 256 KiB or 15 minutes. Each run retains at most eight JSONL files / 2 MiB. Start/latest simulation and runtime checkpoints plus small health metadata are additional bounded files. Each branch's `runs` root retains up to four runs / 8 MiB including metadata and checkpoints. Retention acts only within that branch's own `runs` directory: an experiment never scans or prunes LIVE or sibling evidence, and run retention does not touch checkpoint/export storage. Oldest inactive runs are pruned only when metadata and filenames identify generated data. Live PID markers protect active runs. Arbitrary files/folders are preserved; blocked cap enforcement exposes `globalCapExceeded` and `INCOMPLETE`. Unowned nested folders/links are not traversed: `globalAccountingComplete=false` reports uncertain disk coverage. Generated `diagnostics/` is ignored by Git.

Optional gzip applies only to closed/rotated JSONL files within that run. Compression uses asynchronous zlib; reading enforces compressed and decompressed byte caps. The exporter accepts the same semantic records from plain or gzip files; it never imports arbitrary paths. Missing/decompression-failed evidence cannot be certified complete.

Logging modes are explicit:

- **OFF** suppresses semantic events, ordered inputs and runtime operations; checkpoints/health remain available. `logging_disabled`, disabled-record counts and `INCOMPLETE` are permanent for that evidence interval.
- **Default** records semantic transitions, inputs and runtime operations without per-tick/frame trace spam.
- **Verbose** adds optional debug tick samples. It obeys the same queue, file and retention bounds; overflow is reported rather than weakening limits.

Changing logging mode/compression does not consume simulation randomness or change activity, experience gating or event order. An OFF interval cannot later be made COMPLETE merely by turning logging back on.

Queue/record-size drops and file evictions remain visible in `/health` and the manifest. Severity filtering affects optional records; critical replay evidence bypasses the filter. A slow or failed writer cannot throw into deterministic advancement or consume simulation randomness. Writer errors record sanitized health codes rather than exception strings that may contain paths or private data. Every affected export is marked `INCOMPLETE`.

Exporter input is capped at32 JSONL files /20,000 records /8MiB (including decompressed data), with each metadata/checkpoint file capped at2MiB before reading. Retention probes cap run/active-marker JSON at64KiB; malformed/oversized ownership data is protected and reported. ZIP imports allow only the ten legacy entry names plus the complete schema2 runtime-start/runtime-end/operations trio, reject unsafe paths and cap uncompressed size before decompression. Exports contain allowlisted normalized inputs/controls and structured fields; environment dumps, raw visitor payloads, credentials and tokens are excluded. Available revision metadata includes modified-working-tree status and is not provenance certification.

## Useful commands

```powershell
npm test
npm run lint
npm run build
```

Diagnostics regressions cover sanitized real-event bundles and replay, queue/record limits, critical reserve behavior, size/time rotation and retention, injected writer failure, deterministic equivalence with a failing observer, severity controls, a basic tick-latency sanity check, tampered evidence and unsafe ZIP entry rejection. They complement the bounded nine-cell logging matrix below; no long-running load test is claimed.

## Bounded logging benchmark

```powershell
npm.cmd run diagnostics:benchmark -- --duration-ms 2000 --out diagnostics/benchmarks
```

This executes nine short real-time cells: OFF/default/verbose at1×,6× and a declared30× stress pace. Each uses the same seeded fixed-step fixture: door inputs/rejection, activity progress/interruption, ineligible/eligible synthetic cues and clock calibration. Hashes are compared at the same logical tick across all cells, independent of achieved total tick counts.

The harness executes at most32 whole steps before yielding; it reports requested pace and separately measured achieved rates. This is a bounded logging comparison, not production scheduler/host-suspend certification. JSON includes actual duration/sample count, tick p50/p95, maximum observed scheduler/writer backlog, process CPU, memory endpoints, disk bytes, loss/incomplete health and environment. Memory endpoints are not claimed peaks.1× p95 has limited samples; cells are sequential in one local process without CPU isolation.

The actual initial2s/cell matrix produced matched state/event hashes at tick58 and zero dropped records. Stress30× verbose used more CPU and disk than OFF (as expected), while measured tick p95 remained below0.1ms and queues stayed bounded. See the generated timestamped `SUMMARY.md` and `benchmark.json` in `diagnostics/benchmarks`; these outputs are intentionally ignored by Git. Rerun the command to inspect current host conditions rather than treating these short measurements as a general performance guarantee.
