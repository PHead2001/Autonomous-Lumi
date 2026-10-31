import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { setImmediate as immediate } from 'node:timers/promises';
import { SocialSimulation } from '../server/simulation.js';
import { BranchRuntime } from '../server/branch-runtime.js';
import { ChromiumRenderer } from '../server/vision/renderer.js';
import { CaptureManager } from '../server/vision/capture-manager.js';
import { AutomaticCaptureCoordinator } from '../server/vision/auto-capture.js';

test('actual badge RGB distinguishes unverified claim, hidden/dark/off-view cues and an unattended readable cue', async () => {
  const directory=resolve(process.env.LUMI_SOCIAL_PERCEPTION_OUT??'diagnostics/social-increment3/negative-eyes');await mkdir(directory,{recursive:true});
  const manager=new CaptureManager(()=>true,new ChromiumRenderer());const reports:unknown[]=[];
  try {
    for(const name of ['unverified','hidden','dark','outside_view','unattended','stale_snapshot'] as const){
      const source=new SocialSimulation({mode:'EXPERIMENT',runId:'negative-'+name,physiology:{active:false}});
      source.enqueue({type:'visit_start',runId:source.state.runId,generation:1});source.step();
      source.enqueue({type:'social_badge',runId:source.state.runId,generation:1,sequence:1,actionId:1,display:true});source.step();
      const seed=source.checkpoint();seed.character.x=0;seed.character.z=0;seed.character.heading=name==='outside_view'?0:Math.PI;
      seed.visit.actor!.x=name==='hidden'?2.97:0;seed.visit.actor!.z=name==='hidden'?-6.5:-1.75;
      // This labelled pose fixture presents the front-mounted badge to Lumi.
      // Set the controller target too, so fixed steps retain the chosen pose
      // rather than turning back toward the new lounge spawn's exit heading.
      seed.visit.actor!.heading=seed.visit.control.targetYaw=0;
      seed.head.yaw=seed.head.targetYaw=0;seed.head.pitch=seed.head.targetPitch=-.55;seed.head.status='idle';seed.pauseUntilTick=100000;seed.home.controller.searchNextTick=100000;
      if(name==='dark')seed.scene.illumination=0;if(name==='unverified')seed.social.badge.kind='unverified_claim';
      const runtime=new BranchRuntime({worldId:'social-eye',branchId:name,mode:'EXPERIMENT',checkpoint:seed,directory:join(directory,'runs')});
      const automatic=new AutomaticCaptureCoordinator(manager,()=>true,undefined,()=>true);
      try {
        runtime.applyControl({type:'pause'});runtime.applyControl({type:'step'});
        let captureId:string;
        if(name==='unattended'){
          const request=manager.request(runtime,{reason:'diagnostic',width:512,height:512});captureId=request.captureId;const metadata=await manager.wait(runtime.target,captureId);assert.equal(metadata.status,'success');
          const proof=manager.socialObservation(runtime.target,captureId,runtime.simulation.state.tick);assert.ok(proof,'actual full readable cue exists before attention');
          assert.throws(()=>runtime.enqueueSocialObservation(proof.command,proof.proof),/current attended capture/);
        }else{
          runtime.enqueue({type:'turn_head',yawDelta:0,pitchDelta:0,sceneRevision:runtime.viewerState().scene!.revision});runtime.applyControl({type:'step'});
          runtime.applyControl({type:'resume'});automatic.pump([runtime]);runtime.applyControl({type:'pause'});
          const request=automatic.summary(runtime.target).inFlight;assert.ok(request);captureId=request.captureId;
          if(name==='stale_snapshot'){runtime.enqueueVisit({type:'visit_start',runId:runtime.target.runId,generation:2});runtime.applyControl({type:'step'});const current=runtime.simulation.checkpoint();if((current.schemaVersion!==11&&current.schemaVersion!==12))throw new Error('Social schema required');runtime.enqueueSocial({type:'social_badge',runId:runtime.target.runId,generation:2,sequence:1,actionId:current.visit.lastActionId+1,display:false});runtime.applyControl({type:'step'});}
          const metadata=await manager.wait(runtime.target,captureId);await immediate();assert.equal(metadata.status,'success');
          runtime.applyControl({type:'step'});automatic.pump([runtime]);runtime.applyControl({type:'step'});
        }
        const cp=runtime.simulation.checkpoint();if((cp.schemaVersion!==11&&cp.schemaVersion!==12))throw new Error('Social schema required');
        assert.equal(cp.social.firstRecognizedEncounter,null,name+' cannot establish verified creator identity');
        if(name==='unverified'){assert.equal(cp.social.experiences.length,1);assert.equal(cp.social.experiences[0].perceivedIdentity,'creator_claim');}
        else assert.deepEqual(cp.social.experiences,[],name+' cannot encode this encounter');
        if(name==='stale_snapshot'){assert.equal(cp.social.badge.display,false);const old=manager.socialObservation(runtime.target,captureId,cp.attention.lastCapture!.receivedTick);assert.ok(old?.command.badge,'copied captured RGB retains the prior readable badge even after the current badge hides');}
        await writeFile(join(directory,name+'.png'),manager.frame(runtime.target,captureId));reports.push({name,scope:runtime.target,metadata:manager.view(runtime.target).latest,experiences:cp.social.experiences,firstRecognizedEncounter:cp.social.firstRecognizedEncounter});
      }finally{automatic.close();await runtime.close();}
    }
    await writeFile(join(directory,'report.json'),JSON.stringify({method:'Actual GPU frames; labelled isolated pose/light/claim fixtures. Automatic capture feedback is produced by the normal coordinator. Unattended diagnostic frame never crosses the attended-proof gate.',paidCalls:0,cases:reports},null,2));
  }finally{await manager.close();}
});
