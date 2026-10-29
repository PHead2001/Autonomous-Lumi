import './style.css';
import { createScene } from './scene';
import { SlamAudio } from './audio';
import type { ServerMessage } from '../shared/protocol';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const slam = element<HTMLButtonElement>('slam'), toggle = element<HTMLButtonElement>('connection-toggle');
const connection = element('connection'), dot = element('status-dot');
const audio = new SlamAudio();
let scene: ReturnType<typeof createScene> | null = null;
try { scene = createScene(element<HTMLCanvasElement>('scene')); }
catch { element('scene-error').hidden = false; element('scene-error').textContent = 'This viewer needs WebGL. Enable hardware acceleration or try a current desktop browser.'; }
let socket: WebSocket | null = null, reconnect: ReturnType<typeof setTimeout> | undefined;
let intentionalDisconnect = false, latestWorld = '', lastSound = 0;
function status(text: string, live: boolean) { connection.textContent = text; dot.classList.toggle('connected', live); slam.disabled = !live; }
function connect() {
  clearTimeout(reconnect); intentionalDisconnect = false; status('Connecting', false);
  const current = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/world`); socket = current;
  current.onopen = () => { status('Live world', true); toggle.disabled = false; toggle.textContent = 'Disconnect viewer'; };
  current.onmessage = event => {
    const message = JSON.parse(event.data) as ServerMessage;
    const state = message.state;
    if (latestWorld !== state.worldId) { latestWorld = state.worldId; lastSound = 0; }
    scene?.setState(state);
    element('world-time').textContent = `World time ${Math.floor(state.time / 60)}:${Math.floor(state.time % 60).toString().padStart(2, '0')}`;
    element('activity').textContent = state.character.moving ? 'Lumi is wandering' : 'Lumi is taking a breath';
    if (message.type === 'sound' && message.event.id > lastSound) { lastSound = message.event.id; audio.play(); }
  };
  current.onclose = () => {
    if (socket !== current) return;
    status(intentionalDisconnect ? 'Viewer disconnected' : 'Reconnecting…', false);
    toggle.disabled = false; toggle.textContent = 'Reconnect viewer';
    if (!intentionalDisconnect) reconnect = setTimeout(connect, 1200);
  };
  current.onerror = () => current.close();
}
slam.onclick = async () => {
  const active = await audio.activate();
  element('audio-status').textContent = active ? 'Sound enabled · Ears react to the server’s sound event.' : 'Audio unavailable — the ear reflex still works.';
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'slam' }));
};
toggle.onclick = () => {
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
    intentionalDisconnect = true; clearTimeout(reconnect); socket.close();
  } else connect();
};
element('reset-camera').onclick = () => scene?.reset();
window.addEventListener('pagehide', () => { intentionalDisconnect = true; clearTimeout(reconnect); socket?.close(); });
connect();
