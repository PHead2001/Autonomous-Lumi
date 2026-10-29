import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPhysicalRenderScene } from '../src/render-scene.js';
import { createVisibilityFixture } from '../shared/vision-fixture.js';

test('capture scene disposal releases each avatar-owned geometry once and preserves shared geometry/materials',()=>{
  const first=createPhysicalRenderScene(createVisibilityFixture(),{firstPerson:true}),second=createPhysicalRenderScene(createVisibilityFixture(),{firstPerson:true});
  const geometries=(root:THREE.Object3D)=>{const result=new Set<THREE.BufferGeometry>();root.traverse(part=>{if(part instanceof THREE.Mesh)result.add(part.geometry);});return result;};
  const a=geometries(first.avatar.root),b=geometries(second.avatar.root),disposed=new Map<THREE.BufferGeometry,number>();
  for(const geometry of a){disposed.set(geometry,0);geometry.addEventListener('dispose',()=>disposed.set(geometry,disposed.get(geometry)!+1));}
  let materialsDisposed=0;first.avatar.root.traverse(part=>{if(part instanceof THREE.Mesh){const materials=Array.isArray(part.material)?part.material:[part.material];for(const material of materials)material.addEventListener('dispose',()=>materialsDisposed++);}});
  first.dispose();first.dispose();
  let owned=0;for(const geometry of a){if(b.has(geometry))assert.equal(disposed.get(geometry),0);else{assert.equal(disposed.get(geometry),1);owned++;}}
  assert.ok(owned>0);assert.equal(owned,first.avatar.ownedGeometryCount);assert.equal(materialsDisposed,0);second.dispose();
});
