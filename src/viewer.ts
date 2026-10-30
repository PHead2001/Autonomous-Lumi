import { createScene, OBSERVE_HELP, type ObserveMode } from './scene';
import { SlamAudio } from './audio';
import { ViewerLifecycle } from './viewer-lifecycle';
import { mountHomeLabCard } from './home-lab-ui';
import { homePresentation, recentHomeTimeline } from './viewer-home';
import type { ServerMessage } from '../shared/protocol';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const slam = element<HTMLButtonElement>('slam'), bell = element<HTMLButtonElement>('doorbell'), toggle = element<HTMLButtonElement>('connection-toggle');
const connection = element('connection'), dot = element('status-dot');
const audio = new SlamAudio();
let scene: ReturnType<typeof createScene> | null = null;
try { scene = createScene(element<HTMLCanvasElement>('scene')); }
catch { element('scene-error').hidden = false; element('scene-error').textContent = 'This viewer needs WebGL. Enable hardware acceleration or try a current desktop browser.'; }
let socket: WebSocket | null = null, reconnect: ReturnType<typeof setTimeout> | undefined;
let latestWorld = '', lastSound = 0;
const query = new URLSearchParams(location.search);
const worldId = query.get('worldId'), branchId = query.get('branchId');
const explicitTarget = worldId !== null || branchId !== null;
const validTarget = !explicitTarget || (!!worldId && !!branchId && /^[A-Za-z0-9_-]{1,100}$/.test(worldId) && /^[A-Za-z0-9_-]{1,100}$/.test(branchId));
let currentRunId = '', soundPending: ReturnType<typeof setTimeout> | undefined;
let cueBusy = false, awaitingState = true, wasDisconnected = false;
function interaction(message: string) { element('interaction-status').textContent = message; }
if (explicitTarget && validTarget) {
  element('viewer-mode').textContent = 'EXPERIMENT VIEWER';
  element('viewer-mode').classList.add('experiment');
  element('viewer-room').textContent = 'ISOLATED EXPERIMENT · OBSERVE';
}
function status(text: string, live: boolean) { connection.textContent = text; dot.classList.toggle('connected', live); slam.disabled = !live || cueBusy || awaitingState; bell.disabled = !live || cueBusy || awaitingState; }
const lifecycle = new ViewerLifecycle(window, {
  resume: connect,
  suspend: () => { clearTimeout(reconnect); socket?.close(); },
});
function connect() {
  if (!validTarget) { status('Invalid world/branch selection', false); return; }
  if (!lifecycle.shouldReconnect) return;
  clearTimeout(reconnect); awaitingState = true; status('Connecting', false);
  const targetQuery = explicitTarget ? `?${new URLSearchParams({ worldId: worldId!, branchId: branchId! })}` : '';
  const current = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/world${targetQuery}`); socket = current;
  current.onopen = () => { status('Waiting for current world', false); toggle.disabled = false; toggle.textContent = 'Disconnect viewer'; };
  current.onmessage = event => {
    if (socket !== current) return;
    let message: ServerMessage;
    try { message = JSON.parse(event.data) as ServerMessage; } catch { interaction('Received an unreadable update. Reconnecting…'); current.close(); return; }
    if (!message || !('state' in message) || !message.state) { interaction('The server could not apply that request.'); return; }
    const state = message.state;
    if (explicitTarget && (state.worldId !== worldId || state.branchId !== branchId)) { current.close(); status('Viewer target mismatch', false); return; }
    if (wasDisconnected) { interaction('Current server world received.'); wasDisconnected = false; }
    awaitingState = false; status(state.mode === 'EXPERIMENT' ? 'Experiment connected' : 'Live world', true);
    currentRunId = state.runId;
    const identity = `${state.worldId}/${state.branchId ?? 'live'}/${state.runId}`;
    if (latestWorld !== identity) { latestWorld = identity; lastSound = 0; }
    scene?.setState(state);
    element('world-time').textContent = `World time ${Math.floor(state.time / 60)}:${Math.floor(state.time % 60).toString().padStart(2, '0')}`;
    const experiment = state.mode === 'EXPERIMENT';
    connection.textContent = experiment ? 'Experiment connected' : 'Live world';
    element('viewer-mode').textContent = experiment ? 'ISOLATED EXPERIMENT' : 'LIVE HOME'; element('viewer-mode').classList.toggle('experiment', experiment);
    element('viewer-room').textContent = experiment ? 'ISOLATED EXPERIMENT · OBSERVE' : 'LUMI’S HOME · OBSERVE';
    const presentation = homePresentation(state.home, state.capability, state.character.moving);
    element('activity-title').textContent = presentation.title; element('activity-detail').textContent = presentation.detail;
    const history = recentHomeTimeline(state.home, state.tick, state.tick ? state.time / state.tick : 1/30);
    element('history-status').textContent = history.note;
    const timeline = element('activity-timeline'), fragment = document.createDocumentFragment();
    for (const entry of history.entries) { const row = document.createElement('li'), age = document.createElement('time'), label = document.createElement('span'); age.textContent = entry.age; label.textContent = entry.label; row.append(age,label); fragment.append(row); }
    if (!history.entries.length) { const row = document.createElement('li'); row.textContent = 'No recent home action is available.'; fragment.append(row); }
    timeline.replaceChildren(fragment);
    if (message.type === 'sound' && message.event.id > lastSound) { lastSound = message.event.id; const isBell = 'kind' in message.event && message.event.kind === 'doorbell'; if (isBell) audio.playBell(); else audio.play(); clearTimeout(soundPending); interaction(isBell ? 'The doorbell sounded. She may continue what she’s doing.' : 'The door slammed. Her reaction depends on what she receives.'); }
  };
  current.onclose = () => {
    if (socket !== current) return;
    awaitingState = true; wasDisconnected = true; clearTimeout(soundPending);
    status(lifecycle.shouldReconnect ? 'Reconnecting…' : 'Viewer disconnected', false);
    interaction('Viewer disconnected. The last received state is shown; the server world continues.');
    toggle.disabled = false; toggle.textContent = 'Reconnect viewer';
    if (lifecycle.shouldReconnect) reconnect = setTimeout(connect, 1200);
  };
  current.onerror = () => current.close();
}
async function sendCue(type: 'slam'|'ring_doorbell') {
  if (cueBusy || awaitingState || socket?.readyState !== WebSocket.OPEN) { interaction('Reconnect the viewer before making a sound.'); return; }
  cueBusy = true; slam.disabled = bell.disabled = true;
  const active = await audio.activate();
  element('audio-status').textContent = active ? 'Sound enabled · Only new server sounds play.' : 'Audio unavailable · The server’s sound and reflex still run.';
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(explicitTarget ? { type, worldId, branchId, runId: currentRunId } : { type }));
    interaction(type === 'slam' ? 'Door slam requested; waiting for the server.' : 'Doorbell requested; waiting for the server.');
    clearTimeout(soundPending); soundPending = setTimeout(() => interaction('No new sound confirmed. A paused experiment or shared server cooldown may prevent this request.'), 2500);
  } else interaction('The viewer disconnected before the request could be sent.');
  setTimeout(() => { cueBusy = false; const live = socket?.readyState === WebSocket.OPEN && !awaitingState; slam.disabled = bell.disabled = !live; }, 1000);
}
slam.onclick = () => { void sendCue('slam'); };
bell.onclick = () => { void sendCue('ring_doorbell'); };
toggle.onclick = () => {
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
    lifecycle.disconnect();
  } else lifecycle.connect();
};
element('reset-camera').onclick = () => scene?.reset();
const cameraMode = element<HTMLSelectElement>('camera-mode');
function observe(mode: ObserveMode) { scene?.setMode(mode); cameraMode.value = mode; element('camera-help').textContent = OBSERVE_HELP[mode]; element<HTMLCanvasElement>('scene').focus({ preventScroll: true }); }
cameraMode.onchange = () => observe(cameraMode.value as ObserveMode);
window.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey || (event.target instanceof HTMLElement && ['INPUT','SELECT','TEXTAREA'].includes(event.target.tagName))) return;
  const mode = ({Digit1:'orbit',Digit2:'free',Digit3:'follow',Digit4:'fixed'} as Record<string,ObserveMode>)[event.code];
  if (mode) { event.preventDefault(); observe(mode); }
  else if (event.code === 'KeyR' && document.activeElement?.id === 'scene') { event.preventDefault(); scene?.reset(); }
});
mountHomeLabCard(document.querySelector<HTMLElement>('.home-guided')!);
lifecycle.connect();
