import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { imageSignature } from '../server/vision/image-signature.js';
import { imageSignatureDifference } from '../shared/attention-protocol.js';

const pixels = (red:number,green:number,blue:number) => {
  const png = new PNG({width:32,height:32});
  for (let i=0;i<png.data.length;i+=4) png.data.set([red,green,blue,255],i);
  return png;
};
test('perceptual signature compares decoded colors, independent of PNG compression',()=>{
  const png=pixels(200,40,10);
  const a=imageSignature(PNG.sync.write(png,{deflateLevel:0})),b=imageSignature(PNG.sync.write(png,{deflateLevel:9}));
  assert.deepEqual(a,b);assert.equal(imageSignatureDifference(a,b),0);
  assert.ok(imageSignatureDifference(a,imageSignature(PNG.sync.write(pixels(10,200,40))))>.3);
});
test('small RGB probe preserves uniform brightness changes and rejects unbounded or corrupt PNG',()=>{
  const light=imageSignature(PNG.sync.write(pixels(100,100,100))),dark=imageSignature(PNG.sync.write(pixels(0,0,0)));
  assert.ok(imageSignatureDifference(light,dark)>.39);
  assert.throws(()=>imageSignature(new Uint8Array([137,80,78,71])),/bounded PNG/);
  const oversized=PNG.sync.write(pixels(1,1,1));oversized.writeUInt32BE(4096,16);
  assert.throws(()=>imageSignature(oversized),/dimensions/);
  const corrupt=PNG.sync.write(pixels(1,2,3));corrupt[corrupt.length-5]^=255;
  assert.throws(()=>imageSignature(corrupt));
});
