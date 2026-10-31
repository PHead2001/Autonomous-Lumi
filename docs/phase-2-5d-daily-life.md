# Phase 2.5d daily-life measurements and recovery

The daily-life controller remains reactive: present attended hunger selects food,
present sleep/discomfort selects bed/rest, and known targets come from attended
sensor evidence. No schedule, hidden shop stock or future need is supplied. The
production physiological coefficients, serving size, pantry restock and action
durations needed no balance adjustment in these bounded trials.

## Reproduce

From the repository root with dependencies installed:

```powershell
npm.cmd run daily-life:lab -- --hours 24 --seed 13579 --out diagnostics/daily-life/nominal
npm.cmd run daily-life:lab -- --hours 72 --seed 24680 --adverse true --out diagnostics/daily-life/adverse
npm.cmd run daily-life:lab -- --scenario recovery --from diagnostics/daily-life/nominal.start.json --out diagnostics/daily-life/recovery-causal
npm.cmd run replay -- --bundle diagnostics/daily-life/nominal.learning.zip
npm.cmd run replay -- --bundle diagnostics/daily-life/nominal.food.zip
npm.cmd run replay -- --bundle diagnostics/daily-life/adverse.learning.zip
npm.cmd run replay -- --bundle diagnostics/daily-life/adverse.food.zip
npm.cmd run replay -- --bundle diagnostics/daily-life/recovery-causal.zip
npx.cmd tsx --test tests/daily-life-recovery.test.ts tests/physiology-v2.test.ts
```

All runs use isolated EXPERIMENT histories. The CLI does not load `.env`, create
provider requests, touch the spending ledger, or start the owner LIVE app. The
renderer closes in `finally`; there are no persistent web services in this CLI.
Use distinct output paths to retain previous runs. Seeds are deterministic;
new run identities make new artifact hashes identity-dependent.

## Measured trials

Recorded on Windows, Node v22.16.0, Intel i7-13700K. Both use supported 1 Hz fixed
logical steps with unchanged production rates and real action durations. The
declared initial pose is `(0, 2.4)`, facing the room. A normal head-completion and
automatic capture coordinator establish pantry and bed knowledge from actual
RGB before numerical endurance starts. No known anchors, semantic observation,
meal, selected action or final response is injected. The adverse genesis keeps
the home resources but makes the shop unavailable and gives Lumi zero credits.

| Measurement | Nominal, seed 13579 | Adverse, seed 24680 |
| --- | ---: | ---: |
| Exact endurance world duration | 86,400 s / 24 h | 259,200 s / 72 h |
| Actual host duration, setup and evidence included | 38.728 s | 119.826 s |
| Initial learning world duration, before trial | 27 s | 49 s |
| Actual initial RGB captures / failures | 4 / 0 | 3 / 0 |
| Awake | 72,924 s | 205,243 s |
| Sleeping | 13,476 s (15.60% total) | 53,957 s (20.82% total) |
| Incapacitated | 0 s | 0 s |
| Compulsory awake maintenance | 144 s | 275 s |
| Maintenance / awake | **0.1975%** | **0.1340%** |
| Free time, including ordinary wandering | 72,780 s | 204,968 s |
| Optional checkpointed activity | 0 s | 0 s |
| Production home food consumed | 2 servings | 7 servings |
| Bed sleeps / completed rest tasks | 1 / 1 | 4 / 4 |
| Shop purchases, maintenance failures/retries | 0, 0 / 0 | 0, 0 / 0 |
| Severe cue crossings / eligible misses | 0 / 0 | 0 / 0 |
| Urgent-attention latency | N/A, no crossing | N/A, no crossing |
| Final condition / reserves, private evaluation only | 1 / 0.7968 | 1 / 0.7306 |
| Model requests / actual cost | 0 / $0 | 0 / $0 |

Maintenance accounting includes all active food/rest routes and action stages,
searching, held food, rest, and waiting with a currently attended moderate/severe
need. Evaluator-only thresholds also conservatively count unmet hunger/sleep
after a transient cue expires, and awake weakness recovery. These exact values
never enter the voluntary controller. Sleeping and incapacitation are separate
from awake time. No needs were disabled or rates accelerated; short prototype
travel and eating actions explain the small upkeep fraction.

The existing urgent-attention regressions were rerun with the new focused tests:
**12/12 PASS**. Suppressed ordinary attention still yields an attended severe cue
at tick 30 after crossing at tick 1: **29 eligible world seconds**, within the
30-second bound, independently of encoding/model availability. The trial report
does not present ordinary sensations as fabricated zero-latency urgent episodes.

