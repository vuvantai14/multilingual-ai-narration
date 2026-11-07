import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import mongoose from 'mongoose';
import {memoryNative} from './helpers/e2e-memory-native.js';

Object.assign(process.env,{NODE_ENV:'test',MONGODB_URI:'mongodb://127.0.0.1:1/mock_never_connect',JWT_ACCESS_SECRET:'mock-access-unique',JWT_REFRESH_SECRET:'mock-refresh-unique',JWT_ACCESS_EXPIRES_IN:'15m',JWT_REFRESH_EXPIRES_IN:'1d',UPLOAD_DIR:'.tmp-stt-service'});
delete process.env.S32_E2E_TEST_RUN_ENABLED;
mongoose.set('autoCreate',false);mongoose.set('autoIndex',false);mongoose.set('bufferCommands',false);
const {transcribe}=await import('../src/services/transcription.service.js');
const {setSttProviderForTests}=await import('../src/services/stt/stt.service.js');
const {GeminiSttError}=await import('../src/services/stt/gemini-stt.provider.js');
const {SttTrace}=await import('../src/services/stt/stt-evidence.js');
const {ProcessingJob}=await import('../src/models/ProcessingJob.js');
const {uploadRoot}=await import('../src/utils/file.js');

for(const scenario of ['PRE_DISPATCH','POST_DISPATCH','FAILED_RESPONSE','LEGACY_UNKNOWN'] as const){
 test(`actual STT service records safe ${scenario} evidence without permitting ambiguous retry`,async(t)=>{
  t.mock.method(globalThis,'fetch',async()=>{throw Error('NETWORK_FORBIDDEN');});t.mock.method(mongoose,'connect',async()=>{throw Error('DATABASE_FORBIDDEN');});
  t.mock.method(console,'info',()=>{});t.mock.method(console,'error',()=>{});
  const db=memoryNative(),id=new mongoose.mongo.ObjectId(),owner=new mongoose.mongo.ObjectId();
  mongoose.connection.readyState=1;mongoose.connection.db={collection:(name:string)=>db.collection(name)} as unknown as NonNullable<typeof mongoose.connection.db>;
  for(const collection of Object.values(mongoose.connection.collections)){
    (collection as unknown as {collection:unknown}).collection=db.collection(collection.name);
  }
  await mkdir(uploadRoot,{recursive:true});const dir=await mkdtemp(resolve(uploadRoot,'fixture-')),file=resolve(dir,'source.mp3');await writeFile(file,Buffer.from([1,2]));
  db.seed('projects',{_id:id,userId:owner,name:'Fixture',sourceLanguageMode:'AUTO',sourceLanguage:null,sourceLanguageStatus:'PENDING_DETECTION',status:scenario==='LEGACY_UNKNOWN'?'FAILED':'UPLOADED',progress:0});
  db.seed('media',{_id:new mongoose.mongo.ObjectId(),projectId:id,storagePath:relative(uploadRoot,file),mimeType:'audio/mpeg',mediaType:'AUDIO'});
  if(scenario==='LEGACY_UNKNOWN')db.seed('processingjobs',{_id:new mongoose.mongo.ObjectId(),projectId:id,type:'TRANSCRIPTION',status:'FAILED',errorMessage:'STT_PROVIDER_ERROR'});
  let calls=0;setSttProviderForTests({async transcribe(input){calls++;const trace=new SttTrace();trace.enter('MODEL_VALIDATION');if(scenario!=='PRE_DISPATCH')trace.dispatch();if(scenario==='FAILED_RESPONSE'){trace.response({status:'completed',id:'interaction_service'});trace.enter('RESPONSE_VALIDATION');}trace.fail({status:503,error:{status:'UNAVAILABLE'}});input.onEvidence?.(trace.snapshot());throw new GeminiSttError('STT_PROVIDER_ERROR',503,undefined,trace.snapshot());}});
  try{
   await assert.rejects(transcribe(String(id),String(owner)),(e:unknown)=>{assert.ok(e instanceof Error);assert.equal((e as {code?:string}).code,scenario==='LEGACY_UNKNOWN'?'STT_ATTEMPT_UNCERTAIN':['PRE_DISPATCH','FAILED_RESPONSE'].includes(scenario)?'STT_PROVIDER_ERROR':'STT_EXECUTION_UNCERTAIN');return true;});
   const jobs=db.documents('processingjobs');assert.equal(jobs.length,1);assert.equal(jobs[0]!.status,'FAILED');assert.equal(db.documents('projects')[0]!.status,'FAILED');
   if(scenario==='LEGACY_UNKNOWN'){assert.equal(calls,0);assert.equal(jobs[0]!.sttEvidence,undefined);}
   else{const evidence=jobs[0]!.sttEvidence as {outcome:string;retryAllowed:boolean};assert.equal(evidence.outcome,scenario==='PRE_DISPATCH'?'FAILED_PRE_DISPATCH':scenario==='FAILED_RESPONSE'?'FAILED_RESPONSE':'UNCERTAIN');assert.equal(evidence.retryAllowed,false);assert.equal(calls,1);}
   if(scenario!=='PRE_DISPATCH'){await assert.rejects(transcribe(String(id),String(owner)),(e:unknown)=>(e as {code?:string}).code==='STT_ATTEMPT_UNCERTAIN');assert.equal(db.documents('processingjobs').length,1);assert.equal(calls,scenario==='LEGACY_UNKNOWN'?0:1);}
   assert.equal(ProcessingJob.schema.path('sttEvidence').options.select,false);
  }finally{setSttProviderForTests();await rm(dir,{recursive:true,force:true});}
 });
}
