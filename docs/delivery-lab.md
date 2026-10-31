# Persistent delivery acceptance

The ordinary viewer uses **Visit → buy fruit/bread → approach the inside back-wall drop-off → G / Deposit held food**. Use **Observe** to park the same avatar, or disconnect and return later. The drop-off's four slots hold nonexpiring permitted food. A deposit commits custody without nutrition, sender identification or a meeting. See [Visit controls](visit.md).

Run the provider-free actual-renderer acceptance from the project root:

```powershell
npm.cmd run delivery:lab -- --out diagnostics/phase25d/delivery-raised-labels.zip
npm.cmd run replay -- --bundle diagnostics/phase25d/delivery-raised-labels.deposit.zip
npm.cmd run replay -- --bundle diagnostics/phase25d/delivery-raised-labels.zip
```

The lab declares initial moderate hunger, a stationary safe Lumi pose/head, and delayed unknown-resource search. It does not inject a recognized resource, sender, final choice or semantic observation. A scripted owner uses the production normalized motor, calculated routes, real door interactions and shop checkout to buy fruit. The owner deposits at the nominal shelf interaction point, releases control, and remains parked at that exact physical pose throughout later discovery and use.

The first ZIP covers purchase, unobserved deposit and disconnect. A complete runtime is saved to a local file and restored into a new run. Only then does the actual automatic capture pipeline supply indicator evidence. The production controller computes an available approach around the parked owner, opens the drop-off, obtains a separate actual contents image, collects the food, and applies nutrition through the normal four-second eating action. Both segments are independently replayed without rendering or provider calls. They are separate causal windows, not one claimed uninterrupted full-history replay.

The companion summary records frame hashes and capture/attention/encoding provenance, actual ticks, custody, body-effect sequence, parked pose preservation, evidence completeness and replay hashes. Images are saved beside the ZIP. The local `.restore.json` and `.runs` directories are private implementation diagnostics, not sanitized handoff exports. No pairing secret, real owner history, `.env`, provider key or spending ledger is used.

This harness is an isolated experiment, not the normal-viewer walkthrough or an owner-LIVE activation check. Graceful process recovery, normal browser control and long-run balance retain their separate acceptance evidence. The canonical app remains stopped unless the owner separately asks to start it.

## Recorded Phase 2.5d result

The final raised-label actual-renderer run completed with **zero model requests / $0**. Its two `delivery-raised-labels` sanitized ZIPs are **COMPLETE**, and independent offline replay passes. Their `.summary.json`, actual frame images and replay evidence replace the earlier `delivery` pair as current geometry acceptance. The first segment ends at tick 673 with **111 inputs / 586 events**; the restored discovery/use segment ends at tick 1016 with **10 inputs / 55 events**. These are compact causal windows, not the 24/72-hour endurance trials. Independent CLI replay of the raised pair was executed successfully without retaining new stdout files; the older `delivery-replay.log` / `delivery-deposit-replay.log` retain historical hashes, not current-pair proof logs.

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

The owner remains at the actual nominal deposit pose throughout discovery and eating; she does not move aside to make the test pass. Anonymous/recognized visitor encounters remain empty. The parcel evidence states that the sender and witnessed handover are unknown. `delivery-raised-labels.zip.indicator.png` and `delivery-raised-labels.zip.contents.png` retain the two actual RGB frames; their hashes and capture/attention/encoding associations are in `delivery-raised-labels.zip.summary.json`.

| Segment | State hash | Event hash | Runtime hash |
| --- | --- | --- | --- |
| Purchase/deposit/disconnect | `ec55d59315bbc16aef865a39c707293a8feac008e6427f1df77d3cc9703c05c3` | `329204faa284aec99dec2f84b126697315b9b166e7348ac8fafb6bd4605472d7` | `1eb193b36da112721df3e320ac5bf8542957813bb5ff873c8850ae2e5dc5a091` |
| Restored discovery/collection/use | `f89125bbe513594c0a8fa9032781d261431f06a24101605d65a5c28f81f7799c` | `1a1310256e7fc63049c0e541cc40217dce181596da26db800a292b33c7c3f747` | `3ddd696e7895acb61bd327dbd36424253a9960c3b13b5f2aa3692b90b6c28cd3` |

Acceptance exposed and corrected an inherited prototype movement pause blocking a delivery route, a shop task stealing the inspection interval, and physically overlapping or too-oblique authored labels. Active delivery routes now bypass idle pauses; content inspection has a bounded commitment with urgent-care precedence and a failure deadline. Closed occupied indicators are replaced by two fixed, back-set, angled physical contents cards at height 2.2 when opened. The raised placement is a real scene/collider change; RGB classifier thresholds are unchanged and nothing faces the browser camera automatically.

Post-review checks revalidate hands/item custody at the collection commit, including a concurrent in-person offer acceptance, so a parcel cannot overwrite a newly accepted held meal. Partial consumption snapshots must retain the associated committed receipt and gift-use cursor. Full physical-scene validation applies to CP11 migration and CP12 restoration; incompatible saved actors are refused with the source preserved, not silently relocated. Container open/close endpoints also validate actor clearance. The owner's safe-copy full-scene preflight passes with prior fields exact and 453,649 reserved bytes of headroom under the unchanged 2 MiB limit.

Normal-viewer evidence is separate: run A manually returned/deposited, parked, disconnected and re-entered with the same stored unobserved parcel. Fresh run B released only two explicitly declared initial idle/search delays, then normal controls deposited and parked; actual unattended-to-noticed indicator evidence and opening appeared in the UI. At that stage actual capture quotas had not yet allowed contents notice/collection.

Final run C passed by reopening B's actual named checkpoint at tick 19,733 under current geometry, with no actor/body/knowledge/item edits or further search reset. The existing deposit at 10,600 and opening at 11,643 remain. Actual fresh contents notice occurs at 20,476, collection at 20,747, and production consumption at 20,867: exactly 120 ticks/four seconds later. The normal UI displays the consumed receipt. Enter Visit, refresh, paired re-entry and Observe preserve the same eligible owner avatar, 17 credits and empty inventory, then leave it parked. `browser-recovered-consumed.png` records the actual result.

`diagnostics/phase25d/browser-recovered.zip` is a separate **COMPLETE** return/discovery causal window: 483 records, 36 inputs/285 events, zero gaps/drops/evictions/writer failures. Its independent CLI replay passes at tick 25,685 (`browser-recovered-replay.log`). It does not reconstruct B's missing earlier recorder prefix. All test services/renderer workers and the disposable credential directory were cleaned up; ports 3001/5173/3030/5174 are quiet. The closing tab produced a nonpersisting Vite `ECONNRESET`; the stored state remained intact. No audio recheck or paid call was made. Hosted re-review of the final correction push to draft PR #14 remains pending; owner LIVE remains OFF. See [integrated results](phase-2-5d-results.md) for the retained INCOMPLETE run-A archive and precise writer/uptime limits.

New runs have fresh history/run identities, so their canonical hashes may differ. Compare a generated bundle with its own offline replay. The local `delivery-raised-labels.zip.purchase-runtime.json` is an exact recorded prefix immediately after the real checkout purchase; it is available for an isolated viewer fixture without inventing inventory or relocating the actor. It is private fixture input, not a sanitized export.
