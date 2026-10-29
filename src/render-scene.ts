import * as THREE from 'three';
import type { WorldState } from '../shared/protocol';
import { assertCameraClearance, eyePose } from '../shared/eye-pose';
import { physicalSceneSnapshot } from '../shared/physical-scene';
import { createAvatar } from './avatar';

export { RENDER_REVISION } from '../shared/physical-scene';
/** Used by both the spectator and isolated first-person worker. It owns no world loop or clock. */
export function createPhysicalRenderScene(initial: WorldState, options: { firstPerson: boolean; width?: number; height?: number }) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#d9ded3');
  const camera = new THREE.PerspectiveCamera();
  const hemisphere = new THREE.HemisphereLight('#fff4de', '#6f8079', 2.5); scene.add(hemisphere);
  const sun = new THREE.DirectionalLight('#fff0cf', 4); sun.position.set(-3, 9, 5); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7 }); sun.shadow.normalBias = 0.03; scene.add(sun);
  const environment = new THREE.Group(); scene.add(environment);
  const meshes = new Map<string, THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>>();
  let candidateIds: string[] = [];
  const avatar = createAvatar({ firstPerson: options.firstPerson }); scene.add(avatar.root);
  function applySnapshot(state: WorldState, presentationTime = state.time, placeAvatar = true) {
    if (options.firstPerson) assertCameraClearance(state, options.width, options.height);
    const time = options.firstPerson ? state.time : presentationTime;
    const physical = physicalSceneSnapshot(state, time), seen = new Set<string>();
    candidateIds = physical.boxes.filter(box => box.observable).map(box => box.id);
    for (const b of physical.boxes) {
      seen.add(b.id);
      let mesh = meshes.get(b.id);
      if (!mesh) {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.9 }));
        mesh.castShadow = true; mesh.receiveShadow = true; environment.add(mesh); meshes.set(b.id, mesh);
      }
      mesh.position.set(...b.position); mesh.scale.set(...b.size); mesh.rotation.y = b.yaw; mesh.material.color.set(b.color);
      mesh.visible = options.firstPerson || !b.cutaway;
    }
    for (const [id, mesh] of meshes) if (!seen.has(id)) { mesh.removeFromParent(); mesh.geometry.dispose(); mesh.material.dispose(); meshes.delete(id); }
    hemisphere.intensity = physical.illumination * 2.5; sun.intensity = physical.illumination * 4;
    // A dark room has a dark exterior background as well; no fake ambient/emissive cue remains.
    (scene.background as THREE.Color).set(physical.illumination === 0 ? '#000000' : '#d9ded3');
    if (placeAvatar) { avatar.root.position.set(state.character.x, 0, state.character.z); avatar.root.rotation.y = state.character.heading; }
    avatar.update(state, time, state.character.gait);
    const pose = eyePose(state, options.width, options.height);
    camera.fov = pose.verticalFovDegrees; camera.aspect = pose.width / pose.height; camera.near = pose.near; camera.far = pose.far;
    camera.position.set(...pose.position); camera.up.set(...pose.up); camera.lookAt(new THREE.Vector3(...pose.position).add(new THREE.Vector3(...pose.direction))); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    scene.updateMatrixWorld(true);
  }
  applySnapshot(initial);
  let disposed = false;
  return { scene, camera, avatar, applySnapshot,
    /** Synchronous second pass over exactly the matrices used for RGB. Every mesh writes depth,
     * including unlabelled environment details and the first-person avatar. */
    renderPrivateMask(renderer: THREE.WebGLRenderer, width: number, height: number) {
      const physicalIds = ['', ...candidateIds];
      if (physicalIds.length > 0xffffff) throw new Error('Mask identity capacity exceeded');
      const meshIds = new Map<THREE.Object3D, number>();
      candidateIds.forEach((id, index) => { const mesh = meshes.get(id); if (mesh) meshIds.set(mesh, index + 1); });
      const target = new THREE.WebGLRenderTarget(width, height, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, stencilBuffer: false, samples: 0, generateMipmaps: false });
      target.texture.colorSpace = THREE.NoColorSpace;
      const materials = new Map<number, THREE.ShaderMaterial>();
      const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
      const old = { target: renderer.getRenderTarget(), background: scene.background, override: scene.overrideMaterial, toneMapping: renderer.toneMapping, outputColorSpace: renderer.outputColorSpace, autoClear: renderer.autoClear, shadows: renderer.shadowMap.enabled, clearColor: renderer.getClearColor(new THREE.Color()).clone(), clearAlpha: renderer.getClearAlpha(), viewport: renderer.getViewport(new THREE.Vector4()), scissor: renderer.getScissor(new THREE.Vector4()), scissorTest: renderer.getScissorTest() };
      try {
        scene.traverse(object => {
          if (!(object instanceof THREE.Mesh)) return;
          originals.set(object, object.material);
          const id = meshIds.get(object) ?? 0;
          let material = materials.get(id);
          if (!material) {
            material = new THREE.ShaderMaterial({
              uniforms: { encodedId: { value: new THREE.Vector3((id & 255) / 255, ((id >>> 8) & 255) / 255, ((id >>> 16) & 255) / 255) } },
              vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
              fragmentShader: 'uniform vec3 encodedId; void main() { gl_FragColor = vec4(encodedId, 1.0); }',
              blending: THREE.NoBlending, depthTest: true, depthWrite: true, transparent: false, toneMapped: false, fog: false, dithering: false,
            });
            materials.set(id, material);
          }
          object.material = material;
        });
        scene.background = null; scene.overrideMaterial = null;
        renderer.toneMapping = THREE.NoToneMapping; renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
        renderer.shadowMap.enabled = false; renderer.autoClear = true;
        renderer.setRenderTarget(target); renderer.setViewport(0, 0, width, height); renderer.setScissorTest(false); renderer.setClearColor(0, 1);
        renderer.render(scene, camera);
        const pixels = new Uint8Array(width * height * 4);
        renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
        // WebGL readback is bottom-up; PNG and the RGB capture are top-down.
        const topDown = new Uint8ClampedArray(pixels.length), stride = width * 4;
        for (let row = 0; row < height; row++) topDown.set(pixels.subarray(row * stride, (row + 1) * stride), (height - row - 1) * stride);
        return { pixels: topDown, physicalIds };
      } finally {
        for (const [mesh, material] of originals) mesh.material = material;
        scene.background = old.background; scene.overrideMaterial = old.override;
        renderer.toneMapping = old.toneMapping; renderer.outputColorSpace = old.outputColorSpace; renderer.shadowMap.enabled = old.shadows; renderer.autoClear = old.autoClear;
        renderer.setRenderTarget(old.target); renderer.setViewport(old.viewport); renderer.setScissor(old.scissor); renderer.setScissorTest(old.scissorTest); renderer.setClearColor(old.clearColor, old.clearAlpha);
        target.dispose(); for (const material of materials.values()) material.dispose();
      }
    }, dispose() {
    if (disposed) return; disposed = true;
    for (const mesh of meshes.values()) { mesh.geometry.dispose(); mesh.material.dispose(); } meshes.clear();
    avatar.dispose();
    sun.shadow.map?.dispose(); scene.clear();
  } };
}
