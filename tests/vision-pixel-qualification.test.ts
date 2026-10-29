import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { qualifyPixelGrounding, filterPixelQualifiedGrounding, PIXEL_QUALIFICATION } from '../server/vision/pixel-qualification.js';
import { groundSnapshot, type GroundingResult } from '../server/vision/grounding.js';
import { createVisibilityFixture } from '../shared/vision-fixture.js';
import { PRIVATE_MASK_REVISION } from '../shared/private-render-mask.js';
const geometry=():GroundingResult=>({...groundSnapshot(createVisibilityFixture(),128,128),objects:[{id:'private-target',status:'visible',eligible:true,totalSamples:27,inFrustumSamples:27,visibleSamples:27,sampleVisibilityFraction:1,projectedPixels:40,qualityFlags:[],bearingRadians:0,elevationRadians:0,distance:2}]});
function pair(inside=200,outside=80,size=48,clutter=false){const width=128,height=128,rgb=new PNG({width,height}),mask=new PNG({width,height});for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4,on=x>=40&&x<40+size&&y>=40&&y<40+size;const value=on?inside:clutter?50+(x*17+y*13)%150:outside;rgb.data[i]=rgb.data[i+1]=rgb.data[i+2]=value;rgb.data[i+3]=mask.data[i+3]=255;mask.data[i]=on?1:0;}return {rgb:PNG.sync.write(rgb),mask:{bytes:PNG.sync.write(mask),physicalIds:['','private-target'],revision:PRIVATE_MASK_REVISION,width,height}};}
function qualified(p:ReturnType<typeof pair>,g=geometry()){return qualifyPixelGrounding(g,p.rgb,p.mask,128,128);}
test('strong measured pixel contrast permits high confidence after paired evidence validation',()=>{
 const result=qualified(pair());let minted=0;const shapes=filterPixelQualifiedGrounding(result,()=>{minted++;return 'opaque';});assert.equal(minted,1);assert.equal(shapes[0].uncertainty,'geometry_candidates_pixel_checked');assert.equal(shapes[0].sampleVisibilityBand,'high');assert.equal(result.pixelQualification.revision,PIXEL_QUALIFICATION.revision);assert.ok(result.pixelQualification.objects[0].interiorPixels>1000);
 const partial=geometry();partial.objects[0].sampleVisibilityFraction=.25;partial.objects[0].status='partially_occluded';assert.equal(filterPixelQualifiedGrounding(qualified(pair(200,80,18),partial),()=> 'partial')[0].sampleVisibilityBand,'low');
});
test('same geometry with camouflaged, black, tiny or insufficiently covered pixels retains only low-confidence handles',()=>{
 for(const pixels of [pair(80,80),pair(0,0),pair(200,80,4),pair(200,80,1)]){const result=qualified(pixels);let minted=0;const shapes=filterPixelQualifiedGrounding(result,()=>{minted++;return 'possible';});assert.equal(shapes.length,1);assert.equal(shapes[0].sampleVisibilityBand,'low');assert.equal(minted,1);assert.equal(result.objects[0].eligible,true);assert.ok(shapes[0].qualityFlags.includes('limited_pixel_support'));}
 const ringClutter=qualified(pair(125,80,48,true));assert.equal(ringClutter.pixelQualification.objects[0].marginal,true);assert.equal(filterPixelQualifiedGrounding(ringClutter,()=> 'uncertain')[0].sampleVisibilityBand,'low');assert.ok(ringClutter.pixelQualification.objects[0].robustSpread>15);
});
test('marginal and dim actual RGB signal uses measured contrast and caps the hint at low',()=>{
 const marginal=qualified(pair(100,80)),dim=qualified(pair(30,4));for(const result of [marginal,dim]){const shapes=filterPixelQualifiedGrounding(result,()=> 'coarse');assert.equal(shapes.length,1);assert.equal(shapes[0].sampleVisibilityBand,'low');assert.ok(shapes[0].qualityFlags.includes(result===dim?'low_rgb_signal':'marginal_pixel_contrast'));}
 const state=createVisibilityFixture();state.scene!.illumination=.04;assert.ok(groundSnapshot(state).objects.some(o=>o.qualityFlags.includes('low_light')));assert.ok(!groundSnapshot(state,512,512,{ignoreLegacyIlluminationGate:true}).objects.some(o=>o.qualityFlags.includes('low_light')));
});
test('low absolute RGB signal cannot become HIGH from a large relative contrast ratio',()=>{
 const result=qualified(pair(40,4));const shapes=filterPixelQualifiedGrounding(result,()=> 'dim-possible');assert.equal(shapes.length,1);assert.equal(shapes[0].sampleVisibilityBand,'low');assert.ok(shapes[0].qualityFlags.includes('low_rgb_signal'));assert.equal(result.pixelQualification.objects[0].absoluteRgbContrast,36);assert.equal(result.pixelQualification.objects[0].relativeContrast,.9);assert.equal(result.pixelQualification.objects[0].interiorLuminance,40);
});
test('missing/corrupt masks, index membership, alpha or dimensions fail closed without geometric fallback',()=>{
 const source=pair(),variants=[undefined,{...source.mask,bytes:new Uint8Array(48)},{...source.mask,width:129},{...source.mask,physicalIds:['','wrong-private-id']}];
 const badPixel=PNG.sync.read(source.mask.bytes);badPixel.data[0]=2;variants.push({...source.mask,bytes:PNG.sync.write(badPixel)});const badAlpha=PNG.sync.read(source.mask.bytes);badAlpha.data[3]=0;variants.push({...source.mask,bytes:PNG.sync.write(badAlpha)});
 for(const mask of variants){const result=qualifyPixelGrounding(geometry(),source.rgb,mask,128,128);assert.equal(result.pixelQualification.status,'unavailable');assert.equal(filterPixelQualifiedGrounding(result,()=> 'never').length,0);assert.equal(result.objects[0].eligible,false);}
});
