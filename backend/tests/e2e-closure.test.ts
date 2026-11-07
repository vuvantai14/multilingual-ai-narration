import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { spawn } from 'node:child_process';
import { composeE2eRun, preloadComposedServer, type ComposeDependencies, type WriterPolicy } from '../src/services/e2e-guard-composition.js';
import { assertE2eStartupReady } from '../src/services/e2e-runtime-boundary.js';
import { attestQuotaCommit, QuotaNativePolicy, type QuotaSession } from '../src/services/e2e-quota-transaction.js';
import { digest } from '../src/services/translation/group-plan.js';
import type { BootstrapPlan } from '../src/services/e2e-integration-bootstrap.js';
import type { ScopedGrant } from '../src/services/scoped-write-guard.js';
import { resolveMediaExecutable } from '../src/services/media-processing/media-executable.js';
import { E2eStorage } from '../src/services/e2e-storage.js';
import { runLeasedRender } from '../src/services/media-processing/ffmpeg-media-processor.js';

const scope={runId:'closure-run-001',projectId:'111111111111111111111111',ownerId:'222222222222222222222222'};
const transcript='333333333333333333333333',translation='444444444444444444444444',narration='555555555555555555555555',result='666666666666666666666666',voice='777777777777777777777777',job='888888888888888888888888';
const sourceRevision='a'.repeat(64),binding='b'.repeat(64),day=new Date().toISOString().slice(0,10);
const attempt=digest(['CUSTOMER_TRANSLATION_V1',scope.ownerId,scope.projectId,'en',sourceRevision]);
const mp4=Buffer.from([0,0,0,16,102,116,121,112,109,112,52,50,0,0,0,0]),mp3=Buffer.alloc(417);mp3.set([255,251,144,0]);
const g=(key:string,collection:string,doc:Record<string,unknown>):ScopedGrant=>({key,collection,method:'insertOne',recordId:String(doc._id),args:[doc,{}]});
function fixture(overrides:{invalidManifest?:boolean;commitError?:boolean;renderFail?:boolean;writers?:WriterPolicy[]}={}){
  mkdirSync('.tmp',{recursive:true});const root=mkdtempSync(resolve('.tmp','closure-')),storageRoot=resolve(root,'storage'),journal=resolve(root,`${scope.runId}.jsonl`);
  const dir=resolve(storageRoot,'runs',scope.runId,scope.projectId);mkdirSync(dir,{recursive:true});const sourcePath=resolve(dir,'input.mp4'),narrationPath=resolve(dir,'narration.mp3'),outputPath=resolve(dir,'result.mp4');
  // Tiny fixture source is NOT the approved real media and is never uploaded.
  writeFileSync(sourcePath,mp4);
  const docs=new Map<string,Record<string,unknown>>(),calls:string[]=[];let active=false,committed=false;
  const session:QuotaSession={serverSession:{txnNumber:1},inTransaction:()=>active,startTransaction:()=>{active=true;calls.push('TX_START');},withTransaction:async w=>w(),commitTransaction:async()=>{calls.push('TX_COMMIT');if(overrides.commitError)throw Error('UnknownTransactionCommitResult');active=false;committed=true;},abortTransaction:async()=>{active=false;calls.push('TX_ABORT');}};
  class Collection{
    dbName='multilingual_ai_narration';constructor(public collectionName:string){}
    async insertOne(doc:Record<string,unknown>){calls.push(this.collectionName+':insert');docs.set(String(doc._id),{...doc});return{acknowledged:true,insertedId:doc._id};}
    async updateOne(filter:Record<string,unknown>,update:Record<string,Record<string,unknown>>,..._options:unknown[]){void _options;calls.push(this.collectionName+':update');if(String(filter._id).startsWith('customer-')){const previous=docs.get(String(filter._id))??{count:0};const cap=(filter.count as {$lt:number}).$lt;if(Number(previous.count)>=cap)return{acknowledged:true,matchedCount:0,modifiedCount:0,upsertedCount:0};docs.set(String(filter._id),{...previous,count:Number(previous.count)+1,kind:'QUOTA'});return{acknowledged:true,matchedCount:1,modifiedCount:1,upsertedCount:0};}const doc=docs.get(String(filter._id));if(!doc)return{acknowledged:true,matchedCount:0,modifiedCount:0,upsertedCount:0};Object.assign(doc,update.$set);return{acknowledged:true,matchedCount:1,modifiedCount:1,upsertedCount:0};}
    async deleteMany(){calls.push('BAD_DELETE');return{};}
  }
  class Db{command(){calls.push('BAD_COMMAND');}}class MongoClient{}
  const grants=[
    g('create-project-001','projects',{_id:scope.projectId,userId:scope.ownerId,status:'DRAFT',sourceLanguageMode:'AUTO',sourceLanguage:null}),
    g('create-media-001','media',{_id:'999999999999999999999999',projectId:scope.projectId}),
    g('create-transcript-001','transcripts',{_id:transcript,projectId:scope.projectId,revision:1,languageCode:null}),
    g('create-job-001','processingjobs',{_id:job,projectId:scope.projectId,status:'PROCESSING'}),
    g('claim-attempt-001','translationattempts',{_id:attempt,ownerId:scope.ownerId,projectId:scope.projectId,targetLanguage:'en',sourceRevision,binding,state:'CLAIMED',executionVersion:1,phase:'METADATA_DISPATCHING'}),
    g('approve-translation-001','translations',{_id:translation,projectId:scope.projectId,transcriptId:transcript,targetLanguage:'en',revision:1,sourceTranscriptRevision:1}),
    g('create-narration-001','narrations',{_id:narration,projectId:scope.projectId,translationId:translation,voiceId:voice,revision:1,languageCode:'en',sourceTranslationRevision:1}),
    g('create-result-001','results',{_id:result,projectId:scope.projectId,narrationId:narration,sourceNarrationRevision:1}),
    {key:'complete-job-001',collection:'processingjobs',method:'updateOne',recordId:job,state:'PROCESSING',args:[{_id:job,projectId:scope.projectId,status:'PROCESSING'},{$set:{status:'COMPLETED'}},{}]} as ScopedGrant,
  ];
  const writers:WriterPolicy[]=[{name:'Project',grants:[grants[0]!.key],after:[]},{name:'Media',grants:[grants[1]!.key],after:['Project']},{name:'STT',grants:[grants[2]!.key,grants[3]!.key],after:['Media']},{name:'Translation',grants:[grants[4]!.key],after:['STT']},{name:'Quota',grants:[],after:['STT']},{name:'Approval',grants:[grants[5]!.key],after:['Translation','Quota']},{name:'TTS',grants:[grants[6]!.key],after:['Approval']},{name:'Result',grants:[grants[7]!.key],after:['TTS']},{name:'Worker',grants:[grants[8]!.key],after:['Result']}];
  const plan:BootstrapPlan={...scope,koreVoiceId:voice,mediaSha256:'8e37f21fce16be8bf735b7efe22296309582f6cc7529a4aa5aae0d46f86dd1d3',mediaBytes:4239951,mediaSeconds:53.591655,sourceMode:'AUTO',confirmedSource:'vi',target:'en',voice:'Kore',inferenceLimits:{STT:1,TRANSLATION:1,TTS:1},manifest:{...scope,database:'multilingual_ai_narration',freshProject:true,koreVoiceId:voice,grants}};
  const spawnFake=((_binary:string,args:string[],options:Record<string,unknown>)=>{
    assert.equal(args.at(-1),'pipe:3');assert.equal(args.includes('-y'),false);assert.equal(args.includes(outputPath),false);
    assert.equal(existsSync(outputPath),true);const fd=(options.stdio as unknown[])[3] as number;
    const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill:()=>{calls.push('KILL');return true;}});
    calls.push('SPAWN');queueMicrotask(()=>{if(!overrides.renderFail)writeFileSync(fd,mp4);child.emit('close',overrides.renderFail?1:0);});return child;
  }) as unknown as typeof spawn;
  const deps:ComposeDependencies={driver:{Collection,Db,MongoClient} as unknown as ComposeDependencies['driver'],reads:{database:async()=> 'multilingual_ai_narration',customer:async()=>true,activeKore:async()=>true,exists:async()=>false},workspace:process.cwd(),storageRoot,journal,
    storageGrants:[{key:'audio-file-001',kind:'audio',fileName:'narration.mp3',mime:'audio/mpeg',bytes:mp3.length,sha256:createHash('sha256').update(mp3).digest('hex')}],outputGrants:[{key:'render-file-001',fileName:'result.mp4',maxBytes:1000,timeoutMs:1000}],writers:overrides.writers??writers,
    quota:{...scope,targetLanguage:'en',sourceRevision,day,perUser:20,global:200,binding},claimed:async(id,s)=>{assert.equal(s,session);return docs.get(id)??null;},connect:async()=>{calls.push('CONNECT');await assert.rejects(new Collection('projects').insertOne({}));},
    render:{plan:{sourcePath,narrationPath,outputPath,duration:53.591655,key:'render-file-001'},validate:async(_path,data)=>data.equals(mp4),spawn:spawnFake},
  };
  const json=overrides.invalidManifest?'{}':JSON.stringify(plan);
  const invoke=(grant:ScopedGrant)=>{const c=new Collection(grant.collection);return(c[grant.method as 'insertOne'] as (...a:unknown[])=>Promise<unknown>).apply(c,grant.args as unknown[]);};
  return{deps,json,plan,grants,calls,session,docs,invoke,Collection,outputPath,committed:()=>committed};
}
async function throughTranslation(f:ReturnType<typeof fixture>,run:NonNullable<Awaited<ReturnType<typeof composeE2eRun>>>){
  await run.connectOnce();
  await run.writer('Project',scope,undefined,()=>f.invoke(f.grants[0]!));
  await run.writer('Media',scope,undefined,()=>f.invoke(f.grants[1]!));
  await run.writer('STT',scope,undefined,async()=>{await f.invoke(f.grants[2]!);await f.invoke(f.grants[3]!);});
  return run.writer('Translation',scope,undefined,async()=>{
    await f.invoke(f.grants[4]!);
    await run.binding.quota!(f.session,{...scope,targetLanguage:'en',sourceRevision,day},()=>attestQuotaCommit(run.binding,f.session,{...scope,targetLanguage:'en',sourceRevision,day},async()=>{
      const c=new f.Collection('translationattempts');
      for(const[id,cap]of[[`customer-day:${scope.ownerId}:${day}`,20],[`customer-global-day:${day}`,200]] as const)await c.updateOne({_id:id,count:{$lt:cap}},{$inc:{count:1},$setOnInsert:{kind:'QUOTA'}},{session:f.session,upsert:true} as never);
      await c.updateOne({_id:attempt,state:'CLAIMED',executionVersion:1,quotaReserved:{$ne:true}},{$set:{quotaReserved:true,quotaDay:day}},{session:f.session} as never);
    },async()=>f.committed()?f.docs.get(attempt)??null:null,{readConcern:{level:'snapshot'},writeConcern:{w:'majority',j:true}}));
  });
}
test('Bootstrap -> preload -> registered native writes/quota commit -> descriptor lease -> worker completion',async()=>{
  const f=fixture(),run=(await composeE2eRun(f.json,f.deps,true))!;assert.equal(f.calls.length,0);
  await throughTranslation(f,run);
  await run.writer('Approval',scope,undefined,()=>f.invoke(f.grants[5]!));
  await run.writer('TTS',scope,undefined,async()=>{run.storage.write('audio-file-001',mp3);await f.invoke(f.grants[6]!);});
  await run.writer('Result',scope,undefined,async()=>{
    const p=f.deps.render!.plan;await run.binding.render!(resolveMediaExecutable('ffmpeg'),['-nostdin','-y','-i',p.sourcePath,'-i',p.narrationPath,'-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','veryfast','-c:a','aac','-af','apad','-t',String(p.duration),'-movflags','+faststart',p.outputPath],'RENDER');
    await f.invoke(f.grants[7]!);
  });
  await run.worker(scope,()=>f.invoke(f.grants[8]!));assert.equal(run.resultReady(),true);assert.equal(f.docs.get(job)?.status,'COMPLETED');assert.equal(readFileSync(f.outputPath).equals(mp4),true);
  assert.equal(f.calls.filter(x=>x==='TX_COMMIT').length,1);assert.equal(f.calls.filter(x=>x==='SPAWN').length,1);
  assert.equal(f.docs.get(`customer-day:${scope.ownerId}:${day}`)?.count,1);assert.equal(f.docs.get(`customer-global-day:${day}`)?.count,1);
  await assert.rejects(run.writer('Result',scope,undefined,async()=>assert.fail()));
  const restart=fixture();restart.deps.journal=f.deps.journal;await assert.rejects(composeE2eRun(restart.json,restart.deps,true));
});
test('registered writer cannot report completion without its approved native operations',async()=>{
  const f=fixture(),run=(await composeE2eRun(f.json,f.deps,true))!;await run.connectOnce();await assert.rejects(run.writer('Project',scope,undefined,async()=>{}));await assert.rejects(run.writer('Media',scope,undefined,()=>f.invoke(f.grants[1]!)));
});
test('wrong owner/project, unregistered writer and direct native calls are rejected',async()=>{
  const f=fixture(),run=(await composeE2eRun(f.json,f.deps,true))!;await run.connectOnce();
  for(const s of [{...scope,ownerId:'aaaaaaaaaaaaaaaaaaaaaaaa'},{...scope,projectId:'bbbbbbbbbbbbbbbbbbbbbbbb'}])await assert.rejects(run.writer('Project',s,undefined,()=>f.invoke(f.grants[0]!)));
  await assert.rejects(run.writer('NotRegistered' as 'Project',scope,undefined,async()=>assert.fail()));
  await assert.rejects(new f.Collection('projects').insertOne(f.grants[0]!.args[0] as Record<string,unknown>));assert.deepEqual(f.calls,['CONNECT']);
});
test('unknown quota commit halts subsequent Approval/Result/Worker without retry',async()=>{
  const f=fixture({commitError:true}),run=(await composeE2eRun(f.json,f.deps,true))!;await assert.rejects(throughTranslation(f,run));
  await assert.rejects(run.writer('Approval',scope,undefined,()=>f.invoke(f.grants[5]!)));await assert.rejects(run.worker(scope,async()=>assert.fail()));assert.equal(f.calls.filter(x=>x==='TX_COMMIT').length,1);assert.equal(f.calls.includes('SPAWN'),false);
});
test('preload failure installs DENY before any connect or worker; OFF is inert',async()=>{
  const f=fixture({invalidManifest:true});await assert.rejects(composeE2eRun(f.json,f.deps,true));await assert.rejects(new f.Collection('projects').insertOne({}));assert.equal(f.calls.length,0);
  const off=fixture();assert.equal(await composeE2eRun(off.json,off.deps),undefined);await new off.Collection('projects').insertOne({_id:'fixture'});assert.equal(off.calls.length,1);
});
test('native quota cap is enforced without committing or continuing workflow',async()=>{
  const f=fixture(),run=(await composeE2eRun(f.json,f.deps,true))!;f.docs.set(`customer-global-day:${day}`,{kind:'QUOTA',count:200});
  await assert.rejects(throughTranslation(f,run));assert.equal(f.calls.includes('TX_COMMIT'),false);assert.equal(f.docs.get(`customer-global-day:${day}`)?.count,200);
  await assert.rejects(run.writer('Approval',scope,undefined,()=>f.invoke(f.grants[5]!)));
});
test('Result metadata cannot precede leased output verification',async()=>{
  const f=fixture(),run=(await composeE2eRun(f.json,f.deps,true))!;await throughTranslation(f,run);
  await run.writer('Approval',scope,undefined,()=>f.invoke(f.grants[5]!));await run.writer('TTS',scope,undefined,()=>f.invoke(f.grants[6]!));
  await assert.rejects(run.writer('Result',scope,undefined,()=>f.invoke(f.grants[7]!)));assert.equal(f.docs.has(result),false);await assert.rejects(run.worker(scope,()=>f.invoke(f.grants[8]!)));
});
test('FFmpeg without a lease or outside namespace never invokes spawn',async()=>{
  const f=fixture();const storage=new E2eStorage(process.cwd(),f.deps.storageRoot,scope.runId,scope.projectId,[],()=>{},true);let spawns=0;
  const p=f.deps.render!.plan,args=['-nostdin','-y','-i',p.sourcePath,'-i',p.narrationPath,'-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','veryfast','-c:a','aac','-af','apad','-t',String(p.duration),'-movflags','+faststart',p.outputPath];
  await assert.rejects(runLeasedRender(resolveMediaExecutable('ffmpeg'),args,'RENDER',p,storage,async()=>true,(()=>{spawns++;throw Error();}) as typeof spawn));assert.equal(spawns,0);
});
test('output failure/timeout revoke lease, abort encoder and do not overwrite old artifact',async()=>{
  const f=fixture();let aborted=false;const events:string[]=[];const storage=new E2eStorage(process.cwd(),f.deps.storageRoot,scope.runId,scope.projectId,[],e=>events.push(e),true,[{key:'timeout-lease-001',fileName:'timeout.mp4',maxBytes:100,timeoutMs:10}]);
  await assert.rejects(storage.output('timeout-lease-001',async(_fd,signal)=>{signal.addEventListener('abort',()=>{aborted=true;});return new Promise(()=>{});},async()=>true));assert.equal(aborted,true);assert.ok(events.includes('OUTPUT_REVOKED_timeout-lease-001'));await assert.rejects(storage.output('timeout-lease-001',async()=>{},async()=>true));
  const oldPath=resolve(storage.directory,'existing.mp4');writeFileSync(oldPath,'old');const other=new E2eStorage(process.cwd(),f.deps.storageRoot,scope.runId,scope.projectId,[],()=>{},true,[{key:'existing-lease-001',fileName:'existing.mp4',maxBytes:100,timeoutMs:10}]);let calls=0;await assert.rejects(other.output('existing-lease-001',async()=>{calls++;},async()=>true));assert.equal(calls,0);assert.equal(readFileSync(oldPath,'utf8'),'old');
});
test('quota native policy denies forged/foreign/double-charge receipt and changed transaction',async()=>{
  for(const mode of ['foreign-id','wrong-cap','increment-two','wrong-session','missing-claim','changed-txn','wrong-binding']){
    const f=fixture();const native=new QuotaNativePolicy(f.deps.quota,async(id)=>id!==attempt||mode==='missing-claim'?null:{_id:attempt,...scope,targetLanguage:'en',sourceRevision,binding:mode==='wrong-binding'?'c'.repeat(64):binding,state:'CLAIMED',executionVersion:1,phase:'METADATA_DISPATCHING'},()=>{});
    let delegated=0;
    await assert.rejects(native.run(f.session,{...scope,targetLanguage:'en',sourceRevision,day},async()=>{
      f.session.startTransaction({readConcern:{level:'snapshot'},writeConcern:{w:'majority',j:true}});
      const args=[{_id:mode==='foreign-id'?`customer-day:other:${day}`:`customer-day:${scope.ownerId}:${day}`,count:{$lt:mode==='wrong-cap'?999:20}},{$inc:{count:mode==='increment-two'?2:1},$setOnInsert:{kind:'QUOTA'}},{upsert:true,session:mode==='wrong-session'?{}:f.session}];
      if(mode==='changed-txn'){
        await native.write('multilingual_ai_narration','translationattempts','updateOne',args,async()=>({acknowledged:true,modifiedCount:1,upsertedCount:0}));f.session.serverSession!.txnNumber=2;
        args[0]={_id:`customer-global-day:${day}`,count:{$lt:200}};
      }
      await native.write('multilingual_ai_narration','translationattempts','updateOne',args,async()=>{delegated++;return{acknowledged:true,modifiedCount:1,upsertedCount:0};});
    }));assert.equal(delegated,0);
  }
});
test('explicit preload attests guard/storage/registry before connect and server load; invalid preload never loads server',async()=>{
  const invalid=fixture({invalidManifest:true});let loads=0;await assert.rejects(preloadComposedServer(invalid.json,invalid.deps,async()=>{loads++;},true));assert.equal(loads,0);assert.equal(invalid.calls.length,0);
  const f=fixture(),order:string[]=[];const original=f.deps.connect;
  f.deps.connect=async()=>{assertE2eStartupReady();order.push('attested-connect');await original();};
  process.env.S32_E2E_TEST_RUN_ENABLED='true';
  try{
    const run=await preloadComposedServer(f.json,f.deps,async()=>{assertE2eStartupReady();order.push('server-loaded');loads++;},true);
    assert.deepEqual(order,['attested-connect','server-loaded']);assert.equal(loads,1);await assert.rejects(run!.worker(scope,async()=>assert.fail()));
  }finally{delete process.env.S32_E2E_TEST_RUN_ENABLED;}
});
