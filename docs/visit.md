# Local owner Visit

Observe and Visit are different entry modes. Observe moves only the browser camera. Visit controls a separate persistent humanoid avatar in the same physical home, path and shop as Lumi. It never controls her body, needs, private knowledge or memories.

## Pair this browser

From the project terminal, configure one local owner credential:

```powershell
npm run owner:pair
```

The command shows a private credential. Restart the normal server to load it, then open `http://127.0.0.1:5173/`, choose **Visit**, and enter the credential in the password field. **Pair this browser** creates a local authenticated session; pairing does not spawn an avatar. Press **Enter Visit** separately when ready to enter the selected world.

The normal development viewer proxies Visit HTTP requests and its dedicated WebSocket to the same Node world. Vite preserves the browser's Host header so it matches Origin; strict Origin, session and CSRF validation remain active on the documented port 5173.

The credential is stored separately from world checkpoints, diagnostics and replay exports in the local user's `.autonomous-lumi/private` directory. It is not a creator-recognition cue. Do not place it in a URL, source file, screenshot or diagnostic bundle.

For an explicit credential replacement:

```powershell
npm run owner:pair -- --rotate
```

Restart the server after replacement so old sessions are revoked. Server restart also invalidates ephemeral control credentials while preserving the logical avatar and inventory.

## Move and interact

Visit uses a first-person camera at the server-owned avatar eye position. Solid walls remain visible. Your own body, held item and introduction/offer cues are hidden only in this local controlled view; authoritative inventory stays in the HUD. Observe and the actual Lumi sensor still see the physical avatar and its cues. Focus the scene, then:

- **W/A/S/D:** move forward, left, backward and right relative to your look.
- **Drag the view:** turn/look.
- **E** or **Interact:** use a nearby door, or attempt a checkout interaction.
- **At checkout:** select fruit or bread and press **Buy selected item**.
- **G** or **Deposit held food:** while stopped by the drop-off shelf on the inside back wall, leave your held fruit or bread in persistent storage. Cancel any pending in-person offer for that item first. The server confirms or rejects the deposit; sending the request is not completion.
- **Observe:** release control and return to the nonphysical Observe cameras.

Movement and interaction are intentions. The server applies bounded movement at fixed simulation ticks and validates collision, control generation, sequence, reach, stock, funds and ownership. A client never submits a finished position or an inventory assertion. The UI waits for the actual server outcome before reporting a purchase.

The Visit panel shows your credits, held item and inventory. Starting credits are configured world state, not wages or an invented history. Prices and the shop's actual opening/availability rules remain the same as [the shop increment](town.md). Basic home care remains independent of the owner or the shop.

## Reconnect, tabs and Observe

One tab controls the one eligible avatar. Another tab must use the explicit **Take control from another tab** action to revoke the prior control generation. Merely observing, opening a page, or pairing a browser cannot create another actor.

Switching to Observe leaves an existing avatar visibly parked, without autonomous actions that impersonate the absent owner. Refreshing/reconnecting can resume the same avatar and owned items after re-entering Visit. Losing focus clears held movement; disconnect, timeout and revocation also have server-side stop handling. Do not infer continued walking from a last frozen viewer frame.

Changing world/branch/run requires a new control grant. Old-run inputs cannot silently act on another experiment or fall back to LIVE. Server restart retains logical world state and rejects old ephemeral sessions and controls. The honest checkpoint recovery window still applies: uncommitted progress can be lost after an abrupt failure.

## What Lumi can perceive

The visitor body and held item are part of the same captured physical snapshot used by the ordinary renderer, actual first-person renderer, masks, visibility, acoustics and collision. They are not spectator-only meshes. Being authenticated or present in server state does not mean Lumi sensed or attended the visitor; walls, view direction, lighting and attention still matter.

The small foundational premise that a creator built Lumi and her world is separate from autobiography. Pairing and entering Visit do not identify the visitor as that creator, establish a relationship or force a greeting. The optional **Show introduction badge** provides an actual in-world cue that still requires readable attended evidence and successful encoding. Use **Offer held food** or **F** near Lumi for a real voluntary offer. See [offers and introduction](offers.md) for outcomes, identity boundaries and persistence.

Use isolated EXPERIMENT histories for acceptance visits and future introductions. Configuring owner access does not require spawning an avatar into the owner's LIVE world or consuming the first real LIVE encounter as a test.

Full remote accounts, guests, mobile first-person controls and independent hosting are outside this local prototype. Narrow Observe remains available; desktop keyboard/mouse is the primary Visit interface.

## Persistent drop-off

The shelf on the inside back wall is the single designated drop-off point. It stores up to four nonexpiring fruit/bread items. A successful deposit removes the item from your available inventory and places it in world custody; Observe, logout and disconnect do not reclaim or delete it. A full, blocked, stale or invalid interaction leaves inventory unchanged. Completed transaction history is bounded; active stored items and their receipts remain protected.

The normal viewer's **Persistent drop-off** card distinguishes an item waiting from actual notice, opening, collection and consumption. Its activity entries are observer history, not Lumi's diary. A deposit does not notify her cognition or force her to visit the shelf. She must encounter its actual visible indicator and contents through normal sensing and attention. Closed contents are not exposed to her; opening and collection are distinct physical actions, and food only affects her body through later validated eating.

No sender labels are attached in this milestone. Leaving an item does not identify you, invent a meeting, or rewrite earlier anonymous encounters. You can switch to **Observe**, disconnect the viewer, and return to the same eligible avatar and inventory while the deposited item remains in the running world. Normal checkpoint recovery applies: graceful shutdown attempts a final save; an abrupt failure may lose changes after the last committed checkpoint.
