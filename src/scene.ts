import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createPhysicalRenderScene } from './render-scene';
import type { WorldState } from '../shared/protocol';

export function createScene(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);
  const controls = new OrbitControls(camera, canvas); controls.enableDamping = true;
  controls.minDistance = 7; controls.maxDistance = 19; controls.maxPolarAngle = Math.PI / 2.15;
  controls.minPolarAngle = 0.35; controls.enablePan = false;
  const reset = () => { camera.position.set(10, 8, 12); controls.target.set(0, 1, 0); controls.update(); }; reset();
  let world: ReturnType<typeof createPhysicalRenderScene> | null = null;
  let state: WorldState | null = null, received = performance.now();
  let initialized = false, lastFrame = performance.now();
  function frame(now: number) {
    const dt = Math.min((now - lastFrame) / 1000, 0.1); lastFrame = now;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (canvas.width !== Math.round(width * renderer.getPixelRatio()) || canvas.height !== Math.round(height * renderer.getPixelRatio())) {
      renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
    }
    if (state && world) {
      // This small interpolation is spectator presentation only. Captures use applySnapshot's exact default time.
      const time = state.time + Math.min((now - received) / 1000, 1 / 30), c = state.character;
      const alpha = initialized ? 1 - Math.exp(-dt * 18) : 1;
      world.avatar.root.position.lerp(new THREE.Vector3(c.x, 0, c.z), alpha);
      const angle = Math.atan2(Math.sin(c.heading - world.avatar.root.rotation.y), Math.cos(c.heading - world.avatar.root.rotation.y));
      world.avatar.root.rotation.y += angle * alpha;
      world.applySnapshot(state, time, false); initialized = true;
    }
    controls.update(); if (world) renderer.render(world.scene, camera); requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return { reset, setState(next: WorldState) {
    if (next.worldId !== state?.worldId || next.runId !== state?.runId) initialized = false;
    state = next; received = performance.now(); world ??= createPhysicalRenderScene(next, { firstPerson: false });
  } };
}
