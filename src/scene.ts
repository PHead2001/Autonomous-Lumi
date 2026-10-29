import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createAvatar } from './avatar';
import type { WorldState } from '../shared/protocol';

export function createScene(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#d9ded3');
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);
  const controls = new OrbitControls(camera, canvas); controls.enableDamping = true;
  controls.minDistance = 7; controls.maxDistance = 19; controls.maxPolarAngle = Math.PI / 2.15;
  controls.minPolarAngle = 0.35; controls.enablePan = false;
  const reset = () => { camera.position.set(10, 8, 12); controls.target.set(0, 1, 0); controls.update(); }; reset();
  scene.add(new THREE.HemisphereLight('#fff4de', '#6f8079', 2.5));
  const sun = new THREE.DirectionalLight('#fff0cf', 4); sun.position.set(-3, 9, 5); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7 });
  sun.shadow.normalBias = 0.03; scene.add(sun);
  function box(size: [number, number, number], position: [number, number, number], color: string, parent: THREE.Object3D = scene) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
    m.position.set(...position); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  }
  box([9.4, 0.25, 7.4], [0, -0.18, 0], '#b18c68');
  for (let x = -4.3; x <= 4.4; x += 0.55) box([0.52, 0.035, 7], [x, -0.035, 0], Math.round(x * 10) % 2 ? '#d7b795' : '#cfae8a');
  // Cutaway walls leave the avatar visible from the default spectator view.
  box([6.5, 3.65, 0.16], [-1.25, 1.7, -3.6], '#aac0af');
  box([0.6, 3.65, 0.16], [4.2, 1.7, -3.6], '#aac0af');
  box([2, 0.65, 0.16], [3, 3.2, -3.6], '#aac0af');
  box([0.16, 3.65, 7.2], [-4.6, 1.7, 0], '#c3cdb7');
  box([9.2, 0.13, 0.18], [0, 0.05, -3.47], '#e7dfc8');
  box([0.18, 0.13, 7.1], [-4.47, 0.05, 0], '#e7dfc8');
  box([4.1, 0.025, 3.3], [-0.3, 0, 0.3], '#729a92');
  box([3.8, 0.03, 3], [-0.3, 0.005, 0.3], '#83aaa0');
  for (const x of [-2.15, 1.55]) box([0.035, 0.035, 3], [x, 0.012, 0.3], '#e4d7b6');
  // Door hinge rotates visibly at the same server event time as sound and ears.
  box([2.05, 2.95, 0.13], [3, 1.4, -3.46], '#42645e');
  const door = new THREE.Group(); door.position.set(2.05, 0, -3.33); scene.add(door);
  box([1.84, 2.8, 0.12], [0.92, 1.4, 0], '#b86d4b', door);
  box([1.46, 1.8, 0.04], [0.92, 1.55, 0.09], '#c98660', door);
  box([0.13, 0.13, 0.18], [1.6, 1.25, 0.16], '#eac58a', door);
  // Window and warm light patch, all original primitive geometry.
  box([0.06, 1.9, 2.4], [-4.47, 2.1, -0.7], '#efe5cf');
  box([0.07, 1.65, 2.15], [-4.42, 2.1, -0.7], '#a8d6d2');
  box([0.09, 0.07, 2.15], [-4.36, 2.1, -0.7], '#efe5cf');
  box([0.09, 1.65, 0.07], [-4.36, 2.1, -0.7], '#efe5cf');
  const avatar = createAvatar(); scene.add(avatar.root);
  let state: WorldState | null = null, received = performance.now();
  let initialized = false, lastFrame = performance.now();
  function frame(now: number) {
    const dt = Math.min((now - lastFrame) / 1000, 0.1); lastFrame = now;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (canvas.width !== Math.round(width * renderer.getPixelRatio()) || canvas.height !== Math.round(height * renderer.getPixelRatio())) {
      renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
    }
    if (state) {
      // Presentation time extrapolates only one network tick; a disconnected world stays frozen here.
      const time = state.time + Math.min((now - received) / 1000, 1 / 30);
      const c = state.character;
      const alpha = initialized ? 1 - Math.exp(-dt * 18) : 1;
      avatar.root.position.lerp(new THREE.Vector3(c.x, 0, c.z), alpha);
      const angle = Math.atan2(Math.sin(c.heading - avatar.root.rotation.y), Math.cos(c.heading - avatar.root.rotation.y));
      avatar.root.rotation.y += angle * alpha;
      avatar.update(state, time, c.gait);
      const age = time - state.door.lastSlam;
      door.rotation.y = age >= 0 && age < 0.4 ? -0.5 * Math.exp(-age * 10) * Math.cos(age * 20) : 0;
      initialized = true;
    }
    controls.update(); renderer.render(scene, camera); requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return { reset, setState(next: WorldState) { if (next.worldId !== state?.worldId) initialized = false; state = next; received = performance.now(); } };
}
