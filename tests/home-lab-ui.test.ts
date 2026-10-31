import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localHomeLabUrl,readHomeLabProgress,guidedLabEndpoint} from '../src/home-lab-ui.js';
const progress={scenarioId:'home-demo-1',status:'RUNNING',phase:'Looking for food',expected:'Actual consumed serving',observed:'No meal completed yet',viewerUrl:'/?worldId=lumi&branchId=home-demo-1'};
test('guided lab preserves actual non-success status and rejects another scenario response',()=>{assert.equal(readHomeLabProgress(progress).status,'RUNNING');assert.equal(readHomeLabProgress({...progress,status:'FAIL'}).status,'FAIL');assert.throws(()=>readHomeLabProgress(progress,'other-scenario'),/mismatched/);assert.throws(()=>readHomeLabProgress({...progress,status:'COMPLETE'}),/invalid/);});
test('guided lab links remain local and cannot silently open LIVE or developer view',()=>{const origin='http://127.0.0.1:5173';assert.match(localHomeLabUrl(progress.viewerUrl,origin,'viewer'),/branchId=home-demo-1/);assert.throws(()=>localHomeLabUrl('https://elsewhere.test/',origin,'viewer'));assert.throws(()=>localHomeLabUrl('/?worldId=lumi&branchId=live',origin,'viewer'));assert.throws(()=>localHomeLabUrl('/?worldId=lumi&branchId=demo&view=dashboard',origin,'viewer'));assert.throws(()=>localHomeLabUrl('javascript:alert(1)',origin,'export'));assert.match(localHomeLabUrl('/api/download?exportId=demo',origin,'export'),/api\/download/);});

test('guided shop exercises use their own lab and unsupported selections have no fallback endpoint',()=>{
  assert.equal(guidedLabEndpoint('food'),'/api/home-lab');assert.equal(guidedLabEndpoint('bed'),'/api/home-lab');assert.equal(guidedLabEndpoint('shop'),'/api/town-lab');assert.equal(guidedLabEndpoint('shop-closed'),'/api/town-lab');assert.throws(()=>guidedLabEndpoint('live'),/available isolated/);assert.throws(()=>guidedLabEndpoint(''),/available isolated/);
});
