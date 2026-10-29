import * as THREE from 'three';
import { earFlick, type WorldState } from '../shared/protocol';
import { bodyBob } from '../shared/eye-pose';
import { AVATAR_RIG } from '../shared/avatar-rig';

const material = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true });
const fur = material('#d98349'), cream = material('#ffe4c2'), hair = material('#a54e32'), outfit = material('#366b68');
const dark = material('#3b3037'), pink = material('#e9a1a0'), white = material('#fff2dc');
function mesh(geometry: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, position: [number, number, number], scale?: [number, number, number]) {
  const part = new THREE.Mesh(geometry, mat); part.position.set(...position); if (scale) part.scale.set(...scale);
  part.castShadow = true; part.receiveShadow = true; parent.add(part); return part;
}
const ball = new THREE.IcosahedronGeometry(1, 1);
function ellipsoid(parent: THREE.Object3D, mat: THREE.Material, position: [number, number, number], scale: [number, number, number]) { return mesh(ball, mat, parent, position, scale); }
function pivot(parent: THREE.Object3D, position: [number, number, number]) { const group = new THREE.Group(); group.position.set(...position); parent.add(group); return group; }
function ear(parent: THREE.Object3D, x: number) {
  const joint = pivot(parent, [x, 0.32, 0]);
  const shape = new THREE.Shape(); shape.moveTo(-0.2, 0); shape.lineTo(0.01, 0.67); shape.lineTo(0.22, 0); shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: false });
  mesh(geometry, fur, joint, [0, 0, -0.08]);
  const inner = new THREE.Shape(); inner.moveTo(-0.12, 0.07); inner.lineTo(0.01, 0.51); inner.lineTo(0.14, 0.07); inner.closePath();
  mesh(new THREE.ShapeGeometry(inner), pink, joint, [0, 0, 0.09]);
  joint.rotation.z = -Math.sign(x) * 0.16; return joint;
}
export function createAvatar(options: { firstPerson?: boolean } = {}) {
  const root = new THREE.Group();
  const body = pivot(root, [0, 0, 0]);
  // A fitted tunic, flared skirt, long hair, and two articulated legs form the provisional silhouette.
  ellipsoid(body, outfit, [0, 1.64, 0], [0.33, 0.46, 0.24]);
  mesh(new THREE.CylinderGeometry(0.26, 0.55, 0.57, 8), outfit, body, [0, 1.16, 0]);
  mesh(new THREE.CylinderGeometry(0.275, 0.29, 0.08, 8), cream, body, [0, 1.48, 0]);
  mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.17, 8), cream, body, [0, 2.04, 0]);
  const head = pivot(body, [...AVATAR_RIG.headPivot]);
  head.rotation.order = 'YXZ';
  // Only the wearer's head/hair/ears are hidden for the eye camera. Environment and body remain real.
  head.visible = !options.firstPerson;
  ellipsoid(head, hair, [0, 0.01, -0.06], [0.4, 0.44, 0.32]);
  ellipsoid(head, cream, [0, -0.02, 0.15], [0.325, 0.35, 0.245]);
  for (const side of [-1, 1]) {
    ellipsoid(head, hair, [side * 0.3, -0.24, -0.05], [0.16, 0.5, 0.2]);
    ellipsoid(head, hair, [side * 0.14, 0.24, 0.23], [0.22, 0.17, 0.13]).rotation.z = side * 0.28;
    ellipsoid(head, dark, [side * 0.13, 0.015, 0.365], [0.047, 0.071, 0.025]);
    ellipsoid(head, white, [side * 0.13 - 0.01, 0.04, 0.387], [0.013, 0.02, 0.008]);
    ellipsoid(head, pink, [side * 0.22, -0.09, 0.334], [0.06, 0.026, 0.018]);
  }
  ellipsoid(head, fur, [0, -0.08, 0.38], [0.045, 0.035, 0.03]);
  const ears = [ear(head, -0.25), ear(head, 0.25)];
  const legs: THREE.Group[] = [], arms: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const leg = pivot(body, [side * 0.22, 0.99, 0]);
    mesh(new THREE.CylinderGeometry(0.1, 0.085, 0.65, 7), cream, leg, [0, -0.3, 0]);
    mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.34, 7), dark, leg, [0, -0.74, 0]);
    ellipsoid(leg, dark, [0, -0.9, 0.08], [0.135, 0.1, 0.24]); legs.push(leg);
    const arm = pivot(body, [side * 0.37, 1.88, 0]);
    mesh(new THREE.CylinderGeometry(0.115, 0.09, 0.33, 7), outfit, arm, [side * 0.035, -0.14, 0]);
    mesh(new THREE.CylinderGeometry(0.075, 0.065, 0.38, 7), cream, arm, [side * 0.06, -0.45, 0]);
    ellipsoid(arm, cream, [side * 0.065, -0.69, 0.02], [0.09, 0.12, 0.07]);
    arm.rotation.z = side * 0.08; arms.push(arm);
  }
  const tail = pivot(body, [0, 1.02, -0.19]);
  ellipsoid(tail, fur, [0, 0.12, -0.44], [0.25, 0.3, 0.58]).rotation.x = 0.4;
  ellipsoid(tail, fur, [0, 0.38, -0.9], [0.34, 0.36, 0.5]).rotation.x = 0.5;
  ellipsoid(tail, cream, [0, 0.63, -1.2], [0.26, 0.32, 0.38]).rotation.x = 0.5;
  // Ball geometry and the palette are module resources shared by successive
  // avatars. Cylinders and ear geometry belong to this instance alone.
  const ownedGeometries = new Set<THREE.BufferGeometry>();
  root.traverse(part => { if (part instanceof THREE.Mesh && part.geometry !== ball) ownedGeometries.add(part.geometry); });
  const ownedGeometryCount = ownedGeometries.size;
  return { root, head, body, ownedGeometryCount, dispose() {
    for (const geometry of ownedGeometries) geometry.dispose();
    ownedGeometries.clear();
  }, update(state: WorldState, time: number, gait: number) {
    const walking = state.character.moving;
    const swing = walking ? Math.sin(gait) * 0.43 : 0;
    legs[0].rotation.x = swing; legs[1].rotation.x = -swing;
    arms[0].rotation.x = -swing * 0.65; arms[1].rotation.x = swing * 0.65;
    body.position.y = bodyBob(state, time, gait);
    head.rotation.y = state.head?.yaw ?? 0;
    head.rotation.x = -(state.head?.pitch ?? 0);
    tail.rotation.y = Math.sin(time * 2.4) * 0.16;
    const flick = earFlick(time, state.reflex);
    ears[0].rotation.z = 0.16 + flick * 1.15;
    ears[1].rotation.z = -0.16 - flick * 0.9;
    ears[0].rotation.x = flick * 0.65; ears[1].rotation.x = flick * 0.4;
  } };
}
