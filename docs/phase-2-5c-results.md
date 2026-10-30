# Phase 2.5c verification results

## Increment 1 — Home, path, shop and purchase

The shop increment is implemented on `Assist/phase-2-5c-shop`. It is one delivery slice of Phase 2.5c; authenticated Visit and offers/creator introduction remain the next two slices. This report does not claim the combined milestone is complete.

The final current-source checks passed:

| Check | Actual result | Local log |
| --- | --- | --- |
| `npm test` | **386/386 PASS**, zero failures, 37.476 seconds | `diagnostics/town-increment1/test-final.log` |
| `npm run lint` | **PASS**, exit 0 | `diagnostics/town-increment1/lint-final.log` |
| `npm run build`, including TypeScript | **PASS**, exit 0; Vite chunk-size advisory | `diagnostics/town-increment1/build-final.log` |
| Town maximum-state capacity | Actual pretty-envelope growth **64,253 bytes**, below the **131,072-byte** town future-growth reserve; the existing 2 MiB limit and earlier reserves remain | Same full test log |

After that full pass, a concrete capture-cursor edge was corrected: capture metadata retains the existing authoritative root scene ordering cursor even when the home layout has a nonzero revision, while recording the town physical scene identity separately. A new regression verifies both a usable current observed handle and rejection after a real root revision change. The **30 affected capture/aim/automatic-capture checks passed**, followed by lint and build/typecheck exit 0 (`capture-cursor-affected.log`, `lint-cursor-fix.log`, `build-cursor-fix.log`). The earlier full-suite result is retained rather than described as a new full run. The actual accepted scenarios use layout revision 0 and their inputs/evidence are unaffected.

Regression coverage includes signed legacy door migration, historical acoustic/event behavior, collision-safe real slams and their subsequent rebound envelope, bounded route planning, payment/item consistency, preserved home-held servings, strict schema 9/runtime 8 pairing, branch isolation, exact offline replay, and rejection of fabricated observation proofs. A previously accepted near-limit historical checkpoint is explicitly rejected when the new bounded state cannot fit; its existing records are preserved. A separate declared smaller history fixture verifies the successful current migration/fork/storage path. No memory trimming or weakened storage limit is used.

The unknown-pantry regression independently verifies that a failed trip releases the home controller into bounded search and idle walking, with the shop cooldown preventing an immediate repeated trip. It does not claim that a missing sensory observation discovers a pantry.

### Actual final scenarios and exports

Both final fixtures use the actual renderer and the production controller/action paths. The setup starts with no known targets, moderate hunger, a stocked pantry, an open home doorway and a physically validated front-home pose. A declared initial idle/search delay and one recorded normal zero-delta head-orientation action request a real stable initial frame. No sensor feedback, recognized fact or final shopping/eating choice is injected. Physiology and attention continue throughout.

The actual preflight image `diagnostics/town-increment1/lab-start-eyes.png` and its sidecar show readable pantry and exit patterns at the normal 80-degree field of view. Actual scenario evidence, rather than that preflight alone, establishes admission and later behavior.

| Final artifact | Actual outcome | Exact replay |
| --- | --- | --- |
| `diagnostics/town-increment1/final-shop-observed.zip` | **5/5 PASS**, COMPLETE, **50,118 bytes**, **236 records**. Pantry was actually observed at captured tick 1/attention tick 6 and remained stocked at 4; Lumi still selected the currently seen opportunity, bought one fruit, returned and consumed it once. Final balance 17; one body effect. | **PASS**, tick **76**, **20 inputs / 130 events** |
| `diagnostics/town-increment1/final-closed-observed.zip` | **5/5 PASS**, COMPLETE, **55,670 bytes**, **269 records**. Actual pantry recognition at attention tick 5, trip selected 6, actual closed-shop rejection 49, physical return 71, food selected 71/acquired 77/consumed 82. Balance remained 20; pantry stock became 3; one body effect. | **PASS**, tick **82**, **24 inputs / 148 events** |

Both bundles have no reported gaps/drops and **zero model requests**. Their `.zip.summary.json` and `.zip.inspection.json` files retain checks, coverage and canonical hashes. Independent fresh CLI replay logs are `final-shop-observed-replay.log` and `final-closed-observed-replay.log`.

