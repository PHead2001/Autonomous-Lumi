import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { ChromiumRenderer, type RenderedFrame } from '../server/vision/renderer.js';
import { createVisibilityFixture } from '../shared/vision-fixture.js';
import { physicalSceneSnapshot } from '../shared/physical-scene.js';

function decode(frame: RenderedFrame) {
  assert.ok(frame.privateMask);
  const mask = PNG.sync.read(Buffer.from(frame.privateMask.bytes));
  const rgb = PNG.sync.read(Buffer.from(frame.bytes));
  assert.equal(mask.width, rgb.width); assert.equal(mask.height, rgb.height);
  const ids: number[] = [], counts = new Map<string, number>();
  for (let i = 0; i < mask.data.length; i += 4) {
    const id = mask.data[i] | mask.data[i + 1] << 8 | mask.data[i + 2] << 16;
    assert.equal(mask.data[i + 3], 255); assert.ok(id < frame.privateMask.physicalIds.length);
    ids.push(id); const name = frame.privateMask.physicalIds[id]; counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return { mask, rgb, ids, counts, names: frame.privateMask.physicalIds };
}

for (const backend of ['angle-d3d11', 'swiftshader'] as const) {
  test(`actual ${backend} private mask aligns with RGB, respects occluders and has bounded resources`, async () => {
    const renderer = new ChromiumRenderer(backend), fixture = createVisibilityFixture();
    try {
      const first = await renderer.render(fixture, 384, 256), d = decode(first);
      assert.deepEqual(d.names, ['', ...physicalSceneSnapshot(fixture).boxes.filter(b => b.observable).map(b => b.id)]);
      assert.ok((d.counts.get('fixture-ahead') ?? 0) > 100);
      assert.ok((d.counts.get('fixture-partial') ?? 0) > 50);
      for (const hidden of ['fixture-behind-wall', 'fixture-outside-fov', 'fixture-beyond-door']) assert.equal(d.counts.get(hidden) ?? 0, 0, hidden);
      // Real RGB evidence at the very same top-down pixels: this catches Y inversion,
      // color-managed IDs, viewport mismatch and mask/RGB snapshot mismatches.
      for (const [name, matches] of [
        ['fixture-ahead', (r:number,g:number,b:number) => r > 60 && r > g * 1.5 && r > b * 1.5],
        ['fixture-partial', (r:number,g:number,b:number) => r > 70 && g > 65 && r > b * 1.5 && g > b * 1.5],
      ] as const) {
        let good = 0, total = 0;
        for (let p = 0; p < d.ids.length; p++) if (d.names[d.ids[p]] === name) { total++; if (matches(d.rgb.data[p*4], d.rgb.data[p*4+1], d.rgb.data[p*4+2])) good++; }
        assert.ok(good / total > .98, `${name} RGB alignment ${good}/${total}`);
      }
      // The blue foreground screen is unobservable, but must still erase candidate IDs.
      let screenPixels = 0;
      for (let p = 0; p < d.ids.length; p++) {
        const [r,g,b] = d.rgb.data.subarray(p*4, p*4+3);
        if (b > r * 1.15 && b > g * 1.02 && r > 30) { screenPixels++; assert.equal(d.ids[p], 0); }
      }
      assert.ok(screenPixels > 100);
      const dark = structuredClone(fixture); dark.scene!.illumination = 0;
      const darkFrame = await renderer.render(dark, 384, 256), darkness = decode(darkFrame);
      assert.deepEqual(darkness.ids, d.ids, 'IDs do not depend on lighting');
      assert.equal(darkness.rgb.data.some((v, i) => i % 4 !== 3 && v !== 0), false);
      const door = structuredClone(fixture); door.character = { x: 2.97, z: -1.5, heading: Math.PI, moving: false, gait: 0 }; door.scene!.doorOpenRadians = 0;
      assert.equal(decode(await renderer.render(door, 384, 256)).counts.get('fixture-beyond-door') ?? 0, 0);
      door.scene!.doorOpenRadians = -Math.PI / 2;
      assert.ok((decode(await renderer.render(door, 384, 256)).counts.get('fixture-beyond-door') ?? 0) > 50);
      const resources = [];
      for (let i = 0; i < 3; i++) {
        const frame = await renderer.render(fixture, 384, 256);
        assert.deepEqual(frame.bytes, first.bytes, 'mask pass restores RGB renderer state');
        assert.deepEqual(frame.privateMask!.bytes, first.privateMask!.bytes);
        resources.push(frame.resources);
      }
      // Three retains its single background geometry; per-frame meshes/targets must not grow.
      assert.ok(resources.every(r => r && r.geometries <= 1 && r.textures === 0), JSON.stringify(resources));
      assert.equal(new Set(resources.map(r => JSON.stringify(r))).size, 1);
    } finally { await renderer.close(); }
  });
}
