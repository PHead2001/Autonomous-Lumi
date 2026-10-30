# Home life and nonphysical Observe

Phase 2.5b adds a bounded starter-home loop on the existing authoritative server. Food/rest decisions come from current attended needs and legitimately observed affordances. The no-lookahead baseline has no learned prediction, scheduled breakfast, employment, money or owner feeding prerequisite. Existing optional interpretation can enrich perception; paid models are not required for basic home care.

## Open the ongoing home

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. The world stays on loopback 3001 and Vite strictly uses 5173. For the built app, run `npm run build`, then `npm start`, and open port 3001. The ordinary page selects LIVE by default; Advanced remains at `?view=dashboard`.

New and pre-home histories install one of two compatible layouts only when the current character and interaction anchors fit collision clearance. Installation does not teleport Lumi, reset needs, replace history or invent previous food/bed experiences. A safe home defaults active; `LUMI_PHYSIOLOGY_ACTIVE=false` is an explicit **process environment** override, not a `.env` file setting, and persists as the owner-disabled home policy across omitted overrides. A missing safe layout stays visibly unavailable rather than bypassing collision. Explicit re-enablement still preflights capacity and preserves prior body/history. Civil clock/DST and day/night behavior remain outside this phase.

## Watch without entering the world

| Camera | Controls |
| --- | --- |
| 1 · Orbit | Drag around the room, scroll to zoom |
| 2 · Free | Focus the canvas; drag to look; W/A/S/D or arrows to fly; Q/E down/up; Shift faster |
| 3 · Follow Lumi | Follows her authoritative body position; drag/scroll around it |
| 4 · Fixed | A steady room view |

Use **R** while the canvas is focused or **Recenter** to reset the current mode. The select control also works with ordinary keyboard navigation. Camera position never enters a WebSocket command or sensory payload. Observe creates no actor, collider, shadow, footsteps or visit; switching modes/multiple viewers cannot grant knowledge or change her actual head camera. Disconnect freezes the last received presentation while the server continues. Reconnect receives the current same server world.

The feminine bipedal avatar and ears/tail/arms/hands remain. Food handling follows server-held serving state and action progress. Bed entry/recline/exit uses the same authoritative `homePoseTransform` as the actual head-mounted camera and clearance checks. The browser cannot grant nutrition, place her in bed or declare completion. Forced sleep outside bed remains upright dozing where she actually stopped, labelled accordingly; there is no spectator-only floor collapse or invisible move into bed.

## Understand the public activity

The ordinary label distinguishes a selected intention, active travel/handling/eating/resting, interruption, blocked/failed attempt and server-confirmed completion. An eating animation is not a completed meal. A failed action cannot satisfy a need. The recent timeline is **owner-facing action evidence**, not autobiography and not provider context. The server retains at most 64 meaningful entries with a dropped count; the compact viewer shows the newest eight and explicitly notes retained/omitted history. Exact body values, target/evidence identifiers and action debugging remain Advanced diagnostics.

**Ring doorbell** sends a validated world sound at a physical emitter. Its shared server cooldown is ten world seconds; browser debounce is only UX. Lumi can legitimately ignore it. **Door slam** remains in an expandable section. The first press activates browser audio; sound plays only from a new server acoustic event, not from a speculative click. Disconnection, unavailable audio or unconfirmed/cooldown requests are shown plainly.

## Authored perception, calculated routes and actions

The starter fixtures carry deliberately clear four-colour RGB signs. A small authored recognizer reads their actual eligible captured colour arrangement before associating a local resource. This is explicitly **built-in authored recognition**, not learned semantics, OCR or proof of VLM understanding. Dark/hidden/unreadable signs, failed rendering and missing observations do not reveal a new target. Private tags or object masks alone do not establish recognition. Source capture/attention association is retained with bounded known affordances; a remembered target remains at its last observed anchor rather than tracking hidden relocation.

When a needed resource is unknown, a bounded authored search holds patrol through five fixed head looks in each of four right-angle body orientations, waiting for applicable settled captures. It uses a minimum one-world-second look gap, a bounded 45-second frame wait and a five-second gap after a full session. This is fixed exploration, not a private target-bearing hint. A legitimate current goal selects a known interaction anchor, then uses a bounded deterministic calculated route with current scene/door clearance. Private geometry serves navigation safety, not unseen-resource discovery. There are at most eight known targets, 128 route points and three replans. Current physical checks can block a remembered destination; moved/unavailable targets produce an honest failure. Commitment, handled cues and bounded reconsideration prevent immediate oscillation, and a valid initiating cue may expire during an already committed trip.

