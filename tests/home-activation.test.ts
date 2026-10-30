import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HomeSimulation,PhysiologySimulation,validateCheckpoint,hashCheckpoint,type CheckpointV8} from '../server/simulation.js';
import {BranchRuntime,validateRuntimeCheckpoint,replayRuntime,type RuntimeOperation} from '../server/branch-runtime.js';
import {replay} from '../server/replay.js';
import {eyePose} from '../shared/eye-pose.js';

function asleepHome():CheckpointV8 {
 const genesis=new HomeSimulation({mode:'EXPERIMENT',seed:13}).checkpoint();genesis.body.sleepPressure=.8;
 const sim=new HomeSimulation({checkpoint:genesis,mode:'EXPERIMENT'});
 sim.applyAction({type:'activity-start',totalTicks:1000});
 sim.enqueue({type:'physiology_fixture',effect:{sequence:1,type:'sleep'}});sim.step();
 const cp=sim.checkpoint();assert.equal(cp.body.mode,'asleep');validateCheckpoint(cp);return cp;
}

test('asleep home disable, save and explicit reactivation preserve body and reopen capture exclusion immediately',async()=>{
 const asleep=asleepHome(),off=new HomeSimulation({checkpoint:asleep,mode:'EXPERIMENT',physiology:{active:false}});
 const disabledAtRestore=off.checkpoint();
 for(let i=0;i<3;i++)off.step();
 const saved=off.checkpoint(),original=structuredClone(saved);validateCheckpoint(saved);
 const on=new HomeSimulation({checkpoint:saved,mode:'EXPERIMENT',physiology:{active:true}}),enabled=on.checkpoint();
 validateCheckpoint(enabled);assert.deepEqual(saved,original);
 assert.equal(disabledAtRestore.physiology.unconsciousWindows.at(-1)?.endTick,asleep.tick);
 assert.deepEqual(enabled.body,{...saved.body,active:true});
 assert.deepEqual(enabled.physiology.unconsciousWindows,[...saved.physiology.unconsciousWindows,{startTick:saved.tick,endTick:null}]);
 assert.equal(enabled.home.activationPolicy,'home-default');
 for(const key of ['character','head','activity','cognition','internalExperiences','interoception'] as const)assert.deepEqual(enabled[key],saved[key]);
 assert.equal(on.state.capability?.canAct,false);assert.equal(on.state.capability?.canAttend,false);
 const unchanged=new HomeSimulation({checkpoint:enabled,mode:'EXPERIMENT'});assert.equal(hashCheckpoint(unchanged.checkpoint()),hashCheckpoint(enabled));
 for(let i=0;i<5;i++){on.step();validateCheckpoint(on.checkpoint());}
 assert.equal(on.state.character.x,enabled.character.x);assert.equal(on.state.character.z,enabled.character.z);assert.equal(on.checkpoint().activity.cursor,enabled.activity.cursor);
 assert.equal(replay(enabled,[],on.state.tick).stateHash,hashCheckpoint(on.checkpoint()));
 const runtime=new BranchRuntime({worldId:'activation-world',branchId:'fixture',mode:'EXPERIMENT',checkpoint:enabled,offline:true});
 runtime.applyControl({type:'pause'});const start=validateRuntimeCheckpoint(runtime.checkpoint());
 const operation:RuntimeOperation={sequence:start.control.nextOperationSequence,tick:start.simulation.tick,kind:'control',action:{type:'step'}};
 runtime.replayOperation(operation);const end=validateRuntimeCheckpoint(runtime.checkpoint());
 assert.equal(replayRuntime(start,[operation],end).runtimeHash.length,64);await runtime.close();
 // The restart tick itself is excluded, before a motor step can create evidence.
 const capture=new HomeSimulation({checkpoint:enabled,mode:'EXPERIMENT'}),cp=capture.checkpoint(),eye=eyePose(capture.state);
 cp.attention.pending={id:cp.attention.nextIntentId++,createdTick:cp.tick,expiresTick:cp.tick+300,reasons:['uncertainty_probe'],triggers:[{reason:'uncertainty_probe',tick:cp.tick,parentSequence:null}],parentSequence:null,status:'pending',captureId:null,requestedTick:null};
 const guarded=new HomeSimulation({checkpoint:cp,mode:'EXPERIMENT'});
 guarded.enqueue({type:'sensor_feedback',intentId:cp.attention.pending.id,stage:'admitted',captureId:'restart-asleep',capturedTick:cp.tick,sceneRevision:cp.scene.revision,pose:{x:eye.position[0],y:eye.position[1],z:eye.position[2],bodyHeading:eye.bodyHeading,headYaw:eye.headYaw,headPitch:eye.headPitch},outcome:'success',signature:null,frameHash:null});
 assert.ok(guarded.step().some(e=>e.type==='CAPTURE_FEEDBACK'&&e.data.reason==='unconscious_capture'));
 validateCheckpoint(guarded.checkpoint());
});

test('parent and home configuration reject a full interval history before mutating the supplied checkpoint',()=>{
 const saved=asleepHome();saved.body.active=false;saved.home.activationPolicy='owner-disabled';
 saved.physiology.unconsciousWindows=Array.from({length:128},()=>({startTick:saved.tick,endTick:saved.tick}));validateCheckpoint(saved);
 const original=structuredClone(saved);
 assert.throws(()=>new HomeSimulation({checkpoint:saved,mode:'EXPERIMENT',physiology:{active:true}}),/Unconscious interval evidence capacity exceeded/);
 assert.deepEqual(saved,original);assert.equal(new HomeSimulation({checkpoint:saved,mode:'EXPERIMENT'}).bodyState().active,false);
 const {home:_,...base}=saved;void _;
 const cp7={...base,schemaVersion:7 as const,rulesVersion:'lumi-physiology-v2' as const};validateCheckpoint(cp7);
 assert.throws(()=>new PhysiologySimulation({checkpoint:cp7,mode:'EXPERIMENT',physiology:{active:true}}),/Unconscious interval evidence capacity exceeded/);
 assert.deepEqual(saved,original);
});
