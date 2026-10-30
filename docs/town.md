# Nearby shop and Observe

Phase 2.5c is delivered in three increments: the shared home/shop world and purchases, authenticated embodied Visit, then offers and a perceived creator introduction. This page describes the shop increment. Visit and social controls are not part of this increment's interface.

## Watch the route

Run the existing application with `npm.cmd run dev` and open `http://127.0.0.1:5173/`. The ordinary page retains its close home view. **3 · Follow Lumi** follows her through the doorway, along the path and into the shop. **Show neighborhood** selects a fixed overview of the complete route; **Show home** returns its framing to the home. Orbit, Free, Follow, Fixed and Recenter remain local camera controls. They create no actor, movement command or sensory event.

The activity label distinguishes a selected trip, travel, checkout, return, eating and confirmed completion. Being at checkout is not a successful purchase. A carried item remains visible until its authoritative ownership/use state changes. The recent timeline merges the bounded home and neighborhood histories in time order, displaying separate retention gaps. It is owner-facing activity evidence, not Lumi's diary or an input to her cognition.

## What the local controller knows

The starter scene uses deliberately authored four-color signs with a narrow RGB recognizer. The recognizer must find a readable full pattern in an actual captured frame and associate it with an independently qualified, observation-scoped handle. Attention and captured-snapshot proof are required before a target becomes known. This is engineered starter-world perception, not learned recognition or a successful VLM interpretation.

The home-side sign supplies a visible exit exploration target. It does not disclose the store's hidden location, inventory, schedule or price list. A readable store cue can supply its observed location and current open/closed indication. Remembered locations retain their original captured evidence rather than tracking hidden relocations. A path calculation executes an already grounded goal; it does not discover the shop.

Shopping uses the local reactive controller and needs no paid provider call. Dependable pantry food and the bed remain available; a shop trip is an optional response to a current observed opportunity, not mandatory survival work or learned foresight. A failed or unaffordable trip does not disable home care.

## World and item rules

The compact expansion reuses the home's real north doorway and adds a short path and an enterable shop. The shared versioned physical snapshot supplies rendering, actual-eye capture, visibility, acoustic barriers, collision and navigation. Closed doors and solid walls remain physical obstacles. Closing a shop stops purchases; it must leave a valid exit for anyone inside.

Migration preserves the saved home's signed door pose. New home-door opening actions swing safely outward to +π/2 rather than sweeping a leaf into the walking path. Door pose is shared by collision, rendering and the actual eyes; it is not a spectator-only animation.

The initial local balance is **20 credits**, configured world state at installation. It is not earned wages or a fabricated earlier event. The starter goods are fruit (**3 credits**) and bread (**2 credits**). Payment, stock and an individually identified owned item commit together only after the server validates the purchase. Retries cannot double-charge or duplicate the item. Acquiring an item does not apply nutrition; its later validated consumption uses the production body-effect path.

Exact stock, balances, replenishment clocks, schedules and transaction identities belong in Advanced evidence. They are not automatically Lumi's personal knowledge. The store's prototype opening cycle is a world rule rather than a civil clock; this increment makes no time-zone or DST decision.

## Reproducible isolated demonstrations

Use **Guided Lab → Discover the shop and return** in the ordinary viewer. The backend creates a separate EXPERIMENT and reports actual RUNNING, PASS, FAIL or INCONCLUSIVE evidence, with an EXPERIMENT viewer and diagnostic ZIP link. The pantry remains available, and the setup does not inject a final shopping choice.

**Shop closes during a trip** is a controlled failure scenario: the experiment changes shop availability after the controller selects its trip. Its result must show the real unsuccessful outcome and retained home fallback. Neither scenario changes owner LIVE or makes paid calls.

Inspect **Expected and observed evidence** for the actual checks. A failed request is not a pass, and a disconnected browser does not stop an already started experiment. Retry creates a new isolated run rather than resetting LIVE.

Download the actual diagnostic ZIP and replay it independently:

```powershell
# Independently run an isolated actual-renderer scenario, export and replay it.
npm.cmd run town:lab -- --scenario shop --out diagnostics/town-lab/shop.zip
npm.cmd run town:lab -- --scenario shop-closed --out diagnostics/town-lab/shop-closed.zip

# Replay an already downloaded diagnostic bundle without rendering or paid calls.
npm.cmd run replay -- --bundle '<downloaded diagnostic ZIP>'
```

Offline replay uses recorded normalized inputs and sensor outcomes, without live rendering, visitors or provider calls. A COMPLETE export is evidence of recorded causal coverage, not proof of displayed animation or audible playback.

The shop demonstrations use 6× for isolated search/waiting and return to 1× for selected travel and interactions. This does not change LIVE's 1× rate. The recognizer and search are bounded starter-world mechanisms: a renderer failure or an unreadable sign can produce an inconclusive run instead of omniscient fallback knowledge. Scenario summaries and ZIP exports report what actually happened; command examples are not a claim that a given machine has already passed them.

## Continuity and limitations

The town schema adds state to the preserved home/body/history rather than replacing pantry stock or the existing held serving. Older checkpoints retain their historical scene and behavior. New shop tasks, observations, routes, purchases, carried items and committed effects are checkpointed for deterministic restore and replay. Credentials and live socket objects do not belong in simulation state.

Keep one canonical data owner on ports **3001/5173** and use the documented graceful watcher/recovery workflow. A worktree edit or push does not update another running checkout. The recovery window remains the last committed checkpoint; no claim of zero loss across an uncommitted crash is made. See [continuity](continuity.md) and [home life](home.md).

This increment does not establish full-day balance, learned shopping preferences, relationships, remote hosting or a general economy. Those remain later work.
