import { createScene } from './scene';
import { SlamAudio } from './audio';
import { ViewerLifecycle } from './viewer-lifecycle';
import type { ServerMessage } from '../shared/protocol';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const slam = element<HTMLButtonElement>('slam'), toggle = element<HTMLButtonElement>('connection-toggle');
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
let currentRunId = '';
if (explicitTarget && validTarget) {
  document.querySelector('.room-label')!.textContent = `LUMI’S ROOM · ${branchId}`;
  document.querySelector('.phase')!.textContent = 'BRANCH VIEWER';
}
function status(text: string, live: boolean) { connection.textContent = text; dot.classList.toggle('connected', live); slam.disabled = !live; }
const lifecycle = new ViewerLifecycle(window, {
  resume: connect,
  suspend: () => { clearTimeout(reconnect); socket?.close(); },
});
function connect() {
  if (!validTarget) { status('Invalid world/branch selection', false); return; }
  if (!lifecycle.shouldReconnect) return;
  clearTimeout(reconnect); status('Connecting', false);
  const targetQuery = explicitTarget ? `?${new URLSearchParams({ worldId: worldId!, branchId: branchId! })}` : '';
  const current = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/world${targetQuery}`); socket = current;
  current.onopen = () => { status(explicitTarget ? `Connected · ${branchId}` : 'Live world', true); toggle.disabled = false; toggle.textContent = 'Disconnect viewer'; };
  current.onmessage = event => {
    if (socket !== current) return;
    const message = JSON.parse(event.data) as ServerMessage;
    const state = message.state;
    if (explicitTarget && (state.worldId !== worldId || state.branchId !== branchId)) { current.close(); status('Viewer target mismatch', false); return; }
    currentRunId = state.runId;
    const identity = `${state.worldId}/${state.branchId ?? 'live'}/${state.runId}`;
    if (latestWorld !== identity) { latestWorld = identity; lastSound = 0; }
    scene?.setState(state);
    element('world-time').textContent = `World time ${Math.floor(state.time / 60)}:${Math.floor(state.time % 60).toString().padStart(2, '0')}`;
    element('activity').textContent = state.character.moving ? 'Lumi is wandering' : 'Lumi is taking a breath';
    if (message.type === 'sound' && message.event.id > lastSound) { lastSound = message.event.id; audio.play(); }
  };
  current.onclose = () => {
    if (socket !== current) return;
    status(lifecycle.shouldReconnect ? 'Reconnecting…' : 'Viewer disconnected', false);
    toggle.disabled = false; toggle.textContent = 'Reconnect viewer';
    if (lifecycle.shouldReconnect) reconnect = setTimeout(connect, 1200);
  };
  current.onerror = () => current.close();
}
slam.onclick = async () => {
  const active = await audio.activate();
  element('audio-status').textContent = active ? 'Sound enabled · Ears react to the server’s sound event.' : 'Audio unavailable — the ear reflex still works.';
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(explicitTarget ? { type: 'slam', worldId, branchId, runId: currentRunId } : { type: 'slam' }));
};
toggle.onclick = () => {
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
    lifecycle.disconnect();
  } else lifecycle.connect();
};
element('reset-camera').onclick = () => scene?.reset();
lifecycle.connect();
