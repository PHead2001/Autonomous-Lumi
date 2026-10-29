# Phase 1.5a diagnostics, checkpoints and replay

Node owns a fixed-tick world and a private local flight recorder. No database, cognition, personal memories or experiment branches are added. The viewer still receives only lightweight presentation state.

## Capture and export one incident

```powershell
npm.cmd run diagnostics:incident -- --out diagnostics/door-invalid-incident.zip
npm.cmd run replay -- --bundle diagnostics/door-invalid-incident.zip
```

The incident command starts a real ephemeral loopback world, connects over WebSocket, sends a door slam and an invalid command, waits for the acoustic notification, disconnects, and closes the world with a final complete checkpoint. It then runs the ordinary exporter. The invalid request deliberately contains private fixture fields; admission keeps only the normalized rejection enum, so the values never reach the recorder or archive.

The replay command reads only the ZIP contents and current simulation code. It restores `checkpoint-start.json`, submits recorded inputs at their receipt ticks in sequence order, steps through the recorded ending tick, and compares canonical state, event-chain, ordered-input and structured-event hashes. A separate full-record integrity hash and recorder sequence boundaries cover operational notifications as well as deterministic events. Missing inputs, altered event records, incompatible checkpoints and incomplete evidence fail explicitly. The record-integrity hash includes observational timestamps; those fields remain excluded from canonical simulation state/event hashes.

## Export an existing local run

```powershell
npm.cmd run diagnostics:export -- --run <run-id> --out diagnostics/incident.zip
npm.cmd run diagnostics:export -- --run <run-id> --from-tick 0 --to-tick 300 --out diagnostics/range.zip
npm.cmd run diagnostics:export -- --run <run-id> --incident 1 --out diagnostics/command-1.zip
```

These PowerShell examples use `npm.cmd` so argument forwarding retains `--out` and other flags. Omit `--run` to select the most recently modified run directory. `--directory` overrides the default `diagnostics/runs`. The selectors must lie within the retained complete checkpoint interval. A selected incident means a deterministic input sequence, not an arbitrary visitor identifier.

For a running world, the latest durable checkpoint is captured periodically, so its latest seconds may not yet be exportable. Stop the server gracefully with Ctrl+C for its final checkpoint. Forced process termination may leave only the most recent durable boundary. The archive declares the requested range and the wider included replay range; all warm-up inputs and events from the starting checkpoint are included so the selected incident can be reproduced.

Open `SUMMARY.md` first, then `TIMELINE.md`. Each timeline line links a recorder ID to its deterministic input/event and causal references. `manifest.json` declares seed, PRNG state, fixed step, simulation configuration/rules, available Git revision and Node/build metadata, hashes and evidence coverage. `REPRODUCTION.md` gives the exact replay path; `assertions.json` contains actual exporter assertions, and explicitly does not pretend to be an external test-suite report.

An export is `COMPLETE` only when the retained ordered inputs reproduce the ending full checkpoint and event hash, and all deterministic event records match that replay. Loss, eviction, writer errors or mismatches produce `INCOMPLETE`; the replay command refuses to certify such an archive. A raw log file is never a substitute for the bundle.

## Channels and evidence boundaries

- `WORLD_TRUTH`: actual authoritative movement, door, acoustic and reflex-state transitions.
- `PRIVATE_SENSOR`: numeric reflex factors and threshold decisions. There is no attention system yet.
- `OPERATIONAL_REPLAY`: ordered inputs, input admission/validation, scheduler discontinuities, transport notification attempts and runtime health.
- `FOX_EXPERIENCE`: supported schema category, intentionally empty. No attended-and-encoded experience or personal memory is fabricated.

`VIEWER_NOTIFICATION` says whether a message was queued for connected viewers. It cannot establish that the browser displayed the ear flick or played audible sound. Presentation is explicitly unavailable in incident evidence; browser/manual checks must be reported separately. Logs and exported ground truth are never fed into character knowledge.

## Bounds, rotation and failure handling

The default writer buffers at most 1,024 records / 1 MiB, including its asynchronous in-flight batch. Of those slots, 128 are reserved for critical input and deterministic-event evidence. Individual records are capped at 16 KiB. The writer flushes asynchronously every 100 ms; it does no synchronous per-tick or per-frame writes.

JSONL files rotate at 256 KiB or 15 minutes. Each run retains at most eight JSONL files / 2 MiB. Start and latest checkpoints plus small health metadata are additional bounded files. The log root retains up to four runs / 8 MiB total, including metadata and checkpoints. Oldest inactive runs are pruned only when their metadata and filenames identify app-generated data. Live PID markers protect active runs. Arbitrary files and folders are preserved; if active runs or accounted unowned data prevent enforcing the root cap, `/health` exposes `globalCapExceeded` and coverage becomes `INCOMPLETE`. Unowned nested folders or links are not traversed; `globalAccountingComplete=false` explicitly reports that the known-byte count cannot certify the cap, also marking evidence `INCOMPLETE`. Generated `diagnostics/` output is ignored by Git. ZIP outputs outside the run root are explicit user exports, not automatically pruned.

Queue/record-size drops and file evictions remain visible in `/health` and the manifest. Severity filtering affects optional records; critical replay evidence bypasses the filter. A slow or failed writer cannot throw into deterministic advancement or consume simulation randomness. Writer errors record sanitized health codes rather than exception strings that may contain paths or private data. Every affected export is marked `INCOMPLETE`.

Exporter input is capped at 32 JSONL files / 20,000 records / 8 MiB, with each metadata/checkpoint file capped at 2 MiB before reading (enough for the maximum supported pending-input checkpoint). Retention probes cap run/active-marker JSON at 64 KiB; malformed or oversized ownership data is protected and reported rather than loaded or deleted. ZIP imports permit only the ten documented fixed entry names, reject unsafe paths and cap declared uncompressed size before decompression. Exports contain allowlisted normalized commands and structured fields; environment variables, raw visitor payloads, credentials and tokens are excluded. Available revision metadata includes whether the source working tree is modified; it is not an artifact-provenance certification.

## Useful commands

```powershell
npm test
npm run lint
npm run build
```

Diagnostics regressions cover sanitized real-event bundles and replay, queue/record limits, critical reserve behavior, size/time rotation and retention, injected writer failure, deterministic equivalence with a failing observer, severity controls, a basic tick-latency sanity check, tampered evidence and unsafe ZIP entry rejection. This is not a full logging benchmark matrix or a long-running load test.