Fresh numerical images are **not claimed** during accelerated endurance. The
known home layout remains unchanged; queued capture intentions may expire while
no renderer is being pumped. The reports retain their full event-type counts
(including 6,078 / 17,748 capture intentions and 14,887 / 41,264 capture-policy
events). Actual learning captures succeeded with no dropped/unavailable frames;
those successes do not certify later unrendered discoveries. Representative
food windows also make no new visual claim. Initial resource-discovery latency
is explicitly outside the subsequent 24/72-hour interval.

## Critical recoverability

A focused production-rate body run, with no intake effects, reaches zero
reserves, no absorption and incapacity after neglect. Historical rules remain
stuck at the 0.1 condition floor after 150 hours and another 12 hours: recovery
required reserves that an unconscious character could no longer obtain.

Current `lumi-daily-v1` checkpoints select the new `daily-life-v1` body policy.
Historical checkpoints keep their original policy. Incapacitated rest now
restores **condition/capability only**, at the existing condition-recovery rate,
even at zero reserves. It does not replenish reserves or satiety, consume food,
increment the intake cursor, teleport, or create an experience. Actual severe
hunger remains when she wakes and drives ordinary food acquisition. Engine
`BODY_RECOVERY_STARTED` / `BODY_RECOVERY_COMPLETED` events explicitly describe
rest in place without nutrition. This is reversible artificial-body weakness,
not an invented rescue, eaten meal or organic-biology claim.

The COMPLETE `recovery-causal.zip` uses a separately declared overdue initial
state copied from the legitimately learned-layout checkpoint: awake condition
0.200001, zero satiety/reserves/absorption, sleep pressure 0.8. It is **not claimed
that this fixture naturally evolved from the nominal trial**. The next ordinary
deficit step causes real collapse. Recovery completes at tick 15,457 from start
tick 27 (15,430 elapsed seconds), still at `(0, 2.4)`. A valid pantry route then
produces the first actual nutrition at tick 15,469, 12 seconds later. Exactly one
intake and consumption commit; later legitimate rest/wake effects account for
the other body-effect sequence increments. There are no new visual memories
while unconscious. A mid-recovery copy restores without changing the checkpoint
hash; a separate regression compares full continued state/events through wake.

A focused current-policy local-care test also proves that unavailable fresh
images, disabled personal encoding and a full external input queue do not veto
food acquisition from an already observed layout. The test's known anchor is a
declared unit fixture; actual establishment is independently covered above.
Existing action restore/interruption and checkpoint-capacity regressions remain
part of the ordinary suite; these do not claim limitless memory or observation.

## Evidence scope and replay

Whole-trial `.start.json`, `.end.json` and `.summary.json` retain aggregate counts,
hourly state samples, configuration and canonical state/event hashes. Full-trial
exact replay is **not claimed**: the numerical aggregate is not a reconstructed
flight-recorder prefix. Initial learning and selected-action copies form bounded
independent causal windows, with ordinary retention unchanged.

Five final sanitized ZIPs are **COMPLETE**, have no writer/drop/eviction gaps and
pass independent CLI replay without rendering or provider calls:

| Window | Exact replay scope |
| --- | --- |
| `nominal.learning.zip` | Actual initial RGB and admitted home knowledge |
| `adverse.learning.zip` | Second-seed actual initial RGB and admitted home knowledge |
| `nominal.food.zip` | Copied selected-action checkpoint, ticks 33,746–33,755; 11 events |
| `adverse.food.zip` | Copied selected-action checkpoint, ticks 33,546–33,560; 18 events |
| `recovery-causal.zip` | Overdue fixture, collapse/rest/recovery/real food; ticks 27–15,515; 58 events |

The first recovery export was correctly INCOMPLETE because two new event fields
were outside the sanitization allowlist. Recovery events now use the existing
allowed `policy`, `cause` and `reason` contract, and the final causal export
replays exactly. This was a schema-evidence correction, **not an OS writer
failure**, and does not diagnose or resolve the historic 2.5c writer failures.

These accelerated experiments establish world-time behavior, not 24/72 hours of
continuous 1× desktop uptime. They do not change power settings, simulate missed
host time, activate the owner's world, or verify independent hosting. Normal
viewer/session/delivery walkthrough and canonical migration handoff are recorded
separately in the milestone's integrated results.