| Canonical hash | Successful purchase | Closure and home fallback |
| --- | --- | --- |
| State | `36382749ad50d2345c4f5467e05d99d752fad5ef53834d6c23e87e84a40bc3fe` | `edb062ebb87684a23cda7c52cdc7022b63171d1eeda50db2fa4f8e35df7bd44d` |
| Events | `651fa978b96a88f656a08ce03e33c21dd5e15639b8aef016117e7d9892ca501d` | `fe193c8debed3ab579fe3bf4bae6be4c34c6033c67f070574a1e8331619d2246` |
| Runtime | `e2a0d128aa918ed5735fdf5a431c7f52fd361c1e3f2282959c74ef40bb1f58fd` | `13f2582b211965b2ac16ebd1c85d667108674fa2fb4f89d916bcae2b4decc085` |

```powershell
npm.cmd run town:lab -- --scenario shop --out diagnostics/town-lab/shop.zip
npm.cmd run town:lab -- --scenario shop-closed --out diagnostics/town-lab/closed.zip
npm.cmd run replay -- --bundle diagnostics/town-increment1/final-shop-observed.zip
npm.cmd run replay -- --bundle diagnostics/town-increment1/final-closed-observed.zip
```

Earlier `shop.zip`, `accepted-closed.zip` and `accepted-closed-v2.zip` retain failed/inconclusive development fixtures. They are not the accepted final scenarios. In particular, availability without an observed pantry did not count as successful fallback. Increasing an idle duration alone did not supply an observation; the final normal head-completion input provides the recorded capture intention.

### Ordinary viewer and actual-eye inspection

The root browser walkthrough used a separate disposable candidate on port 3030. It observed an upright trip through the real opened home/shop doorways, Follow camera tracking, the actual purchase/return/consumption timeline, and visible carried fruit while eating purchased food. A separate unforced trip also occurred in that disposable candidate. Desktop controls and the 390×844 narrow Observe layout were inspected; the temporary viewport was reset.

The actual normal-browser scenario's server-generated export is `diagnostics/town-increment1/browser-shop.zip`: **48,640 bytes**, COMPLETE, **231 records**, **18 inputs / 131 events**, fresh offline replay PASS at tick 86. Its own-app download response was HTTP 200/application ZIP. A browser-saved download was not confirmed; this artifact was retrieved from the scenario's scoped server export URL. `browser-shop-inspection.json` records this distinction. This earlier browser scenario preceded the final storefront-sign relocation; final geometry is exercised by the final scenarios above.

Four retained original renderer frames from that earlier browser run were retrieved with hashes matching the recorded frames: `browser-shop-eyes-{54,63,72,81}.png`. Their sidecars identify original actual captures. That inspection exposed a central noncolliding sign post in the shop doorway. The final geometry removes it and mounts the sign on the solid front-right wall.

Current-source actual-eye replay inspection images are `replay-eyes-approach.png`, `replay-eyes-purchased.png` and `replay-eyes-returned.png`, each with a source/tick/camera/backend sidecar. They show the post-free closed doorway, the inside checkout view and the actual returned heading facing the front wall. These are explicitly **diagnostic replay renders**, not replacement original attended frames or personal memories. No renderer or model is called by offline ZIP replay.

### Review, runtime and limits

Focused review findings about historical acoustic grouping, signed door migration, static slams and later rebound collision were corrected with regressions. Root owns the final independent review/PR status and the ordered relationship to the later two increments.

The canonical owner world was not reset, moved or used for a creator encounter. It remains the preserved history `90d139a5-e9a6-429d-98ac-a484539c9e24` on the normal 3001/5173 workflow; this slice's acceptance used disposable data. The temporary 3030 candidate was stopped. A worktree edit or push alone does not update the owner checkout. Actual owner rollout remains separately reported by the root.

Audible playback and rapid ear articulation were not independently captured in this walkthrough. The recognizer is an authored RGB mechanism, the opportunity policy is engineered reactive behavior, and these bounded trials do not establish learned preferences, full-day balance, social familiarity or independent hosting.
