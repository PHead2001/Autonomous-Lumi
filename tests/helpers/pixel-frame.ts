import { PNG } from 'pngjs';
import type { WorldState } from '../../shared/protocol.js';
import { PRIVATE_MASK_REVISION } from '../../shared/private-render-mask.js';
import { groundSnapshot } from '../../server/vision/grounding.js';
import type { RenderedFrame } from '../../server/vision/renderer.js';
/** Explicit synthetic paired pixels; this fixture makes no real-renderer visibility claim. */
export function pixelFixtureFrame(snapshot:WorldState,width=512,height=512):RenderedFrame {
 const geometry=groundSnapshot(snapshot,width,height,{ignoreLegacyIlluminationGate:true}),image=new PNG({width,height}),mask=new PNG({width,height});image.data.fill(96);mask.data.fill(0);
 for(let i=3;i<image.data.length;i+=4){image.data[i]=255;mask.data[i]=255;}
 const eligible=geometry.objects.map((o,i)=>({o,index:i+1})).filter(({o})=>o.eligible),columns=Math.max(1,Math.ceil(Math.sqrt(eligible.length))),cell=Math.floor(Math.min(width,height)/columns);
 for(const [index,{index:label}]of eligible.entries()){const left=index%columns*cell+6,top=Math.floor(index/columns)*cell+6;for(let y=top;y<Math.min(height,top+cell-12);y++)for(let x=left;x<Math.min(width,left+cell-12);x++){const i=(y*width+x)*4;image.data[i]=210;image.data[i+1]=45;image.data[i+2]=35;mask.data[i]=label&255;mask.data[i+1]=label>>8&255;mask.data[i+2]=label>>16&255;}}
 return {bytes:PNG.sync.write(image),privateMask:{bytes:PNG.sync.write(mask),physicalIds:['',...geometry.objects.map(o=>o.id)],revision:PRIVATE_MASK_REVISION,width,height},backend:{configuration:'angle-d3d11',chromium:'SYNTHETIC TEST PIXELS',webglVendor:'fixture',webglRenderer:'fixture',version:'fixture',flags:[]}};
}
