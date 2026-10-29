import { PNG } from 'pngjs';
import { PRIVATE_MASK_REVISION, type PrivateRenderMask } from '../../shared/private-render-mask.js';
import { filterVisibleGrounding, type GroundingResult, type VisibleGrounding } from './grounding.js';

/** Versioned engineering heuristic, not a physiological or recognition model.
 * All contrast is measured from the paired final 8-bit RGB frame, never materials/light settings. */
export const PIXEL_QUALIFICATION = {
 revision:'rgb-mask-contrast-v1', erosionRadius:1, ringRadius:3,
 minVisiblePixels:32, minInteriorPixels:16, minRingPixels:24,
 minInteriorFraction:.1, minRingPerBoundary:.5,
 minAbsoluteContrast:14, minRelativeContrast:.12, minCorrectedContrast:8, minSignalLuminance:6,
 // HIGH also requires at least 48/255 median display luminance on one side of the edge.
 // This explicit low-signal confidence cap is an engineering threshold, not a world-light cutoff.
 robustSpreadPenalty:.75, strongSignalLuminance:48, strongVisiblePixels:128, strongInteriorPixels:64, strongRingPixels:64, strongAbsoluteContrast:28, strongRelativeContrast:.22, strongCorrectedContrast:18,
} as const;
export interface PixelObjectEvidence {
 privateId:string; visiblePixels:number; interiorPixels:number; ringPixels:number; boundaryPixels:number;
 absoluteRgbContrast:number; luminanceContrast:number; relativeContrast:number; robustSpread:number; correctedContrast:number;
 interiorLuminance:number; ringLuminance:number; qualified:boolean; marginal:boolean; reason:string;
}
export interface PixelQualificationReport {revision:typeof PIXEL_QUALIFICATION.revision;status:'checked'|'unavailable';reason:string|null;objects:PixelObjectEvidence[]}
export type PixelGroundingResult=GroundingResult&{pixelQualification:PixelQualificationReport};
function decode(bytes:Uint8Array,width:number,height:number,mask=false){
 if(!(bytes instanceof Uint8Array)||bytes.length<33||bytes.length>width*height*5+65536)throw new Error('Invalid bounded pixel bytes');
 const buffer=Buffer.from(bytes);if(buffer.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||buffer.readUInt32BE(16)!==width||buffer.readUInt32BE(20)!==height||mask&&(buffer[24]!==8||buffer[25]!==6))throw new Error('Pixel dimensions/format mismatch');
 const png=PNG.sync.read(buffer,{checkCRC:true});if(png.width!==width||png.height!==height||png.data.length!==width*height*4)throw new Error('Invalid decoded pixels');return png.data;
}
function median(hist:number[],count:number){let sum=0;for(let i=0;i<256;i++){sum+=hist[i];if(sum>count/2)return i;}return 0;}
function distribution(data:Buffer,positions:number[]){
 const hist=Array.from({length:4},()=>Array<number>(256).fill(0));
 for(const pixel of positions){const i=pixel*4;for(let c=0;c<3;c++)hist[c][data[i+c]]++;hist[3][Math.round(.2126*data[i]+.7152*data[i+1]+.0722*data[i+2])]++;}
 const medians=hist.map(h=>median(h,positions.length));const spread=hist.slice(0,3).map((h,c)=>{const deviations=Array<number>(256).fill(0);for(let i=0;i<256;i++)deviations[Math.abs(i-medians[c])]+=h[i];return median(deviations,positions.length);});
 return {rgb:medians.slice(0,3),luminance:medians[3],spread:Math.max(...spread)};
}
/** Missing/malformed auxiliary evidence never falls back to geometry. The RGB frame can remain usable. */
export function qualifyPixelGrounding(geometry:GroundingResult,rgb:Uint8Array,mask:PrivateRenderMask|undefined,width:number,height:number):PixelGroundingResult {
 const result=structuredClone(geometry) as PixelGroundingResult;result.pixelQualification={revision:PIXEL_QUALIFICATION.revision,status:'unavailable',reason:null,objects:[]};
 try{
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<128||height<128||width>1024||height>1024)throw new Error('Invalid bounded image dimensions');
  const pixels=decode(rgb,width,height);
  if(!mask||mask.revision!==PRIVATE_MASK_REVISION||mask.width!==width||mask.height!==height||!Array.isArray(mask.physicalIds)||mask.physicalIds.length!==geometry.objects.length+1||mask.physicalIds[0]!==''||mask.physicalIds.some((id,i)=>i>0&&id!==geometry.objects[i-1].id))throw new Error('Missing or mismatched private mask index');
  const maskPixels=decode(mask.bytes,width,height,true),labels=new Uint32Array(width*height),groups=mask.physicalIds.map(()=>[] as number[]);
  for(let pixel=0;pixel<labels.length;pixel++){const i=pixel*4,label=maskPixels[i]+maskPixels[i+1]*256+maskPixels[i+2]*65536;if(maskPixels[i+3]!==255||label>=groups.length||pixels[i+3]!==255)throw new Error('Invalid private mask pixel');labels[pixel]=label;if(label)groups[label].push(pixel);}
  result.pixelQualification.status='checked';
  for(const [objectIndex,object] of result.objects.entries()){
   const label=objectIndex+1,positions=groups[label],inside:number[]=[],boundary:number[]=[],ring:number[]=[],seen=new Uint8Array(labels.length);
   for(const pixel of positions){const x=pixel%width,y=Math.floor(pixel/width);let interior=x>0&&x<width-1&&y>0&&y<height-1;
    if(interior)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(labels[pixel+dy*width+dx]!==label)interior=false;
    (interior?inside:boundary).push(pixel);
   }
   for(const pixel of boundary){const x=pixel%width,y=Math.floor(pixel/width);for(let dy=-PIXEL_QUALIFICATION.ringRadius;dy<=PIXEL_QUALIFICATION.ringRadius;dy++)for(let dx=-PIXEL_QUALIFICATION.ringRadius;dx<=PIXEL_QUALIFICATION.ringRadius;dx++){const xx=x+dx,yy=y+dy;if(xx<0||xx>=width||yy<0||yy>=height)continue;const other=yy*width+xx;if(labels[other]!==label&&!seen[other]){seen[other]=1;ring.push(other);}}}
   const a=distribution(pixels,inside),b=distribution(pixels,ring),absolute=Math.max(...a.rgb.map((value,i)=>Math.abs(value-b.rgb[i]))),luminance=Math.abs(a.luminance-b.luminance),relative=absolute/Math.max(16,a.luminance,b.luminance),spread=Math.max(a.spread,b.spread),corrected=Math.max(0,absolute-PIXEL_QUALIFICATION.robustSpreadPenalty*spread);
   const coverage=positions.length>=PIXEL_QUALIFICATION.minVisiblePixels&&inside.length>=PIXEL_QUALIFICATION.minInteriorPixels&&ring.length>=PIXEL_QUALIFICATION.minRingPixels&&inside.length/Math.max(1,positions.length)>=PIXEL_QUALIFICATION.minInteriorFraction&&ring.length/Math.max(1,boundary.length)>=PIXEL_QUALIFICATION.minRingPerBoundary;
   const signalLuminance=Math.max(a.luminance,b.luminance),signal=signalLuminance>=PIXEL_QUALIFICATION.minSignalLuminance,strongSignal=signalLuminance>=PIXEL_QUALIFICATION.strongSignalLuminance;
   const contrast=absolute>=PIXEL_QUALIFICATION.minAbsoluteContrast&&relative>=PIXEL_QUALIFICATION.minRelativeContrast&&corrected>=PIXEL_QUALIFICATION.minCorrectedContrast;
   const qualified=object.eligible,marginal=qualified&&(!coverage||!strongSignal||!contrast||positions.length<PIXEL_QUALIFICATION.strongVisiblePixels||inside.length<PIXEL_QUALIFICATION.strongInteriorPixels||ring.length<PIXEL_QUALIFICATION.strongRingPixels||absolute<PIXEL_QUALIFICATION.strongAbsoluteContrast||relative<PIXEL_QUALIFICATION.strongRelativeContrast||corrected<PIXEL_QUALIFICATION.strongCorrectedContrast);
   const reason=!object.eligible?'geometric_candidate_ineligible':!positions.length?'no_pixel_support':!coverage?'limited_pixel_resolution':!signal?'no_rgb_support':!strongSignal?'low_rgb_signal':!contrast?(spread>30?'clutter_limited_pixel_contrast':'low_pixel_contrast'):marginal?'marginal_pixel_contrast':'pixel_contrast_pass';
   result.pixelQualification.objects.push({privateId:object.id,visiblePixels:positions.length,interiorPixels:inside.length,ringPixels:ring.length,boundaryPixels:boundary.length,absoluteRgbContrast:absolute,luminanceContrast:luminance,relativeContrast:relative,robustSpread:spread,correctedContrast:corrected,interiorLuminance:a.luminance,ringLuminance:b.luminance,qualified,marginal,reason});
   if(marginal)object.qualityFlags.push('limited_pixel_support',reason);
  }
 }catch{
  result.pixelQualification.status='unavailable';result.pixelQualification.reason='paired_pixel_evidence_unavailable_or_invalid';result.pixelQualification.objects=[];
  for(const object of result.objects){object.eligible=false;object.qualityFlags.push('pixel_qualification_unavailable');}
 }
 return result;
}
/** Opaque handles are minted only after valid paired-pixel measurement; weak support lowers confidence rather than claiming absence. */
export function filterPixelQualifiedGrounding(result:PixelGroundingResult,handleFor:(privateId:string)=>string):VisibleGrounding[]{
 return filterVisibleGrounding(result,handleFor).map(shape=>({...shape,uncertainty:'geometry_candidates_pixel_checked',sampleVisibilityBand:shape.qualityFlags.includes('limited_pixel_support')?'low':shape.sampleVisibilityBand}));
}