The pantry starts with up to four basic servings and replenishes one per world hour up to that cap. This is a world-stock rule, not hidden nutrition added to the body. The voluntary controller does not receive private stock counts/restock clocks or exact body percentages. Food acquisition requires availability, ownership, reach and capability. One serving is acquired/held, then consumed at an explicit exactly-once commit; inventory and accepted nutrition change together, never from avatar animation. A serving supplies +0.5 normalized satiety and +0.12 reserves absorbed over 1,200 world seconds. Nutrition is a validated production effect, separate from the tainting private physiology fixture.

Simple action stages are reach 1 s, holding 1 s and eating 4 s. Bed entry/exit each take 3 s, quiet rest 30 s and waking 1 s; a sleep-driven bed action enters sleep after its short settled rest stage, then uses the existing body sleep/wake rules. Authoritative pose/clearance remains enforced throughout. A blocked bed entry/exit holds its last safe pose and reports a bounded abort/failure; the viewer does not label that held pose as walking or a completed exit. Sleep/incapacity, interrupted routes and independent user pauses do not duplicate servings, body effects or completed stages. Existing immediate reflex safety and severe-awareness guarantees remain independent of voluntary action.

## Guided Lab and offline evidence

In the ordinary page or Advanced, choose **Find food and eat** or **Find bed and sleep**, then **Start isolated demonstration**. The local backend creates an EXPERIMENT using the same home controller/actions with labelled initial conditions; setup does not directly issue a final eat/sleep choice. It does not reset/accelerate owner LIVE or make paid calls. Open the returned experiment viewer, inspect actual progress and expected/observed checks, then download the diagnostic ZIP when available. Status is RUNNING, PASS, FAIL or INCONCLUSIVE from actual backend evidence, never an assumed success from animation. In the bed scenario, search and fresh-cue waiting run at clearly labelled EXPERIMENT 6×; actual selected travel/entry/exit run at 1×. Once asleep, bounded 300-fixed-tick batches advance recovery in the 1 Hz experiment. Normal LIVE remains 1× and body rates are unchanged. Fast-forward ends at the actual wake boundary before 1× waking/exit presentation. Terminal status is published only when its export URL is available. A new attempt creates a new isolated demonstration; it does not silently reset LIVE.

The local endpoints are `POST /api/home-lab/start` with `{scenario: food|bed}` and `GET /api/home-lab?scenarioId=…`; the UI handles these IDs without asking the owner to enter them. Export reuses the existing scoped diagnostic bundle/download path. Closing the viewer does not make its server experiment depend on browser ticks.

```powershell
npm.cmd run home:lab -- --scenario food --out diagnostics/home-lab/my-food.zip
npm.cmd run home:lab -- --scenario bed --out diagnostics/home-lab/my-bed.zip
npm.cmd run replay -- --bundle 'C:\path\to\downloaded-home.zip'
```

Offline replay injects recorded sensory/provider results with zero renderer/provider calls. COMPLETE evidence and exact hashes are determined by the exporter/replay implementation; missing evidence must remain INCOMPLETE. The final review-fix candidate passed 360 tests, both actual lab exports/replays and the normal food/camera/narrow-browser checks; see [Phase 2.5b results](phase-2-5b-results.md) for exact evidence and the completed browser bed timeline and visually observed bed/sleep/wake poses; hosted application review is clean and the final canonical sensor-watch/recovery rollout is verified. The post-fix wake boundary has actual bundle/audit proof; the earlier visual pose walkthrough was not repeated after that backend fix because final computer use was unavailable.

## Versioning and update boundary

Checkpoint **8**, runtime envelope **7**, `lumi-home-v1` extends complete state with layout/resources/replenishment, known affordance/source associations, utility commitment, chosen task/route/replans, held item and effect cursor, posture/bed occupancy, and the bounded public timeline. Historical schemas retain their original scene/rule replay. Migration preserves existing world/body/memories/history and uses an explicit safe layout. The actual 2 MiB checkpoint-envelope budget still applies; bounded home growth is included, with visible capacity failure rather than trimmed experiences or reset history. Recovery retains its usual last-commit loss window; an animation/meal is not an immediate durable disk transaction.

Isolated worktree edits or pushes do not reload the canonical app. After integrating the tested candidate into `E:\Coding_Projects\Autonomous Lumi`, the lead restarts/verifies the existing 3001/5173 app with its same data directory, recovery identity and current viewer. No runtime upgrade is inferred merely from isolated tests. Scope stops before exterior/shops/Visit (2.5c), full daily balancing/multi-day trials (2.5d) and learned prediction (Phase 3).
