import './dashboard.css';
import { EXPERIMENT_PLAYBACK, type ActiveTarget, type BranchSummary, type ControlAction } from '../shared/lab-protocol';
import { selectTimelineRun, type PendingRestoredRun } from './dashboard-selection';
import { parsePlaybackSpeed, playbackPresentation } from './dashboard-playback';
import { runCapturedControl } from './dashboard-control';
import type { WorldState } from '../shared/protocol';
import type { HeadAction } from '../shared/vision-protocol';
import type { CaptureMetadata, CaptureView } from '../shared/capture-protocol';
import type { AttentionState } from '../shared/attention-protocol';
import { eyePose } from '../shared/eye-pose';
import { VisionCaptureDeadline, VisionRequestGate, displayedCapture, validateCaptureViewScope, visionScopeKey } from './dashboard-vision';
import { cognitionActionLabel, cognitionFrameUrl, modelResponseMetric, selectCognitionRequest, validateCognitionViewScope, type CognitionView } from './dashboard-cognition';

interface TimelineRecord {
  event_id: string; world_id: string; branch_id: string; run_id: string;
  category: string; event_type: string; component: string; severity: string; outcome: string;
  world_tick: number; world_elapsed_seconds: number; utc: string;
  causal_event_id?: string; input_sequence?: number; data: Record<string, unknown>;
}
interface TimelineResponse { scope: ActiveTarget; records: TimelineRecord[]; health: unknown; coverage: unknown }
interface ExportResponse { downloadUrl: string; manifest: { evidence_status: string; coverage?: unknown }; assertions?: unknown }
interface RecoveryPoint { tick: number; worldTime: number; savedAt: string; generation: number }
interface RecoveryStatus { historyId: string; status: 'fresh' | 'recovered' | 'override'; lastCommitted: RecoveryPoint | null; saveError: string | null; recovered: RecoveryPoint | null; fallback: boolean; intervalMs: number; checkpointAgeMs: number | null }
interface SavedCheckpoint { worldId: string; branchId: string; id: string; tick: number; mode: 'LIVE' | 'EXPERIMENT'; historyId: string | null; legacy: boolean }
interface CheckpointCatalog { checkpoints: SavedCheckpoint[]; errors: { source: string; error: string }[] }
interface DashboardBranch extends BranchSummary { state?: WorldState }
interface AttentionView extends ActiveTarget { attention: AttentionState | null; automatic: Record<string, unknown> }

const key = (target: { worldId: string; branchId: string }) => `${target.worldId}/${target.branchId}`;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const format = (value: unknown, digits = 2) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : 'Unavailable';

