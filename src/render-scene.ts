import * as THREE from 'three';
import type { WorldState } from '../shared/protocol';
import { eyePose } from '../shared/eye-pose';
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
  const avatar = createAvatar({ firstPerson: options.firstPerson }); scene.add(avatar.root);
  function applySnapshot(state: WorldState, presentationTime = state.time, placeAvatar = true) {
    const physical = physicalSceneSnapshot(state, presentationTime), seen = new Set<string>();
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
    avatar.update(state, presentationTime, state.character.gait);
    const pose = eyePose(state, options.width, options.height);
    camera.fov = pose.verticalFovDegrees; camera.aspect = pose.width / pose.height; camera.near = pose.near; camera.far = pose.far;
    camera.position.set(...pose.position); camera.up.set(...pose.up); camera.lookAt(new THREE.Vector3(...pose.position).add(new THREE.Vector3(...pose.direction))); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    scene.updateMatrixWorld(true);
  }
  applySnapshot(initial);
  let disposed = false;
  return { scene, camera, avatar, applySnapshot, dispose() {
    if (disposed) return; disposed = true;
    for (const mesh of meshes.values()) { mesh.geometry.dispose(); mesh.material.dispose(); } meshes.clear();
    avatar.dispose();
    sun.shadow.map?.dispose(); scene.clear();
  } };
}
