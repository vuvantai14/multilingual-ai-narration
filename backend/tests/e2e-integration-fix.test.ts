import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import type { StorageEngine } from 'multer';
import { attestQuotaCommit, runQuotaTransaction, type QuotaSession } from '../src/services/e2e-quota-transaction.js';
import { registerPreparedE2eBoundary, type E2eRuntimeBinding } from '../src/services/e2e-runtime-boundary.js';
import { E2eMulterStorage } from '../src/middleware/e2e-multer-storage.js';
import { E2eStorage } from '../src/services/e2e-storage.js';

Object.assign(process.env,{NODE_ENV:'test',MONGODB_URI:'mongodb://127.0.0.1:1/mock_only',JWT_ACCESS_SECRET:randomBytes(32).toString('hex'),JWT_REFRESH_SECRET:randomBytes(32).toString('hex'),JWT_ACCESS_EXPIRES_IN:'15m',JWT_REFRESH_EXPIRES_IN:'1d'});
const identity={projectId:'111111111111111111111111',ownerId:'222222222222222222222222',targetLanguage:'en',sourceRevision:'a'.repeat(64),day:new Date().toISOString().slice(0,10)};
const options={readConcern:{level:'snapshot' as const},writeConcern:{w:'majority' as const,j:true as const}};
function quotaFixture() {
  let active=false;const calls:string[]=[];
  const runtime:E2eRuntimeBinding={...identity,runId:'quota-run-001',writer:async(_scope,work)=>work(),record:event=>{calls.push(event);}};
  const session:QuotaSession={withTransaction:async work=>{calls.push('ordinary');await work();},startTransaction:()=>{active=true;calls.push('start');},commitTransaction:async()=>{calls.push('commit');active=false;},abortTransaction:async()=>{calls.push('abort');active=false;},inTransaction:()=>active};
  const receipt=async()=>{calls.push('majority-read');return{...identity,quotaReserved:true,quotaDay:identity.day};};
  return{runtime,session,calls,receipt};
}
test('quota OFF retains actual withTransaction path without new attestation/read',async()=>{
  delete process.env.S32_E2E_TEST_RUN_ENABLED;const f=quotaFixture();
  await runQuotaTransaction(f.session,identity,async()=>{f.calls.push('body');},f.receipt,options);assert.deepEqual(f.calls,['ordinary','body']);
});
test('quota attests only after one logical commit and majority receipt read',async()=>{
  const f=quotaFixture();await attestQuotaCommit(f.runtime,f.session,identity,async()=>{f.calls.push('actual-body');},f.receipt,options);
  assert.deepEqual(f.calls,['QUOTA_BEGIN','start','actual-body','QUOTA_COMMIT_REQUESTED','commit','majority-read','QUOTA_COMMITTED_ATTESTED']);
  await assert.rejects(attestQuotaCommit(f.runtime,f.session,identity,async()=>assert.fail(),f.receipt,options));
});
test('unknown commit, open transaction and mismatched receipt never attest or retry',async()=>{
  for(const scenario of ['commit-error','still-active','wrong-owner','missing-receipt','read-error']){
    const f=quotaFixture();let commits=0;const original=f.session.commitTransaction;
    f.session.commitTransaction=async()=>{commits++;if(scenario==='commit-error')throw Error('UnknownTransactionCommitResult');if(scenario!=='still-active')await original();};
    const read=async()=>{if(scenario==='read-error')throw Error('read unavailable');if(scenario==='missing-receipt')return null;return{...identity,ownerId:scenario==='wrong-owner'?'other':identity.ownerId,quotaReserved:true,quotaDay:identity.day};};
    await assert.rejects(attestQuotaCommit(f.runtime,f.session,identity,async()=>{},read,options));assert.equal(commits,1);assert.equal(f.calls.includes('QUOTA_COMMITTED_ATTESTED'),false);
    await assert.rejects(attestQuotaCommit(f.runtime,f.session,identity,async()=>assert.fail(),read,options));assert.equal(commits,1);
  }
});
test('quota cross-project/day/target rejects before body; concurrent reservation denied',async()=>{
  for(const value of [{...identity,projectId:'333333333333333333333333'},{...identity,day:'2000-01-01'},{...identity,targetLanguage:'ja'}]){const f=quotaFixture();await assert.rejects(attestQuotaCommit(f.runtime,f.session,value,async()=>assert.fail(),f.receipt,options));assert.equal(f.calls.length,0);}
  const f=quotaFixture();let release!:()=>void;const first=attestQuotaCommit(f.runtime,f.session,identity,()=>new Promise<void>(r=>{release=r;}),f.receipt,options);
  await assert.rejects(attestQuotaCommit(f.runtime,f.session,identity,async()=>assert.fail(),f.receipt,options));release();await first;
});
test('actual database connect path fails before mongoose.connect in test-run',async()=>{
  const {connectDatabase}=await import('../src/config/database.js');process.env.S32_E2E_TEST_RUN_ENABLED='true';
  try{await assert.rejects(connectDatabase('synthetic-not-a-uri'),/S32_E2E_PRELOAD_COMPOSITION_BLOCKED/);}finally{delete process.env.S32_E2E_TEST_RUN_ENABLED;}
});
test('actual service entries reject missing runtime before model/provider writes',async()=>{
  const [{transcribe},{upload},{generate},{process:render},{confirmSourceLanguage},{create}]=await Promise.all([import('../src/services/transcription.service.js'),import('../src/services/media.service.js'),import('../src/services/narration.service.js'),import('../src/services/result.service.js'),import('../src/services/source-language.service.js'),import('../src/services/project.service.js')]);
  process.env.S32_E2E_TEST_RUN_ENABLED='true';
  try{for(const work of [()=>transcribe(identity.projectId,identity.ownerId),()=>upload(identity.projectId,identity.ownerId,{} as Express.Multer.File),()=>generate(identity.projectId,identity.ownerId,'en'),()=>render(identity.projectId,identity.ownerId,'id'),()=>confirmSourceLanguage(identity.projectId,identity.ownerId,'vi',1),()=>create(identity.ownerId,{name:'fixture',sourceLanguageMode:'AUTO'})])await assert.rejects(work(),/S32_E2E_RUNTIME_NOT_PREPARED/);}finally{delete process.env.S32_E2E_TEST_RUN_ENABLED;}
});
test('actual Multer storage adapter delegates OFF and guards scoped fixture upload ON',async()=>{
  mkdirSync('.tmp',{recursive:true});const root=mkdtempSync(resolve('.tmp','multer-guard-')),data=Buffer.from([0,0,0,16,102,116,121,112,109,112,52,50,0,0,0,0]);
  const store=new E2eStorage(process.cwd(),root,'multer-run-001',identity.projectId,[{key:'fixture-input-001',fileName:'input.mp4',kind:'input',mime:'video/mp4',bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')}],()=>{},true);
  registerPreparedE2eBoundary({...identity,runId:'multer-run-001',writer:async(_s,w)=>w(),record:()=>{},input:{storage:store,key:'fixture-input-001',maxBytes:data.length}});
  let ordinaryCalls=0;const ordinary:StorageEngine={_handleFile:(_r,_f,done)=>{ordinaryCalls++;done(null,{size:0});},_removeFile:(_r,_f,done)=>done(null)};const engine=new E2eMulterStorage(ordinary);
  const request={ownedProjectId:identity.projectId,user:{id:identity.ownerId}} as Parameters<StorageEngine['_handleFile']>[0];
  const invoke=(owner=identity.ownerId)=>new Promise<Partial<Express.Multer.File>>((resolve,reject)=>engine._handleFile({...request,user:{id:owner}} as typeof request,{mimetype:'video/mp4',stream:Readable.from([data])} as Express.Multer.File,(error,info)=>error?reject(error):resolve(info!)));
  await invoke();assert.equal(ordinaryCalls,1);process.env.S32_E2E_TEST_RUN_ENABLED='true';
  try{await assert.rejects(invoke('333333333333333333333333'));const uploaded=await invoke();assert.equal(readFileSync(uploaded.path!).equals(data),true);await assert.rejects(invoke());assert.equal(ordinaryCalls,1);}finally{delete process.env.S32_E2E_TEST_RUN_ENABLED;}
});
test('actual FFmpeg path and raw file cleanup fail before side effects when ON',async()=>{
  const [{runMediaCommand},{convertWavToMp3},{safeDeleteStoredFile,ensureUploadDirectory}]=await Promise.all([import('../src/services/media-processing/ffmpeg-media-processor.js'),import('../src/services/tts/gemini-tts.provider.js'),import('../src/utils/file.js')]);
  process.env.S32_E2E_TEST_RUN_ENABLED='true';
  try{await assert.rejects(runMediaCommand('ffmpeg',['-y','old.mp4'],'RENDER'),/S32_E2E_STORAGE_PATH_NOT_GRANTED/);await assert.rejects(convertWavToMp3(Buffer.from('fixture'),new AbortController().signal),/S32_E2E_STORAGE_PATH_NOT_GRANTED/);await assert.rejects(safeDeleteStoredFile('old.mp4'));await assert.rejects(ensureUploadDirectory(identity.projectId));}finally{delete process.env.S32_E2E_TEST_RUN_ENABLED;}
});
