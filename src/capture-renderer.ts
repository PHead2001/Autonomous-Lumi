import * as THREE from 'three';
import { createPhysicalRenderScene } from './render-scene.js';
import type { WorldState } from '../shared/protocol.js';

declare global {
  interface Window { lumiRender(snapshot: WorldState, width: number, height: number): { png: string; backend: { webglVendor: string; webglRenderer: string; version: string }; resources: { geometries: number; textures: number } } }
}

// No animation loop, viewer connection, wall clock, or authoritative simulation exists here.
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
window.lumiRender = (snapshot, width, height) => {
  renderer.setSize(width, height, false);
  const physical = createPhysicalRenderScene(snapshot, { firstPerson: true, width, height });
  let result: { png: string; backend: { webglVendor: string; webglRenderer: string; version: string } };
  try {
    renderer.render(physical.scene, physical.camera);
    const context = renderer.getContext(), debug = context.getExtension('WEBGL_debug_renderer_info');
    result = {
      png: renderer.domElement.toDataURL('image/png'),
      backend: { webglVendor: String(context.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? context.VENDOR)), webglRenderer: String(context.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? context.RENDERER)), version: String(context.getParameter(context.VERSION)) },
    };
  } finally { physical.dispose(); renderer.renderLists.dispose(); }
  return { ...result, resources: { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures } };
};
