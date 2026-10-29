import * as THREE from 'three';
import { createPhysicalRenderScene } from './render-scene.js';
import type { WorldState } from '../shared/protocol.js';
import { assertMaskDimensions, PRIVATE_MASK_REVISION } from '../shared/private-render-mask.js';

interface BrowserFrame { png: string; privateMask: { png: string; physicalIds: string[]; revision: typeof PRIVATE_MASK_REVISION; width: number; height: number }; backend: { webglVendor: string; webglRenderer: string; version: string }; resources: { geometries: number; textures: number } }

declare global {
  interface Window { lumiRender(snapshot: WorldState, width: number, height: number): BrowserFrame }
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
  assertMaskDimensions(width, height);
  renderer.setSize(width, height, false);
  const physical = createPhysicalRenderScene(snapshot, { firstPerson: true, width, height });
  let result: Omit<BrowserFrame, 'resources'>;
  try {
    renderer.render(physical.scene, physical.camera);
    const context = renderer.getContext(), debug = context.getExtension('WEBGL_debug_renderer_info');
    const png = renderer.domElement.toDataURL('image/png');
    const mask = physical.renderPrivateMask(renderer, width, height);
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const canvasContext = canvas.getContext('2d');
    if (!canvasContext) throw new Error('Mask encoding unavailable');
    canvasContext.putImageData(new ImageData(mask.pixels, width, height), 0, 0);
    result = {
      png,
      privateMask: { png: canvas.toDataURL('image/png'), physicalIds: mask.physicalIds, revision: PRIVATE_MASK_REVISION, width, height },
      backend: { webglVendor: String(context.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? context.VENDOR)), webglRenderer: String(context.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? context.RENDERER)), version: String(context.getParameter(context.VERSION)) },
    };
  } finally { physical.dispose(); renderer.renderLists.dispose(); }
  return { ...result, resources: { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures } };
};