export function mountDashboard(): void {
  document.title = 'Lumi · Experiment laboratory';
  document.body.classList.add('lab-page');
  document.getElementById('app')!.innerHTML = `
    <header class="lab-header"><a class="brand" href="/">lumi<span> / experiment laboratory</span></a><a class="lab-return" href="/">Open LIVE viewer ↗</a></header>
    <main class="lab-main">
      <div class="lab-heading"><div><p class="eyebrow">PHASE 2c · LOCAL DEVELOPMENT</p><h1>A place to try things.</h1><p>Isolated branches, sight-limited interpretation, and trustworthy experience evidence.</p></div><span class="lab-local">Local / private</span></div>
      <div id="lab-message" class="lab-message" role="status" aria-live="polite">Connecting to the laboratory…</div>
      <section class="lab-selection lab-panel" aria-label="World and branch selection">
        <label class="lab-field lab-select-field">World / branch<select id="lab-branch" aria-label="World and branch"></select></label>
        <div class="lab-identity"><span id="lab-mode" class="lab-badge">—</span><strong id="lab-state">Waiting</strong><code id="lab-scope">No branch selected</code><span id="lab-run">Run —</span></div>
        <a id="lab-viewer" class="lab-button secondary" href="/" target="_blank" rel="noopener">View selected room ↗</a>
        <button id="lab-refresh" class="lab-button secondary">Refresh</button>
      </section>
      <section class="lab-metrics" aria-label="Selected branch evidence">
        <article class="lab-panel lab-metric"><p class="lab-label">WORLD TRUTH</p><strong id="lab-tick">—</strong><span id="lab-world-time">Exact elapsed time</span></article>
        <article class="lab-panel lab-metric"><p class="lab-label">SUBJECTIVE ESTIMATE</p><strong id="lab-subjective">—</strong><span id="lab-uncertainty">Uncertainty —</span><small id="lab-calibration">No synthetic clock calibration</small></article>
        <article class="lab-panel lab-metric"><p class="lab-label">GENERIC ACTIVITY</p><strong id="lab-activity">—</strong><progress id="lab-progress" max="1" value="0"></progress><span id="lab-activity-detail">No activity</span></article>
        <article class="lab-panel lab-metric"><p class="lab-label">MAIN MODEL RESPONSE METRIC</p><strong id="lab-model-metric">N/A</strong><span>world_seconds_per_model_response</span><small id="lab-model-metric-note">No successful main response samples.</small></article>
      </section>
      <section class="lab-panel lab-cognition" aria-labelledby="lab-cognition-heading">
        <div class="lab-section-title"><div><h2 id="lab-cognition-heading">Interpretation & experience</h2><p class="lab-note">Provider proposals are advisory. Local validation, action execution and experience encoding are separate outcomes. Interpretation is fallible; no internal monologue is shown.</p></div><span id="lab-cognition-status" class="lab-badge">Waiting</span></div>
        <p id="lab-cognition-scope" class="lab-note">Select a current branch/run.</p><p id="lab-cognition-error" class="lab-note warning" role="status"></p><p id="lab-cognition-availability" class="lab-note">Loading server configuration.</p>
        <div class="lab-health-grid"><div><span>Main interpretation route</span><strong id="lab-cognition-route">Unavailable</strong></div><div><span>Application-wide budget</span><strong id="lab-cognition-budget">Unavailable</strong></div><div><span>Pending / provider queue</span><strong id="lab-cognition-pending">Unavailable</strong></div><div><span>Optional Decisions</span><strong id="lab-decisions-status">Unavailable</strong></div></div><p id="lab-decisions-metric" class="lab-note">Decisions measurements: N/A.</p><details><summary>Safe configuration, host limits & accounting</summary><pre id="lab-cognition-config">No configuration loaded.</pre></details>
        <div class="lab-divider"></div><label class="lab-field">Inspected interpretation request<select id="lab-cognition-request"><option value="">No requests for this run</option></select></label>
        <div class="lab-columns lab-cognition-columns"><div><h3>Actual associated observation</h3><div class="lab-cognition-frame"><img id="lab-cognition-image" alt="Actual first-person frame bound to the selected interpretation request" hidden><p id="lab-cognition-image-empty" class="lab-note">No selected image.</p></div><p id="lab-cognition-frame-note" class="lab-note">A request never substitutes whichever image is latest.</p><details><summary>Filtered context sent for interpretation</summary><p class="lab-note">This allowlisted sensory context is separate from the private source/geometry diagnostics below. Full images are sent privately to the configured provider, not publicly hosted.</p><pre id="lab-cognition-context">No selected context.</pre></details></div>
          <div><h3>Interpretation · model estimate</h3><p id="lab-cognition-interpretation" class="lab-note">No interpretation.</p><p id="lab-cognition-uncertainty" class="lab-note">Uncertainty N/A.</p><h3>Proposed → validated → executed</h3><pre id="lab-cognition-proposed">No action proposal.</pre><p id="lab-cognition-action" class="lab-note">No local action outcome.</p><p class="lab-note">“Started / queued” means a local action began or a capture intention was queued. It does not prove the physical action completed or its intended outcome occurred.</p><h3>Encoding outcome</h3><p id="lab-cognition-encoding" class="lab-note">No encoding outcome.</p><details><summary>Request/result timing, usage & cost basis</summary><pre id="lab-cognition-metadata">No selected request.</pre></details></div></div>
        <div class="lab-divider"></div><h3>Admitted real experiences · selected world</h3><p class="lab-note">Only successfully admitted records appear here. These are fallible perceived interpretations with original provenance, separate from diagnostics and the experiment-only TEST STUB harness. An intention is not a completed action.</p><div id="lab-real-experiences" class="lab-experiences"><p class="lab-note">No real experience records loaded.</p></div>
      </section>
      <section class="lab-panel lab-attention" aria-labelledby="lab-attention-heading">
        <div class="lab-section-title"><div><h2 id="lab-attention-heading">Hearing & selective attention</h2><p class="lab-note">Local sensor and motor decisions. Hearing or capturing alone does not identify a source or encode personal experience; interpretation and admission have separate gates above.</p></div><span id="lab-attention-status" class="lab-badge">Waiting</span></div>
        <p id="lab-attention-scope" class="lab-note">Select a current branch/run.</p><p id="lab-attention-error" class="lab-note warning" role="status"></p>
        <div class="lab-columns">
          <div><h3>Received evidence · SIMULATED HEARING</h3><p id="lab-heard-summary" class="lab-note">No received sound in this run.</p><p id="lab-reflex-summary" class="lab-note">No reflex evidence loaded.</p><details><summary>Receiver-facing sound evidence</summary><pre id="lab-heard-json">No received evidence.</pre></details><details class="lab-attention-truth"><summary>Private source & propagation truth</summary><p class="lab-note">Exact positions, source identities and barriers are developer measurements. They are excluded from the received evidence above. Recorded traces may lag the current state while the writer flushes.</p><pre id="lab-sound-truth">No recorded source evidence loaded.</pre></details></div>
          <div><h3>Local attention</h3><p id="lab-attention-decision" class="lab-note">No attention decision yet.</p><p id="lab-attention-commitment" class="lab-note">No commitment evidence.</p><p id="lab-attention-action" class="lab-note">No automatic head action.</p><details><summary>Decision factors & bounded adaptation</summary><pre id="lab-attention-json">No attention state.</pre></details></div>
        </div>
        <div class="lab-divider"></div><h3>Automatic capture policy</h3><p id="lab-auto-intent" class="lab-note">No capture intention.</p><p id="lab-auto-result" class="lab-note">No automatic sensor result.</p><div class="lab-auto-preview"><img id="lab-auto-image" alt="Frame associated with the latest automatic sensor result" hidden><p id="lab-auto-image-empty" class="lab-note">No successful automatic frame.</p></div><p id="lab-auto-frame" class="lab-note">Associated frames retain their original capture tick.</p><details><summary>Host admission, quotas & logical capture state</summary><pre id="lab-auto-json">No automatic capture state.</pre></details>
        <details><summary>Experiment sound fixture</summary><p class="lab-note">Emit a labelled TEST STUB world sound only in the selected experiment. It propagates through the physical scene before the reflex and attention evaluate it. Coordinates below are private room units; strength and onset are normalized 0–1 game values. A paused experiment must step or resume to apply the queued emission.</p><button id="lab-sound-place" class="lab-button text experiment">Place source 1 unit ahead of the listening pose</button><div class="lab-inline"><label class="lab-field">Source X<input id="lab-sound-x" type="number" min="-20" max="20" step="0.1" value="0"></label><label class="lab-field">Source Y<input id="lab-sound-y" type="number" min="-20" max="20" step="0.1" value="2.4"></label><label class="lab-field">Source Z<input id="lab-sound-z" type="number" min="-20" max="20" step="0.1" value="0"></label><label class="lab-field">Strength<input id="lab-sound-intensity" type="number" min="0" max="1" step="0.05" value="1"></label><label class="lab-field">Suddenness<input id="lab-sound-suddenness" type="number" min="0" max="1" step="0.05" value="1"></label><label class="lab-field">Private fixture ID<input id="lab-sound-id" value="test-cue" maxlength="100" pattern="[A-Za-z0-9_-]+"></label><button id="lab-sound-emit" class="lab-button secondary experiment">Emit experiment sound</button></div><p class="lab-note">Repeat the same perceived cue to inspect habituation. Change its received strength, direction or onset to test renewed attention; changing only its private ID does not make it perceptually novel.</p></details>
      </section>
      <section class="lab-panel lab-vision" aria-labelledby="lab-vision-heading">
        <div class="lab-section-title"><div><h2 id="lab-vision-heading">Virtual Eyes</h2><p class="lab-note">Manual and bounded automatic captures from Lumi’s physical viewpoint. A capture alone does not establish attention, interpretation or encoding. Only eligible selected observations enter the enabled cognition path.</p></div><span id="lab-vision-status" class="lab-badge">No capture</span></div>
        <p id="lab-vision-scope" class="lab-note">Select a current branch/run.</p>
        <div class="lab-vision-columns">
          <div>
            <div class="lab-vision-frame"><img id="lab-vision-image" alt="Lumi’s captured first-person sensor frame" hidden><p id="lab-vision-empty">No image has been captured for this run.</p></div>
            <p id="lab-vision-caption" class="lab-note">Missing images are missing observations.</p>
            <div class="lab-inline"><label class="lab-field">Capture resolution<select id="lab-vision-resolution"><option value="256">256 × 256</option><option value="512" selected>512 × 512</option><option value="1024">1024 × 1024</option></select></label><label class="lab-field">Capture reason<select id="lab-vision-reason"><option value="developer">Developer</option><option value="diagnostic">Diagnostic</option></select></label><button id="lab-vision-capture" class="lab-button vision-control">Capture viewpoint</button><button id="lab-vision-refresh" class="lab-button secondary vision-control">Refresh captures</button></div>
            <p id="lab-vision-operation" class="lab-note" role="status" aria-live="polite"></p><p id="lab-vision-cleanup" class="lab-note warning" role="status"></p><p id="lab-vision-limits" class="lab-note"></p>
            <details><summary>Capture identity, pose, image hash and backend</summary><pre id="lab-vision-metadata">No capture.</pre></details>
          </div>
          <div>
            <h3>Server-owned head</h3><p id="lab-head-state" class="lab-note">Waiting for head state.</p><p class="lab-note">Yaw ±75°; pitch −40° down to +45° up; maximum turn rate 90°/s. Angles below are degrees. Positive yaw turns toward room +X; positive pitch looks up.</p>
            <div class="lab-inline"><label class="lab-field">Turn Δ yaw<input id="lab-head-delta-yaw" type="number" min="-150" max="150" step="1" value="20"></label><label class="lab-field">Turn Δ pitch<input id="lab-head-delta-pitch" type="number" min="-85" max="85" step="1" value="0"></label><button id="lab-head-turn" class="lab-button secondary vision-control">Turn head</button></div>
            <div class="lab-inline"><label class="lab-field">Body-relative look yaw<input id="lab-head-look-yaw" type="number" min="-75" max="75" step="1" value="0"></label><label class="lab-field">Look pitch<input id="lab-head-look-pitch" type="number" min="-40" max="45" step="1" value="0"></label><button id="lab-head-look" class="lab-button secondary vision-control">Look in direction</button></div>
            <div class="lab-inline"><label class="lab-field">Scan minimum yaw<input id="lab-head-scan-min" type="number" min="-75" max="75" value="-45"></label><label class="lab-field">Scan maximum yaw<input id="lab-head-scan-max" type="number" min="-75" max="75" value="45"></label><label class="lab-field">Scan pitch<input id="lab-head-scan-pitch" type="number" min="-40" max="45" value="0"></label><label class="lab-field">Scan passes<input id="lab-head-scan-passes" type="number" min="1" max="4" value="1"></label></div><div class="lab-button-row"><button id="lab-head-scan" class="lab-button secondary vision-control">Scan area</button><button id="lab-head-cancel" class="lab-button text vision-control">Cancel head action</button></div>
            <p class="lab-note">Commands apply in order on the next fixed tick. Relative turns add to the head pose at execution and clamp the target to the angle limits. A paused experiment must step or resume before a queued action takes effect. New actions interrupt the old action without snapping the head.</p>
            <div class="lab-divider"></div><h3>Filtered observation</h3><p class="lab-note">Unknown shapes with observation-scoped handles, approximate bearings and sampled visibility. These are geometric samples, not recognized identities or exact visible-pixel fractions.</p><div class="lab-inline"><label class="lab-field">Eligible observed shape<select id="lab-vision-target"><option value="">Capture a visible shape first</option></select></label><button id="lab-head-target" class="lab-button secondary vision-control">Look toward observed bearing</button></div><p id="lab-vision-target-note" class="lab-note"></p><pre id="lab-vision-observation">No successful observation.</pre>
            <details class="lab-vision-truth"><summary>Private developer world-truth comparison</summary><p class="lab-note">Engine identifiers and exact measurements below are private diagnostics. They are excluded from the filtered observation.</p><pre id="lab-vision-truth">No private measurement.</pre></details>
          </div>
        </div>
        <details id="lab-vision-fixture"><summary>Experiment scene fixture</summary><p class="lab-note">Changes only the selected experiment’s physical scene. LIVE rejects these controls. Apply, then step/resume, and request a fresh capture. A scene change invalidates old observation targets.</p><div class="lab-inline"><label class="lab-field">Geometry fixture<select id="lab-scene-fixture"><option value="none">Room only</option><option value="visibility">Visibility test objects</option></select></label><label class="lab-field">Illumination (0–1)<input id="lab-scene-light" type="number" min="0" max="1" step="0.01" value="1"></label><label class="lab-field">Fixture color<input id="lab-scene-color" type="color" value="#ed6050"></label><label class="lab-field">Door override<select id="lab-scene-door"><option value="animated">Normal slam animation</option><option value="closed">Closed</option><option value="open">Open −90°</option></select></label><button id="lab-scene-apply" class="lab-button secondary experiment">Apply scene fixture</button></div><p id="lab-scene-state" class="lab-note"></p></details>
      </section>
      <section class="lab-panel lab-recovery" aria-labelledby="lab-recovery-heading"><div class="lab-section-title"><h2 id="lab-recovery-heading">LIVE recovery</h2><span id="lab-recovery-status" class="lab-badge">Waiting</span></div><p id="lab-history" class="lab-note">History —</p><div class="lab-health-grid"><div><span>Last committed recovery point</span><strong id="lab-recovery-committed">Unavailable</strong></div><div><span>Startup recovery</span><strong id="lab-recovery-startup">Unavailable</strong></div></div><p id="lab-recovery-detail" class="lab-note">Waiting for recovery status.</p><p id="lab-recovery-error" class="lab-note warning"></p><p class="lab-note">A crash can lose progress after the last committed save. Server downtime does not advance lived world time. Recovery remains separate from diagnostic replay coverage.</p></section>
      <div class="lab-columns">
        <section class="lab-panel" aria-labelledby="lab-control-heading"><div class="lab-section-title"><h2 id="lab-control-heading">Experiment controls</h2><span id="lab-speed-label">—</span></div><p id="lab-control-note" class="lab-note">Select an experiment to change time or inject test observations. LIVE remains at 1×.</p>
          <div class="lab-button-row"><button id="lab-pause" class="lab-button experiment">Pause</button><button id="lab-resume" class="lab-button secondary experiment">Resume</button><button id="lab-step" class="lab-button secondary experiment">Step one tick</button></div>
          <div class="lab-inline"><label class="lab-field">Requested unpaused speed<input id="lab-speed" type="number" min="1" max="${EXPERIMENT_PLAYBACK.maxSpeed}" step="any" value="${EXPERIMENT_PLAYBACK.defaultSpeed}"></label><button id="lab-set-speed" class="lab-button secondary experiment">Set speed</button></div><p id="lab-achieved-speed" class="lab-note">Achieved —</p><p id="lab-playback-detail" class="lab-note">Collecting a playback sample.</p>
          <div class="lab-inline"><label class="lab-field">Fast-forward ticks<input id="lab-forward-ticks" type="number" min="1" max="100000" step="1" value="300"></label><button id="lab-forward" class="lab-button secondary experiment">Fast-forward</button><button id="lab-cancel-forward" class="lab-button text experiment">Cancel</button></div><p id="lab-forward-state" class="lab-note">No fast-forward work pending.</p>
          <div class="lab-divider"></div><h3>Checkpointed activity</h3><p class="lab-note">A simple tick-count task. Saved progress and milestone effects resume exactly once.</p><div class="lab-inline"><label class="lab-field">Duration in ticks<input id="lab-activity-ticks" type="number" min="1" max="100000" step="1" value="120"></label><button id="lab-activity-start" class="lab-button secondary experiment">Start activity</button></div><div class="lab-button-row"><button id="lab-activity-pause" class="lab-button secondary experiment">Pause activity</button><button id="lab-activity-resume" class="lab-button secondary experiment">Resume activity</button></div>
        </section>
        <section class="lab-panel" aria-labelledby="lab-checkpoint-heading"><h2 id="lab-checkpoint-heading">Checkpoints & forks</h2><p class="lab-note">Forking copies a recorded checkpoint into an independent experiment. Restores are restricted to the selected experiment.</p><button id="lab-save" class="lab-button secondary">Record checkpoint</button><label class="lab-field lab-wide">Recorded checkpoint<select id="lab-checkpoint" aria-label="Recorded checkpoint"></select></label><p id="lab-checkpoint-detail" class="lab-note">—</p><div class="lab-inline"><label class="lab-field">New experiment branch<input id="lab-new-branch" placeholder="experiment-1" value="experiment-1" pattern="[A-Za-z0-9_-]+" maxlength="64"></label><button id="lab-fork" class="lab-button">Fork experiment</button></div><button id="lab-restore" class="lab-button secondary experiment">Restore selected checkpoint</button><p class="lab-note">Restoration creates a new run. Old controls cannot change that replacement run. Experiments cannot restore into LIVE.</p>
          <div class="lab-divider"></div><h3>Reopen a saved experiment</h3><p class="lab-note">Load a validated checkpoint from disk into a fresh experiment branch. This catalog survives application restarts.</p><label class="lab-field">Saved experiment checkpoint<select id="lab-saved-checkpoint" aria-label="Saved experiment checkpoint"></select></label><p id="lab-catalog-detail" class="lab-note">Loading saved checkpoints…</p><div class="lab-inline"><label class="lab-field">Reopened experiment branch<input id="lab-reopen-branch" value="experiment-restored" maxlength="64"></label><button id="lab-reopen" class="lab-button secondary">Reopen saved experiment</button></div><label class="lab-checkbox"><input id="lab-allow-legacy" type="checkbox"> Explicitly import a legacy checkpoint with unverified history</label><p class="lab-note">Legacy import is deliberate and experiment-only. Unsupported saved playback speeds fail with an explanation.</p><button id="lab-refresh-catalog" class="lab-button text">Refresh saved checkpoints</button>
        </section>
      </div>
      <div class="lab-columns">
        <section class="lab-panel lab-stub" aria-labelledby="lab-stub-heading"><div class="lab-section-title"><h2 id="lab-stub-heading">Synthetic observation harness</h2><span class="lab-badge stub">TEST STUB</span></div><p class="lab-note">Experiment-only injected cues. These controls do not represent real sight, hearing, or a watch reading.</p><div class="lab-checks"><label><input id="lab-sensed" type="checkbox" checked> Sensed</label><label><input id="lab-attended" type="checkbox"> Attended</label><label><input id="lab-encoded" type="checkbox"> Encoded</label></div><button id="lab-cue" class="lab-button secondary experiment">Inject synthetic cue</button><p class="lab-note">Only sensed, attended <em>and</em> encoded observations enter this experiment’s FOX_EXPERIENCE.</p><div class="lab-divider"></div><h3>Synthetic clock check</h3><div class="lab-inline"><label class="lab-field">Observed seconds<input id="lab-clock-seconds" type="number" min="0" step="0.1" value="10"></label><label class="lab-field">Uncertainty ± seconds<input id="lab-clock-uncertainty" type="number" min="0" step="0.1" value="0.5"></label></div><button id="lab-clock" class="lab-button secondary experiment">Inject synthetic clock observation</button><p class="lab-note">Calibration uses the same eligibility gates. Exact world time remains developer truth.</p></section>
        <section class="lab-panel" aria-labelledby="lab-health-heading"><div class="lab-section-title"><h2 id="lab-health-heading">Flight recorder</h2><span id="lab-health-status" class="lab-badge">—</span></div><div class="lab-health-grid"><div><span>Writer backlog</span><strong id="lab-backlog">—</strong></div><div><span>Dropped / disabled</span><strong id="lab-drops">—</strong></div><div><span>Retained disk</span><strong id="lab-disk">—</strong></div><div><span>Replay evidence</span><strong id="lab-replay-result">Not checked</strong></div></div><p id="lab-gaps" class="lab-note">—</p><div class="lab-inline"><label class="lab-field">Logging detail<select id="lab-logging-mode"><option value="off">OFF</option><option value="default" selected>Default</option><option value="verbose">Verbose</option></select></label><label class="lab-checkbox"><input id="lab-compression" type="checkbox"> Compress closed logs</label><button id="lab-logging-apply" class="lab-button secondary experiment">Apply logging</button></div><p class="lab-note">OFF disables diagnostic evidence, not simulation. Disabled or missing evidence is reported as INCOMPLETE.</p><details><summary>Recorder health details</summary><pre id="lab-health-json"></pre></details></section>
      </div>
      <section class="lab-panel lab-hashes" aria-label="Canonical hashes"><h2>Canonical evidence</h2><div><span>Simulation state</span><code id="lab-state-hash">—</code></div><div><span>Deterministic events</span><code id="lab-event-hash">—</code></div><div><span>Complete runtime</span><code id="lab-runtime-hash">—</code></div><p class="lab-note">Runtime evidence includes control and scheduler state. Hashes are verification data, not character knowledge.</p></section>
      <section class="lab-panel" aria-labelledby="lab-timeline-heading"><div class="lab-section-title"><div><h2 id="lab-timeline-heading">Causal timeline</h2><p class="lab-note">Every record and link stays inside the selected world, branch and run.</p></div><button id="lab-export" class="lab-button">Export diagnostic ZIP</button></div>
        <form id="lab-filters" class="lab-filters"><label class="lab-field">Run<select id="lab-filter-run"></select></label><label class="lab-field">Category<select id="lab-category"><option value="">All four categories</option><option>WORLD_TRUTH</option><option>FOX_EXPERIENCE</option><option>PRIVATE_SENSOR</option><option>OPERATIONAL_REPLAY</option></select></label><label class="lab-field">Event class<input id="lab-event-type" placeholder="REFLEX_STATE"></label><label class="lab-field">Component<input id="lab-component" placeholder="reflex"></label><label class="lab-field">Severity<select id="lab-severity"><option value="">All severities</option><option>debug</option><option>info</option><option>warn</option><option>error</option></select></label><label class="lab-field">Causal identifier<input id="lab-causal" placeholder="simulation:9"></label><label class="lab-field">From tick<input id="lab-from" type="number" min="0" step="1" placeholder="Start"></label><label class="lab-field">To tick<input id="lab-to" type="number" min="0" step="1" placeholder="Latest"></label><label class="lab-field lab-search">Search<input id="lab-search" type="search" placeholder="Event, outcome or measured factors"></label><button class="lab-button secondary" type="submit">Apply filters</button><button id="lab-clear-filters" class="lab-button text" type="button">Clear</button></form>
        <div class="lab-category-key"><span>WORLD_TRUTH · authoritative facts</span><span>FOX_EXPERIENCE · trusted real admission / experiment TEST STUB</span><span>PRIVATE_SENSOR · gate / sensor traces</span><span>OPERATIONAL_REPLAY · developer evidence</span></div>
        <p id="lab-timeline-coverage" class="lab-note"></p><div class="lab-table-scroll"><table class="lab-table"><thead><tr><th>Tick / time</th><th>Source category</th><th>Event / outcome</th><th>Component / severity</th><th>Scoped references & measured data</th></tr></thead><tbody id="lab-timeline"></tbody></table></div>
      </section><footer class="lab-footer"><span>LIVE stays at 1×. Experiment state and experiences never flow back to LIVE.</span><a href="/">Return to Lumi’s room</a></footer>
    </main>`;

  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const val = (id: string) => el<HTMLInputElement | HTMLSelectElement>(id).value;
  const text = (id: string, value: string) => { el(id).textContent = value; };
  const branches = el<HTMLSelectElement>('lab-branch');
  let summaries: DashboardBranch[] = [], current: DashboardBranch | undefined, selected = '', busy = false, stopped = false;
  let filterGeneration = 0, renderedIdentity = '', refreshGeneration = 0;
  let restoredRunSelection: PendingRestoredRun | undefined;
  let recovery: RecoveryStatus | null | undefined, catalog: CheckpointCatalog = { checkpoints: [], errors: [] }, catalogLoaded = false;
  const lastExports = new Map<string, string>();
  const visionGate = new VisionRequestGate();
  let visionView: CaptureView | null = null, visionScope = '', visionDirty = true, visionLoading = false, visionError = '';
  const visionDeadline = new VisionCaptureDeadline();
  let visionAbort: AbortController | undefined;
  const attentionGate = new VisionRequestGate();
  let attentionView: AttentionView | null = null, attentionTrace: TimelineRecord[] = [], attentionScope = '', attentionLoading = false, attentionError = '', autoCaptureIdentity = '';
  let attentionAbort: AbortController | undefined;
  const cognitionGate = new VisionRequestGate();
  let cognitionView: CognitionView | null = null, cognitionScope = '', cognitionLoading = false, cognitionError = '', inspectedCognitionRequest = '';
  let cognitionAbort: AbortController | undefined;
  const message = (value: string, error = false) => { text('lab-message', value); el('lab-message').classList.toggle('error', error); };
  const active = (): ActiveTarget => {
    if (!current) throw new Error('Select a branch first.');
    return { worldId: current.worldId, branchId: current.branchId, runId: current.runId };
  };
  async function request<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(url, body === undefined ? { cache: 'no-store', signal } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    if (!response.ok) {
      let detail = `Request failed (${response.status})`;
      try { const result = await response.json(); detail = typeof result.error === 'string' ? result.error : detail; } catch { /* The status remains useful for a non-JSON response. */ }
      throw new Error(detail);
    }
    return response.json() as Promise<T>;
  }
  function number(id: string, min: number, max: number, integer = true): number {
    const input = val(id), value = Number(input);
    if (!input.trim() || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) throw new Error(`Enter a valid ${el<HTMLInputElement>(id).labels?.[0]?.textContent?.trim() ?? 'number'} (${min}–${max}).`);
    return value;
  }
  function options(select: HTMLSelectElement, values: { value: string; label: string }[], preferred: string) {
    const unchanged = select.options.length === values.length && values.every((item, i) => select.options[i].value === item.value && select.options[i].text === item.label);
    if (!unchanged) select.replaceChildren(...values.map(item => { const option = document.createElement('option'); option.value = item.value; option.textContent = item.label; return option; }));
    // Applying selection is independent of rebuilding options: a restore response can
    // arrive after an overlapping refresh has already populated the new run.
    select.value = values.some(item => item.value === preferred) ? preferred : values[0]?.value ?? '';
  }
  function renderCognition() {
    const target = current ? active() : null, identity = target ? visionScopeKey(target) : '';
    if (identity !== cognitionScope) {
      cognitionAbort?.abort(); cognitionAbort = undefined; cognitionLoading = false;
      cognitionScope = identity; cognitionGate.select(target); cognitionView = null; cognitionError = ''; inspectedCognitionRequest = '';
    }
    const view = cognitionView, main = view?.configuration.main, decisions = view?.configuration.decisions, budget = record(view?.budget), providers = record(view?.providers);
    const metric = modelResponseMetric(view?.worldSecondsPerModelResponse);
    text('lab-model-metric', metric);
    text('lab-model-metric-note', view?.metricDefinition ?? 'N/A without successful main interpretation responses.');
    text('lab-cognition-scope', target ? `${target.worldId} / ${target.branchId} / ${target.runId} · request evidence scoped here; provider capacity and spending are application-wide.` : 'No current branch/run selected.');
    text('lab-cognition-error', cognitionError ? `${cognitionError}${view ? ' Showing the last successfully loaded evidence for this run.' : ''}` : '');
    text('lab-cognition-status', cognitionError ? 'Status unavailable' : !main ? 'Waiting' : !main.enabled ? 'Main disabled' : !main.available ? 'Main unavailable' : view?.pending ? `${view.pending} pending` : 'Main enabled');
    el('lab-cognition-status').classList.toggle('warning', !!cognitionError || !!main?.enabled && !main.available);
    text('lab-cognition-availability', !main ? 'Configuration unavailable.' : !main.enabled ? 'Main interpretation is disabled. Existing local behavior and admitted experiences remain available. Enable only through server configuration; credentials alone do not enable inference.' : !main.available ? 'Main interpretation is enabled but its credential/configuration is unavailable. Local behavior continues.' : 'Main interpretation is enabled for eligible selected observations. Provider failures, latency or exhausted budget return to local behavior.');
    const providerMode = typeof providers.mode === 'string' ? providers.mode : null;
    text('lab-cognition-route', main ? `${providerMode ? `${providerMode} · configured route ` : 'OpenRouter · '}${main.model}` : 'Unavailable');
    text('lab-cognition-budget', typeof budget.accountedUsd === 'number' ? `$${format(budget.accountedUsd, 6)} accounted / $${format(budget.ceilingUsd, 2)} ceiling · ${format(budget.pending, 0)} reserved pending · ${format(budget.unknown, 0)} unknown-usage requests` : budget.status === 'unavailable' ? 'Budget ledger unavailable · paid admission fails closed' : view ? 'Not initialized while providers are disabled' : 'Unavailable');
    text('lab-cognition-pending', view ? `${view.pending} logical requests · ${format(providers.pending, 0)} provider active / ${format(providers.queued, 0)} queued${view.lastFailure ? ` · last controller failure: ${view.lastFailure}` : ''}` : 'Unavailable');
    text('lab-decisions-status', view && decisions ? `${view.decisions.status} · OpenAI ${decisions.model}${decisions.enabled && !decisions.available ? ' · unavailable' : ''} · LIVE ${view.decisions.liveEnabled ? 'enabled' : 'disabled'}` : 'Unavailable');
    const request = selectCognitionRequest(view?.requests ?? [], inspectedCognitionRequest);
    inspectedCognitionRequest = request?.requestId ?? '';
    options(el<HTMLSelectElement>('lab-cognition-request'), view?.requests.length ? view.requests.map(item => ({ value: item.requestId, label: `Tick ${item.requestedTick} · ${item.provider} / ${item.model} · ${item.outcome ?? item.status} · ${item.requestId}` })) : [{ value: '', label: 'No requests for this run' }], inspectedCognitionRequest);
    el<HTMLSelectElement>('lab-cognition-request').disabled = !request;
    const saved = request ? current?.cognition?.requests.find(item => item.request.requestId === request.requestId) : null;
    const purpose = request?.purpose ?? saved?.request.purpose ?? null;
    const decisionSamples = view?.requests.filter(item => (item.purpose ?? current?.cognition?.requests.find(savedItem => savedItem.request.requestId === item.requestId)?.request.purpose) === 'decisions_evaluation' && item.metrics) ?? [];
    text('lab-decisions-metric', decisionSamples.length ? `Decisions: ${decisionSamples.length} recorded evaluation result(s) in the displayed window. Its latency, confidence/uncertainty and cost belong to those requests; the main-model response metric excludes them.` : 'Decisions measurements: N/A · no evaluation samples in the displayed window. It does not gate reflexes or ordinary main interpretation.');
    text('lab-cognition-config', view ? JSON.stringify({ configuration: view.configuration, providerCapacity: { pending: providers.pending, queued: providers.queued }, budget: view.budget, decisions: view.decisions, mainMetricDefinition: view.metricDefinition, controllerLastFailure: view.lastFailure }, null, 2) : 'No safe configuration loaded.');
    text('lab-cognition-interpretation', request?.interpretation ?? (request ? `No successful interpretation · ${request.outcome ?? request.status}.` : 'No request selected.'));
    text('lab-cognition-uncertainty', typeof request?.uncertainty === 'number' ? `Model uncertainty ${format(request.uncertainty, 3)} (0–1 estimate; not calibrated accuracy).` : 'Uncertainty N/A.');
    text('lab-cognition-proposed', request?.proposedAction ? JSON.stringify(request.proposedAction, null, 2) : 'No normalized action proposal.');
    text('lab-cognition-action', cognitionActionLabel(request?.action ?? null));
    text('lab-cognition-encoding', request?.encoding ? `${request.encoding.status}: ${request.encoding.reason}${request.encoding.experienceId === null ? '' : ` · experience ${request.encoding.experienceId}`}` : 'No encoding outcome. A response or action proposal alone does not admit experience.');
    text('lab-cognition-metadata', request ? JSON.stringify({ requestId: request.requestId, purpose, provider: request.provider, model: request.model, status: request.status, outcome: request.outcome, observationId: request.observationId, captureId: request.captureId ?? request.observationId, frameHash: request.frameHash, capturedTick: request.capturedTick, attentionTick: request.attentionTick, requestedTick: request.requestedTick, resultTick: request.resultTick, metrics: request.metrics, action: request.action, encoding: request.encoding }, null, 2) : 'No selected request.');
    text('lab-cognition-context', saved ? JSON.stringify(saved.request.selection.context, null, 2) : 'The selected request context is not present in the current bounded state view. No private-truth substitute is supplied.');
    const image = el<HTMLImageElement>('lab-cognition-image');
    if (request && target) {
      try {
        const url = cognitionFrameUrl(target, request);
        if (image.getAttribute('src') !== url) { image.hidden = false; el('lab-cognition-image-empty').hidden = true; image.src = url; }
        text('lab-cognition-frame-note', `Bound observation ${request.observationId} · original capture tick ${request.capturedTick} · attention tick ${request.attentionTick} · frame hash ${request.frameHash}. ${request.metrics ? `${request.metrics.attempts} provider attempt(s).` : 'Dispatch/result not yet confirmed.'} A newer capture is never substituted.`);
      } catch (error) { image.removeAttribute('src'); image.hidden = true; el('lab-cognition-image-empty').hidden = false; text('lab-cognition-image-empty', error instanceof Error ? error.message : 'Associated frame unavailable.'); }
    } else { image.removeAttribute('src'); image.hidden = true; el('lab-cognition-image-empty').hidden = false; text('lab-cognition-image-empty', 'No selected request image.'); text('lab-cognition-frame-note', 'Only the specific recorded capture associated with a request is shown.'); }
    const experiences = current?.realExperiences?.slice(-8) ?? [], list = el('lab-real-experiences');
    list.replaceChildren();
    for (const experience of experiences) {
      const card = document.createElement('article'), heading = document.createElement('h3'), content = document.createElement('p'), provenance = document.createElement('p'), details = document.createElement('details'), summary = document.createElement('summary'), pre = document.createElement('pre');
      card.className = 'lab-experience'; content.className = 'lab-note'; provenance.className = 'lab-note';
      heading.textContent = `Experience ${experience.id} · encoded tick ${experience.encodedTick}`; content.textContent = experience.interpretation;
      provenance.textContent = `${experience.provenance} · ${experience.identity.mode} origin ${experience.identity.worldId}/${experience.identity.branchId}/${experience.identity.runId} · uncertainty ${format(experience.uncertainty, 3)}. ${cognitionActionLabel(experience.actionOutcome)}`;
      summary.textContent = 'Admission provenance and original timing'; pre.textContent = JSON.stringify(experience, null, 2); details.append(summary, pre); card.append(heading, content, provenance, details); list.append(card);
    }
    if (!experiences.length) { const note = document.createElement('p'); note.className = 'lab-note'; note.textContent = 'No admitted real experiences in this selected world. Diagnostic records and TEST STUB harness entries are not shown as real autobiography.'; list.append(note); }
  }
  async function loadCognition() {
    if (!current || cognitionLoading || stopped) return;
    const token = cognitionGate.begin(), controller = new AbortController(); cognitionAbort = controller; cognitionLoading = true;
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const view = await request<CognitionView>(`/api/cognition?${new URLSearchParams({ ...token.target })}`, undefined, controller.signal);
      if (!cognitionGate.accepts(token) || stopped) return;
      validateCognitionViewScope(view, token.target); cognitionView = view; cognitionError = ''; renderCognition();
    } catch (error) { if (cognitionGate.accepts(token) && !stopped) { cognitionError = error instanceof Error ? error.message : 'Cognition evidence unavailable.'; renderCognition(); } }
    finally { clearTimeout(timeout); if (cognitionGate.accepts(token)) { cognitionLoading = false; cognitionAbort = undefined; } }
  }
  function renderAttention() {
    const target = current ? active() : null, identity = target ? visionScopeKey(target) : '';
    if (identity !== attentionScope) {
      attentionAbort?.abort(); attentionAbort = undefined; attentionLoading = false;
      attentionScope = identity; attentionGate.select(target); attentionView = null; attentionTrace = []; attentionError = ''; autoCaptureIdentity = '';
    }
    const attention = attentionView?.attention, heard = attention?.lastReceived, decision = attention?.lastDecision, tick = current?.tick ?? 0;
    text('lab-attention-scope', target ? `${target.worldId} / ${target.branchId} / ${target.runId} · current tick ${tick}` : 'No current branch/run selected.');
    text('lab-attention-status', attentionError ? 'Evidence unavailable' : decision?.outcome ?? (attention ? 'Listening' : 'Waiting'));
    el('lab-attention-status').classList.toggle('warning', !!attentionError);
    text('lab-attention-error', attentionError);
    text('lab-heard-summary', heard ? `Tick ${heard.tick} · received intensity ${format(heard.intensity, 3)} / onset ${format(heard.suddenness, 3)} · ${heard.bearingDegrees === null ? 'direction unresolved' : `bearing ${format(heard.bearingDegrees, 0)}° ± ${format(heard.directionUncertaintyDegrees, 0)}° relative to the listening head`} · distance ${heard.distanceBand}, uncertainty ${format(heard.distanceUncertainty, 2)}` : 'No received sound evidence in this run.');
    text('lab-heard-json', heard ? JSON.stringify(heard, null, 2) : 'No received evidence. Exact source identity and coordinates are not supplied to hearing.');
    const reflex = attentionTrace.filter(item => item.event_type === 'REFLEX_DECISION' || item.event_type === 'REFLEX_STATE');
    text('lab-reflex-summary', reflex.length ? reflex.map(item => `Tick ${item.world_tick} · ${item.event_type}: ${item.outcome} · ${JSON.stringify(item.data)}`).join('\n') : 'No recent recorded reflex decision loaded. Reflexes evaluate received evidence immediately, independently of attention and rendering.');
    text('lab-sound-truth', JSON.stringify(attentionTrace.filter(item => ['ACOUSTIC_EVENT', 'ACOUSTIC_PROPAGATION'].includes(item.event_type)), null, 2));
    text('lab-attention-decision', decision ? `Tick ${decision.tick} · ${decision.outcome}: ${decision.reason} · score ${format(decision.score, 3)} · observation ${decision.observationId}` : 'No local attention decision yet.');
    text('lab-attention-commitment', attention ? `Commitment ${Math.max(0, attention.commitmentUntilTick - tick)} ticks · attention cooldown ${Math.max(0, attention.cooldownUntilTick - tick)} ticks · developer priority ${Math.max(0, attention.developerUntilTick - tick)} ticks · ${attention.exposures.length} bounded exposure summaries.` : 'Attention state unavailable for this world version.');
    const actionResult = attentionTrace.filter(item => item.event_type === 'ATTENTION_ACTION' || item.event_type.startsWith('HEAD_')).at(-1);
    text('lab-attention-action', attention?.automaticActionId !== null && attention?.automaticActionId !== undefined ? `Automatic head action ${attention.automaticActionId} · originating observation ${attention.automaticObservationId ?? 'unavailable'}${attention.resumeActivity ? ' · generic activity will resume after investigation' : ''}` : actionResult ? `Latest recorded head outcome · tick ${actionResult.world_tick} · ${actionResult.event_type}: ${actionResult.outcome} · ${JSON.stringify(actionResult.data)}` : 'No automatic head action is currently active. Head outcomes remain in the scoped causal timeline.');
    text('lab-attention-json', attention ? JSON.stringify({ decision, exposures: attention.exposures, commitmentUntilTick: attention.commitmentUntilTick, cooldownUntilTick: attention.cooldownUntilTick, developerUntilTick: attention.developerUntilTick, automaticActionId: attention.automaticActionId, automaticObservationId: attention.automaticObservationId, resumeActivity: attention.resumeActivity }, null, 2) : 'No attention state.');
    const pending = attention?.pending, result = attention?.lastCapture;
    text('lab-auto-intent', (pending ? `Intention ${pending.id} · ${pending.status} · reasons: ${pending.reasons.join(', ')}${pending.reasons.length > 1 ? ' (coalesced)' : ''} · created tick ${pending.createdTick}, expires ${pending.expiresTick}${pending.captureId ? ` · capture ${pending.captureId}` : ''}` : 'No pending automatic capture intention.') + (attention?.deferred ? ` Deferred intention ${attention.deferred.id} · reasons ${attention.deferred.reasons.join(', ')} · created tick ${attention.deferred.createdTick}.` : '') + (attention?.lastSuppression ? ` Latest suppression · tick ${attention.lastSuppression.tick}: ${attention.lastSuppression.reason} / ${attention.lastSuppression.cause}.` : ''));
    text('lab-auto-result', result ? `Intention ${result.intentId} · ${result.outcome} · ${result.freshness} · captured tick ${result.capturedTick}, received tick ${result.receivedTick} · image difference ${result.difference === null ? 'N/A' : format(result.difference, 4)} · reasons ${result.reasons.join(', ')}` : 'No automatic result yet. A failed or stale frame does not establish that a source is absent.');
    text('lab-auto-json', attentionView ? JSON.stringify({ host: attentionView.automatic, pending: pending ?? null, deferred: attention?.deferred ?? null, lastResult: result ?? null, lastSuppression: attention?.lastSuppression ?? null, captureCooldownUntilTick: attention?.captureCooldownUntilTick, capturesInWindow: attention?.capturesInWindow, windowStartTick: attention?.captureWindowStartTick, retryAfterTick: attention?.retryAfterTick, failureCount: attention?.failureCount, nextProbeTick: attention?.nextProbeTick, baselineCapturedTick: attention?.baseline?.capturedTick ?? null, config: attention?.config }, null, 2) : 'No automatic capture state.');
    const latestAutomatic = pending?.captureId ?? result?.captureId ?? '';
    const automaticIdentity = latestAutomatic ? `${identity}/${latestAutomatic}/${pending?.status ?? ''}/${result?.outcome ?? ''}` : '';
    if (automaticIdentity !== autoCaptureIdentity) { autoCaptureIdentity = automaticIdentity; if (latestAutomatic) visionDirty = true; }
    const autoImage = el<HTMLImageElement>('lab-auto-image'), hasFrame = !!target && !!result?.captureId && result.outcome === 'success';
    if (hasFrame && target && result) {
      const url = `/api/vision/frame?${new URLSearchParams({ ...target, captureId: result.captureId! })}`;
      if (autoImage.getAttribute('src') !== url) {
        autoImage.hidden = false; el('lab-auto-image-empty').hidden = true;
        autoImage.src = url;
      }
      text('lab-auto-frame', `Associated capture ${result.captureId} · original tick ${result.capturedTick} · ${result.freshness} for the attention decision at receipt tick ${result.receivedTick}. This historical image is never relabelled as the current scene.`);
    } else {
      autoImage.removeAttribute('src'); autoImage.hidden = true; el('lab-auto-image-empty').hidden = false;
      text('lab-auto-image-empty', 'No successful automatic frame for this result.');
      text('lab-auto-frame', 'Missing, failed or stale evidence does not identify or exclude a sound source. Successful historical frames remain inspectable while retained.');
    }
  }
  async function loadAttention() {
    if (!current || attentionLoading || stopped) return;
    const token = attentionGate.begin(), controller = new AbortController(); attentionAbort = controller; attentionLoading = true;
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const params = new URLSearchParams({ ...token.target });
      const [view, trace] = await Promise.all([
        request<AttentionView>(`/api/attention?${params}`, undefined, controller.signal),
        request<TimelineResponse>(`/api/timeline?${new URLSearchParams({ ...token.target, limit: '80' })}`, undefined, controller.signal),
      ]);
      if (!attentionGate.accepts(token) || stopped) return;
      if (visionScopeKey(view) !== visionScopeKey(token.target) || visionScopeKey(trace.scope) !== visionScopeKey(token.target) || trace.records.some(item => item.world_id !== token.target.worldId || item.branch_id !== token.target.branchId || item.run_id !== token.target.runId)) throw new Error('Hearing evidence does not match the selected world, branch and run.');
      attentionView = view; attentionTrace = trace.records.filter(item => /^(ACOUSTIC_|SOUND_|REFLEX_|ATTENTION_|HEAD_|CAPTURE_|VISUAL_CHANGE)/.test(item.event_type)).slice(-24); attentionError = '';
      renderAttention(); if (visionDirty) await loadVision();
    } catch (error) {
      if (attentionGate.accepts(token) && !stopped) { attentionError = error instanceof Error ? error.message : 'Hearing and attention evidence unavailable.'; renderAttention(); }
    } finally { clearTimeout(timeout); if (attentionGate.accepts(token)) { attentionLoading = false; attentionAbort = undefined; } }
  }
  function renderVision() {
    const target = current ? active() : null, identity = target ? visionScopeKey(target) : '';
    if (identity !== visionScope) {
      visionAbort?.abort(); visionAbort = undefined; visionLoading = false;
      visionScope = identity; visionGate.select(target); visionView = null; visionError = ''; visionDirty = true; visionDeadline.reset();
      text('lab-vision-operation', '');
      const scene = current?.state?.scene;
      if (scene) {
        el<HTMLSelectElement>('lab-scene-fixture').value = scene.fixture;
        el<HTMLInputElement>('lab-scene-light').value = String(scene.illumination);
        el<HTMLInputElement>('lab-scene-color').value = scene.fixtureColor;
        el<HTMLSelectElement>('lab-scene-door').value = scene.doorOpenRadians === null ? 'animated' : scene.doorOpenRadians === 0 ? 'closed' : 'open';
      }
    }
    const state = current?.state, head = state?.head, scene = state?.scene;
    const degrees = (value: number) => format(value * 180 / Math.PI, 1);
    text('lab-vision-scope', target ? `${target.worldId} / ${target.branchId} / ${target.runId} · physical scene revision ${scene?.revision ?? 'unavailable'}` : 'No current branch/run selected.');
    text('lab-head-state', head ? `${head.status} · yaw ${degrees(head.yaw)}° / pitch ${degrees(head.pitch)}° · target ${degrees(head.targetYaw)}° / ${degrees(head.targetPitch)}°${head.scan ? ` · scan point ${head.scan.cursor + 1}/${head.scan.points.length}` : ''} · horizontal FOV ${head.camera.horizontalFovDegrees}°` : 'Head state unavailable for this world version.');
    text('lab-scene-state', scene ? `Applied scene revision ${scene.revision} · ${scene.fixture} · illumination ${scene.illumination} · color ${scene.fixtureColor} · door ${scene.doorOpenRadians === null ? 'normal animation' : `${degrees(scene.doorOpenRadians)}°`}` : 'Physical scene state unavailable.');
    document.querySelectorAll<HTMLButtonElement>('.vision-control').forEach(button => { button.disabled = busy || !head; });
    const latest = visionView?.latest;
    text('lab-vision-status', visionError ? 'Status unavailable' : `${latest?.status ?? 'No capture'}${visionView?.cleanupError ? ' · cleanup warning' : ''}`);
    el('lab-vision-status').classList.toggle('warning', !!visionError || !!visionView?.cleanupError || !!latest && ['unavailable', 'timeout', 'failed', 'stale'].includes(latest.status));
    text('lab-vision-cleanup', visionView?.cleanupError ? `Renderer cleanup warning: ${visionView.cleanupError}. The capture result above remains separate from renderer resource cleanup.` : '');
    const display = visionView ? displayedCapture(visionView) : { frame: null, previous: false }, frame = display.frame;
    const image = el<HTMLImageElement>('lab-vision-image');
    image.hidden = !frame; el('lab-vision-empty').hidden = !!frame;
    if (frame && target) {
      const url = `/api/vision/frame?${new URLSearchParams({ ...target, captureId: frame.captureId })}`;
      if (image.getAttribute('src') !== url) image.src = url;
      text('lab-vision-caption', `${display.previous || visionError ? 'PREVIOUS successful capture' : 'Captured sensor frame'} · original tick ${frame.tick} · reason ${frame.reason} · ${frame.width} × ${frame.height} · ${frame.captureId}. ${display.previous ? 'This is not the result of the latest capture request.' : 'The world may have advanced since this image.'}`);
    } else {
      image.removeAttribute('src'); text('lab-vision-empty', latest ? 'No successful image is available for this run.' : 'No image has been captured for this run.');
      text('lab-vision-caption', 'Missing images are missing observations; no world-truth substitute is provided.');
    }
    text('lab-vision-metadata', JSON.stringify({ latest: latest ?? null, displayedPrevious: display.previous ? frame : null }, null, 2));
    text('lab-vision-limits', visionView ? `Renderer queue ${visionView.limits.queued}/${visionView.limits.capacity} · retained frames ${visionView.limits.retainedFrames}/${visionView.limits.maxRetainedFrames} · timeout ${format(visionView.limits.timeoutMs / 1000)} host seconds.` : 'Renderer limits load with the selected sensor.');
    if (visionError) text('lab-vision-operation', `${visionError} Use Refresh captures to retry the status query.`);
    else if (latest?.error) text('lab-vision-operation', `${latest.status}: ${latest.error}`);
    else if (latest && ['pending', 'queued'].includes(latest.status)) text('lab-vision-operation', `Capture ${latest.status} for tick ${latest.tick}. Simulation continues independently.`);
    else if (latest?.status === 'success') text('lab-vision-operation', `Capture complete at ${latest.completedAt}; ${format(latest.durationMs, 0)} ms. Capture production alone does not encode experience; consult the separate interpretation/admission outcome.`);
    const observation = visionView?.observation;
    const expired = !!observation && (scene?.revision !== observation.dynamicRevision || (current?.tick ?? 0) - observation.tick > 300);
    text('lab-vision-target-note', observation ? expired ? 'Target context expired or its physical scene changed. Request a fresh capture.' : `Evidence from tick ${observation.tick}. Look toward the captured coarse bearing, adjusted for Lumi’s own turning. Targets expire after 300 world ticks; a new capture may show that the shape has gone.` : 'A successful capture is required for observation-scoped targeting.');
    text('lab-vision-observation', observation ? JSON.stringify(observation, null, 2) : 'No successful eligible observation for this run.');
    text('lab-vision-truth', visionView?.privateGrounding ? JSON.stringify(visionView.privateGrounding, null, 2) : 'No private measurement.');
    options(el<HTMLSelectElement>('lab-vision-target'), observation?.shapes.length ? observation.shapes.map((shape, index) => ({ value: shape.handle, label: `Unknown shape ${index + 1} · bearing ${shape.bearingDegrees}° / ${shape.elevationDegrees}° · ${shape.distanceBand} · sampled visibility ${shape.sampleVisibilityBand}${shape.qualityFlags.length ? ` · ${shape.qualityFlags.join(', ')}` : ''}` })) : [{ value: '', label: 'No eligible shape in this observation' }], val('lab-vision-target'));
    el<HTMLButtonElement>('lab-head-target').disabled ||= !observation?.shapes.length || latest?.status !== 'success' || expired;
  }
  async function loadVision(force = false) {
    if (!current || visionLoading || stopped) return;
    const pending = visionView?.latest && ['queued', 'pending'].includes(visionView.latest.status);
    if (!force && !visionDirty && !pending) return;
    if (!force && pending && visionDeadline.expired(visionView?.latest)) { visionError = 'Capture status polling deadline reached.'; visionDirty = false; renderVision(); return; }
    const token = visionGate.begin(), controller = new AbortController(); visionAbort = controller; visionLoading = true;
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const result = await request<CaptureView>(`/api/vision?${new URLSearchParams({ ...token.target })}`, undefined, controller.signal);
      if (!visionGate.accepts(token) || stopped) return;
      validateCaptureViewScope(result, token.target); visionView = result; visionError = ''; visionDirty = false;
      visionDeadline.observe(result.latest);
      renderCognition(); renderAttention(); renderVision();
    } catch (error) {
      if (visionGate.accepts(token) && !stopped) { visionDirty = false; visionError = error instanceof Error ? error.message : 'Visual sensor unavailable.'; renderVision(); }
    } finally {
      clearTimeout(timeout);
      if (visionGate.accepts(token)) { visionLoading = false; visionAbort = undefined; }
    }
  }
  function render() {
    current = summaries.find(item => key(item) === selected);
    if (!current) {
      document.querySelectorAll<HTMLButtonElement>('.experiment, .vision-control, #lab-save, #lab-fork, #lab-export, #lab-reopen').forEach(button => { button.disabled = true; });
      text('lab-state', 'Selected branch unavailable');
      renderCognition(); renderAttention(); renderVision();
      return;
    }
    const c = current, health = record(c.logging), experiment = c.mode === 'EXPERIMENT';
    text('lab-mode', c.mode); el('lab-mode').classList.toggle('experiment-badge', experiment);
    text('lab-state', c.paused ? 'Paused' : 'Running'); text('lab-scope', `${c.worldId} / ${c.branchId}`); text('lab-run', `Run ${c.runId}`);
    if (recovery) {
      const point = (p: RecoveryPoint) => `Tick ${format(p.tick, 0)} · ${format(p.worldTime, 3)} world s · saved ${p.savedAt}`;
      text('lab-recovery-status', recovery.saveError ? 'Save failed' : recovery.fallback ? 'Recovered fallback' : recovery.status);
      el('lab-recovery-status').classList.toggle('warning', !!recovery.saveError || recovery.fallback);
      text('lab-history', `LIVE history ${recovery.historyId}${c.historyId ? ` · selected branch history ${c.historyId}` : ''}`);
      text('lab-recovery-committed', recovery.lastCommitted ? point(recovery.lastCommitted) : 'No successful save committed yet');
      text('lab-recovery-startup', recovery.recovered ? `${point(recovery.recovered)}${recovery.fallback ? ' · previous valid generation' : ''}` : recovery.status === 'override' ? 'Explicit checkpoint override' : 'Fresh history initialization');
      text('lab-recovery-detail', `Periodic save interval ${format(recovery.intervalMs / 1000)} host seconds.${recovery.checkpointAgeMs === null ? '' : ` Time since saved checkpoint at startup: ${format(recovery.checkpointAgeMs / 1000)} host seconds. This includes any unsaved uptime before a crash; it is not measured downtime.`}`);
      text('lab-recovery-error', recovery.saveError ? `Recovery save failed: ${recovery.saveError}. The last committed point remains the recovery boundary.` : '');
    }
    text('lab-tick', `Tick ${format(c.tick, 0)}`); text('lab-world-time', `${format(c.time, 3)} seconds · exact world elapsed time`);
    text('lab-subjective', `${format(c.subjective.estimateSeconds)} s`); text('lab-uncertainty', `Uncertainty ± ${format(c.subjective.uncertaintySeconds)} s`);
    text('lab-calibration', c.subjective.lastCalibrationTick === null ? 'No synthetic clock calibration' : `Last TEST STUB calibration at tick ${c.subjective.lastCalibrationTick}`);
    text('lab-activity', c.activity.status); const progress = el<HTMLProgressElement>('lab-progress'); progress.max = Math.max(1, c.activity.totalTicks); progress.value = c.activity.cursor;
    text('lab-activity-detail', `${c.activity.cursor} / ${c.activity.totalTicks} ticks · ${c.activity.appliedMilestones.length} milestones · ${c.activity.completionCount} completions`);
    const playback = playbackPresentation(c.playback);
    text('lab-speed-label', playback.requested); text('lab-achieved-speed', playback.achieved); text('lab-playback-detail', playback.detail); el('lab-playback-detail').classList.toggle('warning', playback.warning);
    text('lab-forward-state', c.fastForwardRemaining ? `${c.fastForwardRemaining.toLocaleString()} fast-forward ticks remaining. Work yields between bounded batches.` : 'No fast-forward work pending.');
    text('lab-control-note', experiment ? 'Controls affect only this experiment. Paused wall time does not build a catch-up burst.' : 'LIVE is protected at 1×. Record a checkpoint and fork an experiment to use these controls.');
    const query = new URLSearchParams({ worldId: c.worldId, branchId: c.branchId }); el<HTMLAnchorElement>('lab-viewer').href = `/?${query}`;
    document.querySelectorAll<HTMLButtonElement>('.experiment').forEach(button => { button.disabled = busy || !experiment; });
    el<HTMLButtonElement>('lab-pause').disabled ||= c.paused; el<HTMLButtonElement>('lab-resume').disabled ||= !c.paused;
    el<HTMLButtonElement>('lab-step').disabled ||= !c.paused || c.fastForwardRemaining > 0;
    el<HTMLButtonElement>('lab-cancel-forward').disabled ||= c.fastForwardRemaining === 0;
    for (const id of ['lab-save', 'lab-fork', 'lab-export']) el<HTMLButtonElement>(id).disabled = busy;
    el<HTMLButtonElement>('lab-reopen').disabled = busy || !catalog.checkpoints.some(checkpoint => checkpoint.mode === 'EXPERIMENT');
    options(el<HTMLSelectElement>('lab-checkpoint'), c.checkpoints.map(checkpoint => ({ value: checkpoint.id, label: `Tick ${checkpoint.tick} · ${checkpoint.id}` })), val('lab-checkpoint'));
    text('lab-checkpoint-detail', `Latest recorded checkpoint: tick ${c.checkpoint.tick}. ${c.checkpoints.length} checkpoint(s) available.`);
    const runSelection = selectTimelineRun({ targetKey: key(c), currentRunId: c.runId, availableRuns: c.runs, selectedRunId: val('lab-filter-run'), pendingRestore: restoredRunSelection });
    options(el<HTMLSelectElement>('lab-filter-run'), c.runs.map(run => ({ value: run, label: `${run}${run === c.runId ? ' · current' : ' · previous'}` })), runSelection.selectedRunId);
    restoredRunSelection = runSelection.pendingRestore;
    text('lab-state-hash', c.stateHash); text('lab-event-hash', c.eventHash); text('lab-runtime-hash', c.runtimeHash);
    text('lab-health-status', String(health.status ?? 'Unavailable')); el('lab-health-status').classList.toggle('warning', health.status !== 'HEALTHY');
    text('lab-backlog', `${format(Number(health.queuedRecords ?? 0) + Number(health.inFlightRecords ?? 0), 0)} records / ${format(Number(health.queuedBytes ?? 0) + Number(health.inFlightBytes ?? 0), 0)} bytes`);
    text('lab-drops', `${format(health.droppedRecords ?? 0, 0)} / ${format(health.disabledRecords ?? 0, 0)}`);
    text('lab-disk', `${format(health.retainedBytes ?? 0, 0)} bytes`);
    const gaps = Array.isArray(health.gaps) ? health.gaps : [];
    text('lab-gaps', gaps.length ? `Evidence gaps: ${gaps.join('; ')}` : 'No recorder evidence gaps reported.'); text('lab-health-json', JSON.stringify(health, null, 2));
    text('lab-replay-result', lastExports.get(`${key(c)}/${val('lab-filter-run') || c.runId}`) ?? 'Not checked');
    const identity = `${key(c)}/${c.runId}`;
    if (identity !== renderedIdentity) {
      el<HTMLSelectElement>('lab-logging-mode').value = String(health.loggingMode ?? 'default');
      el<HTMLInputElement>('lab-compression').checked = health.compressClosed === true;
      renderedIdentity = identity;
    }
    if (document.activeElement !== el('lab-speed')) el<HTMLInputElement>('lab-speed').value = String(c.speed);
    renderCognition(); renderAttention(); renderVision();
  }
  function filters(): Record<string, string> {
    const values: Record<string, string> = { runId: val('lab-filter-run') || current?.runId || '', limit: '150' };
    for (const [id, name] of [['lab-category', 'category'], ['lab-component', 'component'], ['lab-severity', 'severity'], ['lab-causal', 'causalId'], ['lab-from', 'fromTick'], ['lab-to', 'toTick'], ['lab-search', 'search'], ['lab-event-type', 'eventType']]) if (val(id).trim()) values[name] = val(id).trim();
    return values;
  }
  function timelineRow(item: TimelineRecord): HTMLTableRowElement {
    const row = document.createElement('tr');
    const cell = (main: string, sub?: string) => { const td = document.createElement('td'), strong = document.createElement('strong'); strong.textContent = main; td.append(strong); if (sub) { const small = document.createElement('small'); small.textContent = sub; td.append(small); } row.append(td); return td; };
    cell(String(item.world_tick), `${format(item.world_elapsed_seconds, 3)} s`); cell(item.category); cell(item.event_type, item.outcome); cell(item.component, item.severity);
    const refs = cell(`${item.world_id}/${item.branch_id}/${item.run_id}/${item.event_id}`);
    if (item.causal_event_id) { const link = document.createElement('button'); link.className = 'lab-causal-link'; link.textContent = `Caused by ${item.causal_event_id}`; link.onclick = () => { el<HTMLInputElement>('lab-causal').value = item.causal_event_id!; void loadTimeline(); }; refs.append(link); }
    const details = document.createElement('details'), summary = document.createElement('summary'), pre = document.createElement('pre'); summary.textContent = 'Measured data'; pre.textContent = JSON.stringify(item.data, null, 2); details.append(summary, pre); refs.append(details);
    return row;
  }
  async function loadTimeline() {
    if (!current) return;
    const target = active(), selectedKey = selected, generation = ++filterGeneration, selectedFilters = filters();
    try {
      const result = await request<TimelineResponse>(`/api/timeline?${new URLSearchParams({ worldId: target.worldId, branchId: target.branchId, ...selectedFilters })}`);
      if (selected !== selectedKey || generation !== filterGeneration) return;
      if (result.scope.worldId !== target.worldId || result.scope.branchId !== target.branchId || result.scope.runId !== selectedFilters.runId) throw new Error('Timeline scope does not match the selected branch/run.');
      const tbody = el<HTMLTableSectionElement>('lab-timeline');
      if (result.records.some(item => item.world_id !== target.worldId || item.branch_id !== target.branchId || item.run_id !== selectedFilters.runId)) throw new Error('A timeline record has an unexpected branch/run identity.');
      tbody.replaceChildren(...result.records.map(timelineRow));
      if (!result.records.length) { const row = tbody.insertRow(), td = row.insertCell(); td.colSpan = 5; td.textContent = 'No records match these filters. A running writer may still be flushing its latest batch.'; }
      text('lab-timeline-coverage', `${result.records.length} records shown · scope ${target.worldId}/${target.branchId}/${selectedFilters.runId}. ${JSON.stringify(result.coverage ?? {})}`);
    } catch (error) { if (selected === selectedKey && generation === filterGeneration) { el('lab-timeline').replaceChildren(); text('lab-timeline-coverage', error instanceof Error ? error.message : 'Timeline unavailable'); } }
  }
  async function refresh(showMessage = false) {
    const generation = ++refreshGeneration;
    try {
      const result = await request<{ branches: DashboardBranch[]; recovery?: RecoveryStatus | null }>('/api/branches');
      if (generation !== refreshGeneration) return;
      summaries = result.branches;
      recovery = result.recovery;
      if (!selected) selected = summaries.find(item => item.mode === 'LIVE') ? key(summaries.find(item => item.mode === 'LIVE')!) : summaries[0] ? key(summaries[0]) : '';
      if (selected && !summaries.some(item => key(item) === selected)) {
        current = undefined; render(); el('lab-timeline').replaceChildren();
        message('The selected branch is unavailable. Choose a branch explicitly; no control was redirected to LIVE.', true);
        return;
      }
      options(branches, summaries.map(item => ({ value: key(item), label: `${item.mode} · ${item.branchId} · ${item.worldId}` })), selected);
      render(); await Promise.all([loadTimeline(), loadVision(showMessage), loadAttention(), loadCognition()]); if (!catalogLoaded) await loadCatalog(); if (showMessage) message('Selected branch evidence refreshed.');
    } catch (error) { if (generation === refreshGeneration) message(error instanceof Error ? error.message : 'Laboratory unavailable', true); }
  }
  async function loadCatalog() {
    try {
      const result = await request<CheckpointCatalog>('/api/checkpoints');
      catalog = result; catalogLoaded = true;
      const experiments = result.checkpoints.filter(checkpoint => checkpoint.mode === 'EXPERIMENT');
      options(el<HTMLSelectElement>('lab-saved-checkpoint'), experiments.map(checkpoint => ({ value: JSON.stringify([checkpoint.worldId, checkpoint.branchId, checkpoint.id]), label: `${checkpoint.worldId} / ${checkpoint.branchId} · tick ${checkpoint.tick} · ${checkpoint.id}${checkpoint.legacy ? ' · legacy import' : ''}` })), val('lab-saved-checkpoint'));
      text('lab-catalog-detail', `${experiments.length} saved experiment checkpoint(s).${result.errors.length ? ` Rejected files: ${result.errors.map(error => `${error.source}: ${error.error}`).join('; ')}` : ''}`);
      el('lab-catalog-detail').classList.toggle('warning', result.errors.length > 0); render();
    } catch (error) {
      catalog = { checkpoints: [], errors: [] }; catalogLoaded = false;
      el<HTMLSelectElement>('lab-saved-checkpoint').replaceChildren();
      text('lab-catalog-detail', error instanceof Error ? error.message : 'Saved checkpoint catalog unavailable.');
      el('lab-catalog-detail').classList.add('warning'); render();
    }
  }
  async function operation(label: string, perform: (target: ActiveTarget) => Promise<void>) {
    if (busy) return;
    busy = true; render();
    try { const target = active(); message(`${label}…`); await perform(target); await refresh(); message(`${label} complete.`); }
    catch (error) { message(error instanceof Error ? error.message : `${label} failed`, true); await refresh(); }
    finally { busy = false; render(); }
  }
  async function control(label: string, action: () => ControlAction) {
    try {
      await runCapturedControl(action, payload => operation(label, async target => { await request<BranchSummary>('/api/control', { ...target, action: payload }); }));
    } catch (error) { message(error instanceof Error ? error.message : `${label} failed`, true); }
  }
  const bind = (id: string, run: () => void | Promise<void>) => { el<HTMLButtonElement>(id).onclick = () => { void run(); }; };
  const radians = (id: string, min: number, max: number) => number(id, min, max, false) * Math.PI / 180;
  const sceneRevision = () => {
    const revision = current?.state?.scene?.revision;
    if (revision === undefined) throw new Error('Current physical scene state is unavailable. Refresh the selected branch.');
    return revision;
  };
  async function headOperation(label: string, read: () => HeadAction | { type: 'look_at'; observationId: string; handle: string; sceneRevision: number }) {
    try {
      const action = structuredClone(read());
      await operation(label, async target => { await request('/api/vision/head', { ...target, action }); });
    } catch (error) { message(error instanceof Error ? error.message : `${label} failed`, true); }
  }
  bind('lab-head-turn', () => headOperation('Queue relative head turn', () => ({ type: 'turn_head', yawDelta: radians('lab-head-delta-yaw', -150, 150), pitchDelta: radians('lab-head-delta-pitch', -85, 85), sceneRevision: sceneRevision() })));
  bind('lab-head-look', () => headOperation('Queue directional look', () => ({ type: 'look_at', yaw: radians('lab-head-look-yaw', -75, 75), pitch: radians('lab-head-look-pitch', -40, 45), sceneRevision: sceneRevision() })));
  bind('lab-head-scan', () => headOperation('Queue scan', () => {
    const minYaw = radians('lab-head-scan-min', -75, 75), maxYaw = radians('lab-head-scan-max', -75, 75);
    if (minYaw >= maxYaw) throw new Error('Scan minimum yaw must be less than maximum yaw.');
    return { type: 'scan_area', minYaw, maxYaw, pitch: radians('lab-head-scan-pitch', -40, 45), passes: number('lab-head-scan-passes', 1, 4), sceneRevision: sceneRevision() };
  }));
  bind('lab-head-cancel', () => headOperation('Queue head cancellation', () => ({ type: 'cancel_head', sceneRevision: sceneRevision() })));
  bind('lab-head-target', () => headOperation('Queue observed-bearing look', () => {
    const observation = visionView?.observation, handle = val('lab-vision-target');
    if (!observation || !observation.shapes.some(shape => shape.handle === handle)) throw new Error('Select an eligible shape from this run’s successful observation.');
    return { type: 'look_at', observationId: observation.observationId, handle, sceneRevision: sceneRevision() };
  }));
  bind('lab-vision-capture', async () => {
    try {
      const size = number('lab-vision-resolution', 256, 1024), reason = val('lab-vision-reason');
      if (!['developer', 'diagnostic'].includes(reason)) throw new Error('Select a supported capture reason.');
      const payload = { width: size, height: size, reason };
      await operation('Request first-person capture', async target => {
        const token = visionGate.begin(); visionAbort?.abort(); visionLoading = false;
        try {
          const result = await request<CaptureMetadata>('/api/vision/capture', { ...target, ...payload });
          if (!visionGate.accepts(token)) return;
          if (visionScopeKey(result) !== visionScopeKey(target)) throw new Error('Capture response does not match the requested world, branch and run.');
          visionView = { latest: result, previousSuccess: visionView?.latest?.status === 'success' ? visionView.latest : visionView?.previousSuccess ?? null, observation: null, privateGrounding: null, cleanupError: visionView?.cleanupError ?? null, limits: visionView?.limits ?? { queued: 0, capacity: 0, retainedFrames: 0, maxRetainedFrames: 0, timeoutMs: 20000 } };
          visionError = ''; visionDirty = true; visionDeadline.observe(result); renderVision();
        } catch (error) {
          if (visionGate.accepts(token)) { visionError = error instanceof Error ? error.message : 'Capture request failed.'; renderVision(); }
          throw error;
        }
      });
    } catch (error) { message(error instanceof Error ? error.message : 'Capture request failed', true); }
  });
  bind('lab-vision-refresh', () => { visionError = ''; visionDirty = true; visionDeadline.reset(); return loadVision(true); });
  bind('lab-scene-apply', async () => {
    try {
      const door = val('lab-scene-door');
      const action = { type: 'configure_scene', illumination: number('lab-scene-light', 0, 1, false), fixture: val('lab-scene-fixture'), fixtureColor: val('lab-scene-color'), doorOpenRadians: door === 'animated' ? null : door === 'closed' ? 0 : -Math.PI / 2 };
      await operation('Queue experiment scene configuration', async target => { await request('/api/scene', { ...target, action }); });
    } catch (error) { message(error instanceof Error ? error.message : 'Scene configuration failed', true); }
  });
  bind('lab-sound-emit', async () => {
    try {
      const sourceId = val('lab-sound-id').trim();
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(sourceId)) throw new Error('Use 1–100 letters, numbers, underscores or hyphens for the private sound fixture ID.');
      const action = { type: 'emit_sound', x: number('lab-sound-x', -20, 20, false), y: number('lab-sound-y', -20, 20, false), z: number('lab-sound-z', -20, 20, false), intensity: number('lab-sound-intensity', 0, 1, false), suddenness: number('lab-sound-suddenness', 0, 1, false), sourceId };
      await operation('Queue experiment sound fixture', async target => { await request('/api/sound', { ...target, action }); });
    } catch (error) { message(error instanceof Error ? error.message : 'Sound emission failed', true); }
  });
  bind('lab-sound-place', () => {
    try {
      if (!current?.state || current.mode !== 'EXPERIMENT') throw new Error('Select a current experiment first.');
      const pose = eyePose(current.state), heading = pose.bodyHeading + pose.headYaw;
      for (const [id, value] of [['lab-sound-x', pose.position[0] + Math.sin(heading)], ['lab-sound-y', pose.position[1]], ['lab-sound-z', pose.position[2] + Math.cos(heading)]] as const) el<HTMLInputElement>(id).value = value.toFixed(3);
      message(`Fixture position copied from the private listening pose at tick ${current.tick}. Press Emit experiment sound to queue it.`);
    } catch (error) { message(error instanceof Error ? error.message : 'Fixture placement failed', true); }
  });
  bind('lab-pause', () => control('Pause', () => ({ type: 'pause' })));
  bind('lab-resume', () => control('Resume', () => ({ type: 'resume' })));
  bind('lab-step', () => control('Single tick', () => ({ type: 'step' })));
  bind('lab-set-speed', () => control('Set speed', () => ({ type: 'speed', speed: parsePlaybackSpeed(val('lab-speed')) })));
  bind('lab-forward', () => control('Fast-forward request', () => ({ type: 'fast-forward', ticks: number('lab-forward-ticks', 1, 100000) })));
  bind('lab-cancel-forward', () => control('Cancel fast-forward', () => ({ type: 'cancel-fast-forward' })));
  bind('lab-activity-start', () => control('Start activity', () => ({ type: 'activity-start', totalTicks: number('lab-activity-ticks', 1, 100000) })));
  bind('lab-activity-pause', () => control('Pause activity', () => ({ type: 'activity-pause' })));
  bind('lab-activity-resume', () => control('Resume activity', () => ({ type: 'activity-resume' })));
  const gates = () => ({ sensed: el<HTMLInputElement>('lab-sensed').checked, attended: el<HTMLInputElement>('lab-attended').checked, encoded: el<HTMLInputElement>('lab-encoded').checked });
  bind('lab-cue', () => control('Synthetic cue injection', () => ({ type: 'synthetic-cue', ...gates() })));
  bind('lab-clock', () => control('Synthetic clock injection', () => ({ type: 'synthetic-clock', ...gates(), observedSeconds: number('lab-clock-seconds', 0, Number.MAX_SAFE_INTEGER, false), uncertaintySeconds: number('lab-clock-uncertainty', 0, 1000000, false) })));
  bind('lab-logging-apply', () => control('Logging configuration', () => ({ type: 'logging', mode: val('lab-logging-mode') as 'off' | 'default' | 'verbose', compressClosed: el<HTMLInputElement>('lab-compression').checked })));
  bind('lab-save', () => operation('Record checkpoint', async target => { const result = await request<{ checkpoint: { id: string } }>('/api/checkpoint', target); catalogLoaded = false; await refresh(); el<HTMLSelectElement>('lab-checkpoint').value = result.checkpoint.id; }));
  bind('lab-fork', () => operation('Fork experiment', async target => {
    const branchId = val('lab-new-branch').trim(); if (!/^[A-Za-z0-9_-]{1,64}$/.test(branchId)) throw new Error('Use 1–64 letters, numbers, underscores or hyphens for a branch ID.');
    const result = await request<BranchSummary>('/api/fork', { ...target, checkpointId: val('lab-checkpoint'), newBranchId: branchId }); selected = key(result); el<HTMLInputElement>('lab-new-branch').value = `${branchId}-next`;
  }));
  bind('lab-restore', () => operation('Restore experiment', async target => {
    const restored = await request<BranchSummary>('/api/restore', { ...target, checkpointId: val('lab-checkpoint') });
    if (key(restored) !== key(target)) throw new Error('Restore response does not match the requested branch.');
    restoredRunSelection = { targetKey: key(target), runId: restored.runId };
  }));
  bind('lab-reopen', () => operation('Reopen saved experiment', async target => {
    const selectedCheckpoint = catalog.checkpoints.find(checkpoint => JSON.stringify([checkpoint.worldId, checkpoint.branchId, checkpoint.id]) === val('lab-saved-checkpoint'));
    if (!selectedCheckpoint || selectedCheckpoint.mode !== 'EXPERIMENT') throw new Error('Select a validated saved experiment checkpoint.');
    if (selectedCheckpoint.legacy && !el<HTMLInputElement>('lab-allow-legacy').checked) throw new Error('This legacy checkpoint has no verified history metadata. Check the explicit legacy-import option to import it into an experiment.');
    const newBranchId = val('lab-reopen-branch').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(newBranchId) || newBranchId === 'live') throw new Error('Use a new experiment branch ID: 1–64 letters, numbers, underscores or hyphens, starting with a letter or number.');
    const result = await request<BranchSummary>('/api/reopen', { ...target, sourceWorldId: selectedCheckpoint.worldId, sourceBranchId: selectedCheckpoint.branchId, checkpointId: selectedCheckpoint.id, newBranchId, allowLegacy: el<HTMLInputElement>('lab-allow-legacy').checked });
    if (result.mode !== 'EXPERIMENT' || result.branchId !== newBranchId || result.worldId !== selectedCheckpoint.worldId) throw new Error('Reopen response does not match the requested experiment.');
    selected = key(result); restoredRunSelection = { targetKey: selected, runId: result.runId }; el<HTMLInputElement>('lab-reopen-branch').value = `${newBranchId}-next`;
  }));
  bind('lab-refresh-catalog', () => loadCatalog());
  bind('lab-export', () => operation('Diagnostic export', async target => {
    const selectedFilters = filters(), { runId: selectedRunId, ...exportFilters } = selectedFilters;
    const result = await request<ExportResponse>('/api/export', { ...target, selectedRunId, ...exportFilters });
    const url = new URL(result.downloadUrl, location.origin); if (url.origin !== location.origin) throw new Error('Export download must remain on this local application.');
    const download = document.createElement('a'); download.href = url.href; download.download = `lumi-${target.branchId}-${selectedFilters.runId}.zip`; document.body.append(download); download.click(); download.remove();
    lastExports.set(`${key(target)}/${selectedFilters.runId}`, `${result.manifest.evidence_status} · ${result.manifest.evidence_status === 'COMPLETE' ? 'replay verified' : 'evidence gaps; replay not certified'}`);
  }));
  bind('lab-refresh', () => { catalogLoaded = false; return refresh(true); });
  el<HTMLSelectElement>('lab-cognition-request').onchange = () => { inspectedCognitionRequest = val('lab-cognition-request'); renderCognition(); };
  el<HTMLImageElement>('lab-cognition-image').onerror = () => { el<HTMLImageElement>('lab-cognition-image').hidden = true; el('lab-cognition-image-empty').hidden = false; text('lab-cognition-image-empty', 'This exact associated frame is evicted or unavailable. Its original identity and recorded interpretation remain; no newer image is substituted.'); };
  el<HTMLImageElement>('lab-auto-image').onerror = () => { el<HTMLImageElement>('lab-auto-image').hidden = true; el('lab-auto-image-empty').hidden = false; text('lab-auto-image-empty', 'This associated image is no longer retained or is unavailable. Its captured tick and recorded result remain visible.'); };
  branches.onchange = () => { selected = branches.value; filterGeneration++; el<HTMLSelectElement>('lab-filter-run').replaceChildren(); el<HTMLSelectElement>('lab-checkpoint').replaceChildren(); el<HTMLInputElement>('lab-causal').value = ''; render(); void Promise.all([loadTimeline(), loadVision(), loadAttention(), loadCognition()]); message('Selected branch changed. Controls now target this branch’s current run.'); };
  el<HTMLFormElement>('lab-filters').onsubmit = event => { event.preventDefault(); void loadTimeline(); render(); };
  bind('lab-clear-filters', () => { for (const id of ['lab-category', 'lab-component', 'lab-severity', 'lab-causal', 'lab-from', 'lab-to', 'lab-search', 'lab-event-type']) el<HTMLInputElement | HTMLSelectElement>(id).value = ''; if (current) el<HTMLSelectElement>('lab-filter-run').value = current.runId; void loadTimeline(); render(); });
  async function poll() { if (!busy) await refresh(); if (!stopped) setTimeout(() => { void poll(); }, 1200); }
  window.addEventListener('pagehide', () => { stopped = true; visionAbort?.abort(); attentionAbort?.abort(); cognitionAbort?.abort(); });
  window.addEventListener('pageshow', event => { if (event.persisted && stopped) { stopped = false; void poll(); } });
  void refresh(true).then(() => { if (!stopped) setTimeout(() => { void poll(); }, 1200); });
}
