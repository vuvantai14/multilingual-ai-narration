import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { ScopedWriteGuard, installScopedWriteGuard, type ScopedGrant, type WriteManifest } from '../src/services/scoped-write-guard.js';
import { verifyIntegrationBootstrap, prepareReadOnlyIntegration, type BootstrapPlan } from '../src/services/e2e-integration-bootstrap.js';
import { E2eStorage, type StorageGrant } from '../src/services/e2e-storage.js';

const scope={runId:'integration-run-001',projectId:'111111111111111111111111',ownerId:'222222222222222222222222'};
const transcript='333333333333333333333333',media='444444444444444444444444',voice='555555555555555555555555';
const session={inTransaction:()=>true,serverSession:{txnNumber:1}};
const project={_id:scope.projectId,userId:scope.ownerId,status:'DRAFT',sourceLanguageMode:'AUTO',sourceLanguage:null};
const projectGrant:ScopedGrant={key:'project-create-001',collection:'projects',method:'insertOne',recordId:scope.projectId,args:[project,{}]};
const parent:ScopedGrant={key:'transcript-new-001',collection:'transcripts',method:'insertOne',recordId:transcript,transaction:true,args:[{_id:transcript,projectId:scope.projectId,revision:1,languageCode:null},{session}]};
const segments=[{_id:'666666666666666666666666',transcriptId:transcript,sequence:1,text:'Museum fixture',startTime:0,endTime:1}];
const batch:ScopedGrant={key:'segments-new-001',collection:'transcriptsegments',method:'insertMany',recordId:transcript,transaction:true,args:[segments,{session,ordered:true}]};
const empty:ScopedGrant={key:'segments-empty-001',collection:'transcriptsegments',method:'deleteMany',recordId:transcript,transaction:true,args:[{transcriptId:transcript},{session}]};
const manifest=(grants:ScopedGrant[]):WriteManifest=>({...scope,database:'multilingual_ai_narration',freshProject:true,koreVoiceId:voice,grants});
function fixture(grants:ScopedGrant[],count=0) {
  const calls:string[]=[];
  class Collection {
    dbName='multilingual_ai_narration';constructor(public collectionName:string){}
    async insertOne(d:{_id:string}){calls.push('insertOne');return{acknowledged:true,insertedId:d._id};}
    async insertMany(rows:typeof segments){calls.push('insertMany');return{acknowledged:true,insertedCount:rows.length,insertedIds:Object.fromEntries(rows.map((r,i)=>[i,r._id]))};}
    async deleteMany(){calls.push('UNSAFE_DELETE');return{acknowledged:true,deletedCount:999};}
    async updateOne(){calls.push('updateOne');return{acknowledged:true,matchedCount:1};}
    async findOneAndUpdate(filter:{_id:string}){calls.push('upsert');return{_id:filter._id};}
  }
  class Db{command(){throw Error('native command');}}class MongoClient{}
  const guard=new ScopedWriteGuard(manifest(grants),()=>{},true,async(id,s)=>{assert.equal(id,transcript);assert.equal(s,session);return count;});
  const driver={Collection,Db,MongoClient};installScopedWriteGuard(driver as unknown as Parameters<typeof installScopedWriteGuard>[0],guard);
  const invoke=(g:ScopedGrant)=>{const c=new Collection(g.collection);return (c[g.method] as (...args:unknown[])=>Promise<unknown>).apply(c,g.args as unknown[]);};
  return{guard,calls,driver,invoke};
}
test('STT batch checks every row; exact fresh transcript delete is read-verified no-op',async()=>{
  const f=fixture([parent,empty,batch]);await f.guard.run(scope,session,async()=>{await f.invoke(parent);const result=await f.invoke(empty);assert.deepEqual(result,{acknowledged:true,deletedCount:0});await f.invoke(batch);});
  assert.deepEqual(f.calls,['insertOne','insertMany']);
});
test('mixed transcript/sequence/duplicate ID batch and unscoped deletion cannot be planned',()=>{
  for(const rows of [[...segments,{...segments[0],_id:'777777777777777777777777',transcriptId:media,sequence:2}],[...segments,...segments],[{...segments[0],sequence:2}]])assert.throws(()=>fixture([parent,{...batch,args:[rows,{session}]}]));
  assert.throws(()=>fixture([parent,{...empty,args:[{}, {session}]}]));
});
test('existing segments, missing parent acknowledgment and changed transaction epoch are denied',async()=>{
  const f=fixture([parent,empty,batch],1);await assert.rejects(f.guard.run(scope,session,()=>f.invoke(batch)));
  await assert.rejects(f.guard.run(scope,session,async()=>{await f.invoke(parent);await f.invoke(empty);}));assert.deepEqual(f.calls,['insertOne']);
  const another=fixture([parent,batch]);await another.guard.run(scope,session,async()=>{await another.invoke(parent);session.serverSession.txnNumber++;try{await assert.rejects(another.invoke(batch));}finally{session.serverSession.txnNumber--;}});
});
test('media upsert requires preallocated ID, project acknowledgment and exact payload',async()=>{
  const mediaGrant:ScopedGrant={key:'media-upsert-001',collection:'media',method:'findOneAndUpdate',recordId:media,args:[{_id:media,projectId:scope.projectId},{$set:{fileName:'input.mp4'},$setOnInsert:{_id:media}},{upsert:true,returnDocument:'after'}]};
  const f=fixture([projectGrant,mediaGrant]);await assert.rejects(f.guard.run(scope,undefined,()=>f.invoke(mediaGrant)));
  await f.guard.run(scope,undefined,async()=>{await f.invoke(projectGrant);await f.invoke(mediaGrant);});assert.deepEqual(f.calls,['insertOne','upsert']);
  assert.throws(()=>fixture([projectGrant,{...mediaGrant,args:[{projectId:scope.projectId},mediaGrant.args[1],mediaGrant.args[2]]}]));
});
test('shared quota/foreign receipt/upsert remain denied, never fake a reservation',async()=>{
  const receipt:ScopedGrant={key:'quota-receipt-001',collection:'translationattempts',method:'updateOne',recordId:'customer-global-day:2026-11-06',transaction:true,args:[{_id:'customer-global-day:2026-11-06',count:{$lt:200}},{$inc:{count:1},$setOnInsert:{kind:'QUOTA'}},{upsert:true,session}]};
  assert.throws(()=>fixture([receipt]));const f=fixture([projectGrant]);await assert.rejects(f.guard.run(scope,session,()=>f.invoke(receipt)));assert.equal(f.calls.length,0);
});
const plan=():BootstrapPlan=>({...scope,koreVoiceId:voice,mediaSha256:'8e37f21fce16be8bf735b7efe22296309582f6cc7529a4aa5aae0d46f86dd1d3',mediaBytes:4239951,mediaSeconds:53.591655,sourceMode:'AUTO',confirmedSource:'vi',target:'en',voice:'Kore',inferenceLimits:{STT:1,TRANSLATION:1,TTS:1},manifest:manifest([projectGrant])});
const reads={database:async()=> 'multilingual_ai_narration',customer:async()=>true,exists:async()=>false,activeKore:async()=>true};
test('bootstrap defaults OFF; verifies immutable owner/new-project/media/voice and refuses old data',async()=>{
  await assert.rejects(verifyIntegrationBootstrap(plan(),reads));
  await assert.rejects(verifyIntegrationBootstrap(plan(),{...reads,exists:async()=>true},true));
  await assert.rejects(verifyIntegrationBootstrap({...plan(),target:'ja' as 'en'},reads,true));
  const p=plan(),pending=verifyIntegrationBootstrap(p,reads,true);p.ownerId='aaaaaaaaaaaaaaaaaaaaaaaa';const proof=await pending;assert.equal(proof.ownerId,scope.ownerId);assert.equal(Object.isFrozen(proof),true);
});
test('preload preparation denies before connect and refuses workers/activation/reconnect',async()=>{
  const proof=await verifyIntegrationBootstrap(plan(),reads,true),f=fixture([projectGrant]);let connects=0;
  const runtime=prepareReadOnlyIntegration(f.driver as unknown as Parameters<typeof prepareReadOnlyIntegration>[0],proof,async()=>{connects++;await assert.rejects(f.invoke(projectGrant));});
  await runtime.connectOnce();assert.equal(connects,1);await assert.rejects(runtime.connectOnce());assert.throws(()=>runtime.startWorker());assert.throws(()=>runtime.activateWrites());assert.equal(f.calls.length,0);
  const bad=fixture([projectGrant]);assert.throws(()=>prepareReadOnlyIntegration(bad.driver as unknown as Parameters<typeof prepareReadOnlyIntegration>[0],undefined,async()=>assert.fail()));await assert.rejects(bad.invoke(projectGrant));
});
function storageFixture() {
  mkdirSync('.tmp',{recursive:true});const root=mkdtempSync(resolve('.tmp','storage-integration-')),data=Buffer.from([0,0,0,16,102,116,121,112,109,112,52,50,0,0,0,0]);
  const grant:StorageGrant={key:'storage-input-001',fileName:'input.mp4',kind:'input',mime:'video/mp4',bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};return{root,data,grant};
}
test('storage OFF, traversal/ADS/invalid MIME/oversize and duplicates denied',()=>{
  const{root,data,grant}=storageFixture();const make=(g=grant,on=true)=>new E2eStorage(process.cwd(),root,scope.runId,scope.projectId,[g],()=>{},on);
  assert.throws(()=>make(grant,false).write(grant.key,data));
  for(const fileName of ['../outside.mp4','C:\\outside.mp4','input.mp4:stream','CON.mp4'])assert.throws(()=>make({...grant,fileName}));
  assert.throws(()=>make({...grant,mime:'audio/mpeg'}));assert.throws(()=>make({...grant,bytes:201*1024*1024}));
  const store=make();const result=store.write(grant.key,data);assert.equal(readFileSync(result.path).equals(data),true);assert.equal(result.bytes,data.length);assert.throws(()=>store.write(grant.key,data));
});
test('storage hash mismatch, existing artifact and symlink namespace stay protected',()=>{
  const{root,data,grant}=storageFixture();const store=new E2eStorage(process.cwd(),root,scope.runId,scope.projectId,[grant],()=>{},true);
  assert.throws(()=>store.write(grant.key,Buffer.from('invalid')));mkdirSync(store.directory,{recursive:true});const file=resolve(store.directory,'input.mp4');writeFileSync(file,'old artifact');assert.throws(()=>store.write(grant.key,data));assert.equal(readFileSync(file,'utf8'),'old artifact');
  const other=storageFixture(),target=resolve(other.root,'target');mkdirSync(target);symlinkSync(target,resolve(other.root,'runs'),'junction');
  const linked=new E2eStorage(process.cwd(),other.root,scope.runId,scope.projectId,[other.grant],()=>{},true);assert.throws(()=>linked.write(other.grant.key,other.data));
});
test('input/audio/video storage grants keep file bytes, hash and MIME consistent',()=>{
  const{root,data,grant}=storageFixture();const mp3=Buffer.alloc(417);mp3.set([255,251,144,0]);
  const audio:StorageGrant={key:'storage-audio-001',fileName:'narration.mp3',kind:'audio',mime:'audio/mpeg',bytes:mp3.length,sha256:createHash('sha256').update(mp3).digest('hex')};
  const video:StorageGrant={...grant,key:'storage-video-001',fileName:'result.mp4',kind:'video'};
  const store=new E2eStorage(process.cwd(),root,scope.runId,scope.projectId,[grant,audio,video],()=>{},true);
  for(const[g,bytes]of[[grant,data],[audio,mp3],[video,data]] as const){const metadata=store.write(g.key,bytes);assert.equal(metadata.mime,g.mime);assert.equal(metadata.sha256,g.sha256);assert.equal(readFileSync(metadata.path).length,metadata.bytes);}
});
