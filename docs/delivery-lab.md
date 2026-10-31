# Persistent delivery acceptance

The ordinary viewer uses **Visit → buy fruit/bread → approach the inside back-wall drop-off → G / Deposit held food**. Use **Observe** to park the same avatar, or disconnect and return later. The drop-off's four slots hold nonexpiring permitted food. A deposit commits custody without nutrition, sender identification or a meeting. See [Visit controls](visit.md).

Run the provider-free actual-renderer acceptance from the project root:

```powershell
npm run delivery:lab -- --out diagnostics/phase25d/delivery.zip
npm run replay -- --bundle diagnostics/phase25d/delivery.deposit.zip
npm run replay -- --bundle diagnostics/phase25d/delivery.zip
```

The lab declares initial moderate hunger, a stationary safe Lumi pose/head, and delayed unknown-resource search. It does not inject a recognized resource, sender, final choice or semantic observation. A scripted owner uses the production normalized motor, calculated routes, real door interactions and shop checkout to buy fruit. The owner deposits at the nominal shelf interaction point, releases control, and remains parked at that exact physical pose throughout later discovery and use.

The first ZIP covers purchase, unobserved deposit and disconnect. A complete runtime is saved to a local file and restored into a new run. Only then does the actual automatic capture pipeline supply indicator evidence. The production controller computes an available approach around the parked owner, opens the drop-off, obtains a separate actual contents image, collects the food, and applies nutrition through the normal four-second eating action. Both segments are independently replayed without rendering or provider calls. They are separate causal windows, not one claimed uninterrupted full-history replay.

The companion summary records frame hashes and capture/attention/encoding provenance, actual ticks, custody, body-effect sequence, parked pose preservation, evidence completeness and replay hashes. Images are saved beside the ZIP. The local `.restore.json` and `.runs` directories are private implementation diagnostics, not sanitized handoff exports. No pairing secret, real owner history, `.env`, provider key or spending ledger is used.

This harness is an isolated experiment, not the normal-viewer walkthrough or an owner-LIVE activation check. Graceful process recovery, normal browser control and long-run balance retain their separate acceptance evidence. The canonical app remains stopped unless the owner separately asks to start it.

## Recorded Phase 2.5d result

The actual-renderer run completed with **zero model requests / $0**. Both sanitized ZIPs are **COMPLETE**, and both independent `npm run replay` commands passed. The first segment ends at tick 673 with **111 inputs / 586 events**; the restored discovery/use segment ends at tick 1016 with **10 inputs / 55 events**. These are compact causal windows, not the 24/72-hour endurance trials.

| Validated action | Tick |
| --- | --- |
| Real owner purchase | 303 |
| Deposit commits with no awareness or nutrition | 672 |
| Disconnect leaves the owner parked | 673 |
| Restored run captures occupied indicator | 675 |
| Separate actual indicator admission | 677 |
| Computed alternative route completes and container opens | 858 |
| Separate actual contents capture / food notice | 862 / 864 |
| Collection commits | 893 |
| Four-second production consumption commits one intake | 1013 |

The owner remains at the actual nominal deposit pose throughout discovery and eating; she does not move aside to make the test pass. Anonymous/recognized visitor encounters remain empty. The parcel evidence states that the sender and witnessed handover are unknown. `delivery.zip.indicator.png` and `delivery.zip.contents.png` retain the two actual RGB frames; their hashes and capture/attention/encoding associations are in `delivery.zip.summary.json`.

| Segment | State hash | Event hash | Runtime hash |
| --- | --- | --- | --- |
| Purchase/deposit/disconnect | `d786d31fb4a735784807e9f181cdfcb48eb648361c5cbf2570439c5f7f3edc3e` | `329204faa284aec99dec2f84b126697315b9b166e7348ac8fafb6bd4605472d7` | `a0fa29025d659b3fb96c6e873d0e1ca39aed0310666b51773960bf31850564c7` |
| Restored discovery/collection/use | `1f528ea800ab36f43cc20875d20651470bb57b3fb16be1e805b522b5ce3c9863` | `6f25440fddc9592faf92ccfd16e721ceeaf9f78af7ef3e556c260e5d6fac9179` | `39fa3ec3134f673a4ac3e268fcecc6879d22ee1a1d2d742e62eeaf16767d5ffc` |

Acceptance exposed and corrected an inherited prototype movement pause blocking a delivery route, a shop task stealing the inspection interval, and physically overlapping or too-oblique authored labels. Active delivery routes now bypass idle pauses; content inspection has a bounded commitment with urgent-care precedence and a failure deadline. Closed occupied indicators are replaced by two fixed angled physical contents cards when opened. Shared scene geometry and unchanged RGB recognition thresholds are used; nothing faces the browser camera automatically.

New runs have fresh history/run identities, so their canonical hashes may differ. Compare a generated bundle with its own offline replay. The local `delivery.zip.purchase-runtime.json` is an exact recorded prefix immediately after the real checkout purchase; it is available for an isolated viewer fixture without inventing inventory or relocating the actor. It is private fixture input, not a sanitized export.
