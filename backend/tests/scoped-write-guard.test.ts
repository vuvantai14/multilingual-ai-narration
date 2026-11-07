import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { ScopedWriteGuard, installScopedWriteGuard, exclusiveWriteJournal, type WriteManifest, type ScopedGrant } from '../src/services/scoped-write-guard.js';

const scope={runId:'scoped-run-0001',projectId:'111111111111111111111111',ownerId:'222222222222222222222222'};
const doc={_id:scope.projectId,userId:scope.ownerId,status:'DRAFT',sourceLanguageMode:'AUTO',sourceLanguage:null};
const grant=(overrides: Partial<ScopedGrant>={}):ScopedGrant=>({key:'create-project-0001',collection:'projects',method:'insertOne',recordId:scope.projectId,args:[doc,{}],...overrides});
const manifest=(grants:ScopedGrant[]=[grant()]):WriteManifest=>({...scope,database:'multilingual_ai_narration',freshProject:true,grants});
function fixture(grants=[grant()],enabled=true,record: (event:string)=>void=()=>{}) {
  const calls:unknown[]=[];
  class Collection {
    dbName='multilingual_ai_narration'; constructor(public collectionName='projects'){}
    async insertOne(...args:unknown[]){calls.push(args);return{acknowledged:true,insertedId:doc._id};}
    async insertMany(...args:unknown[]){calls.push(args);return{};}
    async updateOne(...args:unknown[]){calls.push(args);return{acknowledged:true,matchedCount:1,modifiedCount:1};}
    async findOneAndUpdate(...args:unknown[]){calls.push(args);return args[0];}
    async updateMany(){calls.push('BAD');} async deleteMany(){calls.push('BAD');} async deleteOne(){calls.push('BAD');}
    async bulkWrite(){calls.push('BAD');} aggregate(...args:unknown[]){calls.push(args);return{};}
  }
  class Db{command(){calls.push('BAD');}} class MongoClient{bulkWrite(){calls.push('BAD');}} class Admin{command(){calls.push('BAD');}}
  const guard=new ScopedWriteGuard(manifest(grants),record,enabled);
  const driver={Collection,Db,MongoClient,Admin};
  const restore=installScopedWriteGuard(driver as unknown as Parameters<typeof installScopedWriteGuard>[0],guard);
  return{guard,driver,restore,calls,collection:new Collection()};
}
test('default DENY, OFF, invalid run identity and independently missing freshness',async()=>{
  const f=fixture(undefined,false);await assert.rejects(f.collection.insertOne(doc,{}));
  await assert.rejects(f.guard.run(scope,undefined,()=>f.collection.insertOne(doc,{})));assert.equal(f.calls.length,0);
  for(const m of [{...manifest(),runId:''},{...manifest(),ownerId:'invalid'},{...manifest(),freshProject:false}])assert.throws(()=>new ScopedWriteGuard(m,()=>{},true));
});
test('exact one-use native insert; direct/bypassed context and duplicate denied',async()=>{
  const f=fixture();await assert.rejects(f.collection.insertOne(doc,{}));
  await f.guard.run(scope,undefined,()=>f.collection.insertOne(doc,{}));
  await assert.rejects(f.guard.run(scope,undefined,()=>f.collection.insertOne(doc,{})));assert.equal(f.calls.length,1);
});
test('wrong owner/project/run, cross-project payload, changed identity and duplicate key',async()=>{
  const f=fixture();for(const s of [{...scope,ownerId:'333333333333333333333333'},{...scope,projectId:'333333333333333333333333'},{...scope,runId:'other-run-0001'}])await assert.rejects(f.guard.run(s,undefined,()=>f.collection.insertOne(doc,{})));
  await assert.rejects(f.guard.run(scope,undefined,()=>f.collection.insertOne({...doc,name:'unapproved'},{})));
  assert.throws(()=>new ScopedWriteGuard(manifest([grant({args:[{...doc,_id:'333333333333333333333333'},{}]})]),()=>{},true));
  assert.throws(()=>new ScopedWriteGuard(manifest([grant(),grant()]),()=>{},true));assert.equal(f.calls.length,0);
});
test('old project cannot be addressed by an approved new-project grant',async()=>{
  const f=fixture();await assert.rejects(f.guard.run(scope,undefined,()=>f.collection.insertOne({...doc,_id:'aaaaaaaaaaaaaaaaaaaaaaaa'},{})));assert.equal(f.calls.length,0);
});
test('mutating caller payload after interception cannot escape approved scope',async()=>{
  const data={...doc},f=fixture([grant({args:[data,{}]})]);
  await f.guard.run(scope,undefined,async()=>{const pending=f.collection.insertOne(data,{});data.userId='aaaaaaaaaaaaaaaaaaaaaaaa';await pending;});
  assert.equal(((f.calls[0] as unknown[])[0] as typeof doc).userId,scope.ownerId);
});
test('updateOne requires expected state and exact approved fields',async()=>{
  const args=[{_id:scope.projectId,userId:scope.ownerId,status:'DRAFT'},{$set:{status:'UPLOADED'}},{}];
  const f=fixture([grant({method:'updateOne',state:'DRAFT',args})]);
  await assert.rejects(f.guard.run(scope,undefined,()=>f.collection.updateOne(args[0],{$set:{status:'COMPLETED'}},{})));
  await f.guard.run(scope,undefined,()=>f.collection.updateOne(...args));assert.equal(f.calls.length,1);
  assert.throws(()=>new ScopedWriteGuard(manifest([grant({method:'updateOne',args})]),()=>{},true));
});
test('revision-sensitive findOneAndUpdate denies wrong revision and unsafe update forms',async()=>{
  const id='444444444444444444444444';const args=[{_id:id,projectId:scope.projectId,revision:1},{$set:{revision:2,languageCode:'vi'}},{}];
  const g=grant({collection:'transcripts',method:'findOneAndUpdate',recordId:id,revision:1,args});const f=fixture([g]);f.collection.collectionName='transcripts';
  await assert.rejects(f.guard.run(scope,undefined,()=>f.collection.findOneAndUpdate({...args[0],revision:2},args[1],{})));
  await f.guard.run(scope,undefined,()=>f.collection.findOneAndUpdate(...args));assert.equal(f.calls.length,1);
  assert.throws(()=>new ScopedWriteGuard(manifest([{...g,args:[args[0],[{$set:{revision:2}}],{}]}]),()=>{},true));
  assert.throws(()=>new ScopedWriteGuard(manifest([{...g,args:[args[0],{$set:{projectId:scope.ownerId}},{}]}]),()=>{},true));
});
test('transactions bind exact active session and consumed operation cannot replay after abort',async()=>{
  const session={inTransaction:()=>true};const f=fixture([grant({transaction:true,args:[doc,{session}]})]);
  await assert.rejects(f.guard.run(scope,undefined,()=>f.collection.insertOne(doc,{session})));
  await assert.rejects(f.guard.run(scope,session,()=>f.collection.insertOne(doc,{session:{inTransaction:()=>true}})));
  await f.guard.run(scope,session,()=>f.collection.insertOne(doc,{session}));
  await assert.rejects(f.guard.run(scope,session,()=>f.collection.insertOne(doc,{session})));assert.equal(f.calls.length,1);
});
test('worker without scope and late inherited worker after lease close are denied',async()=>{
  const f=fixture();await assert.rejects(f.collection.insertOne(doc,{}));let worker!:()=>Promise<unknown>;
  await f.guard.run(scope,undefined,async()=>{worker=()=>f.collection.insertOne(doc,{});});await assert.rejects(worker());assert.equal(f.calls.length,0);
});
test('parallel scopes denied while first lease is in flight',async()=>{
  const f=fixture();let release!:()=>void;const a=f.guard.run(scope,undefined,()=>new Promise<void>(r=>{release=r;}));
  await assert.rejects(f.guard.run(scope,undefined,()=>f.collection.insertOne(doc,{})));release();await a;
});
test('bulk/unscoped delete, raw command, admin command, client bulk and write aggregation denied',async()=>{
  const f=fixture();await f.guard.run(scope,undefined,async()=>{
    for(const fn of [()=>f.collection.updateMany(),()=>f.collection.deleteMany(),()=>f.collection.deleteOne(),()=>f.collection.bulkWrite(),()=>f.collection.insertMany([doc],{})])await assert.rejects(fn());
  });assert.throws(()=>new f.driver.Db().command());assert.throws(()=>new f.driver.Admin().command());assert.throws(()=>new f.driver.MongoClient().bulkWrite());
  for(const pipeline of [[{$out:'projects'}],[{$merge:'projects'}],[{$facet:{hidden:[{$out:'projects'}]}}]])assert.throws(()=>f.collection.aggregate(pipeline));assert.equal(f.calls.length,0);
});
test('journal/disk failure stops before native delegate; unknown outcome stops future grants',async()=>{
  let fail=false;const f=fixture(undefined,true,()=>{if(fail)throw Error('disk');});fail=true;
  await assert.rejects(f.guard.run(scope,undefined,()=>f.collection.insertOne(doc,{})));fail=false;
  await assert.rejects(f.guard.run(scope,undefined,()=>f.collection.insertOne(doc,{})));assert.equal(f.calls.length,0);
});
test('unacknowledged or zero-match write stops run without permission to retry',async()=>{
  const g=grant(),guard=new ScopedWriteGuard(manifest([g]),()=>{},true);
  await assert.rejects(guard.run(scope,undefined,()=>guard.write('multilingual_ai_narration','projects','insertOne',g.args,async()=>({acknowledged:false}))));
  await assert.rejects(guard.run(scope,undefined,()=>guard.write('multilingual_ai_narration','projects','insertOne',g.args,async()=>({acknowledged:true,insertedId:doc._id}))));
});
test('cross-project artifact references and unacknowledged write concern cannot be granted',()=>{
  const translation=grant({collection:'translations',recordId:'444444444444444444444444',args:[{_id:'444444444444444444444444',projectId:scope.projectId,transcriptId:'555555555555555555555555',sourceTranscriptRevision:1},{}]});
  assert.throws(()=>new ScopedWriteGuard(manifest([translation]),()=>{},true));
  assert.throws(()=>new ScopedWriteGuard(manifest([grant({args:[doc,{writeConcern:{w:0}}]})]),()=>{},true));
});
test('late inherited timer cannot reuse a scope after request completion',async()=>{
  const f=fixture();let release!:()=>void;const ready=new Promise<void>(r=>{release=r;});let delayed!:Promise<void>;
  await f.guard.run(scope,undefined,async()=>{delayed=new Promise<void>((resolve,reject)=>{setImmediate(()=>{ready.then(()=>f.collection.insertOne(doc,{})).then(()=>reject(Error('unexpected write')),()=>resolve());});});});
  release();await delayed;assert.equal(f.calls.length,0);
});
test('exclusive journal refuses restart and duplicate coordinator',()=>{
  mkdirSync('.tmp',{recursive:true});const dir=mkdtempSync(resolve('.tmp','scoped-')),file=resolve(dir,'journal.jsonl');
  const record=exclusiveWriteJournal(file);new ScopedWriteGuard(manifest(),record,true);assert.throws(()=>exclusiveWriteJournal(file));
});
test('Mongoose Model.create/save/update reaches native guard without DB/network',async()=>{
  const modelDoc={...doc,__v:0};const f=fixture([grant({args:[modelDoc,{}]})]);
  const connection=mongoose.createConnection();connection.readyState=1;
  connection.db={collection:()=>f.collection} as unknown as NonNullable<typeof connection.db>;
  const schema=new mongoose.Schema({_id:String,userId:String,status:String,sourceLanguageMode:String,sourceLanguage:String},{bufferCommands:false,autoCreate:false,autoIndex:false});
  const Model=connection.model('ScopedFixtureProject',schema,'projects');
  await assert.rejects(Model.create(doc));await f.guard.run(scope,undefined,async()=>{await Model.create(doc);});
  await assert.rejects(f.guard.run(scope,undefined,async()=>{await new Model(doc).save();}));
  await assert.rejects(Model.updateOne({_id:doc._id},{$set:{status:'COMPLETED'}}));assert.equal(f.calls.length,1);
  await assert.rejects(Model.deleteOne({_id:doc._id}));await assert.rejects(Model.findOneAndUpdate({_id:doc._id},{$set:{status:'COMPLETED'}}));
});
test('existing authsessions predicate preserves valid narrow exception without business privilege',async()=>{
  const existing=await import(pathToFileURL(resolve('../.agents/runtime/s32-6a/read-only-preload.mjs')).href);
  process.env.S32_ALLOW_AUTH_SESSION_INSERT='true';
  const f=fixture();f.restore();const driver=f.driver as unknown as Parameters<typeof installScopedWriteGuard>[0];
  installScopedWriteGuard(driver,f.guard,(c,m,a)=>existing.allowedAuthSessionOperation(c,m,a[0],a[1],a[2]));
  const auth=new f.driver.Collection('authsessions'),session={_id:new mongoose.mongo.ObjectId(),userId:new mongoose.mongo.ObjectId(),tokenHash:'a'.repeat(64),expiresAt:new Date(Date.now()+60000),revokedAt:null};
  try{await auth.insertOne(session,{});await assert.rejects(auth.insertOne({...session,extra:'no'},{}));await assert.rejects(f.collection.insertOne(doc,{}));assert.equal(f.calls.length,1);}finally{delete process.env.S32_ALLOW_AUTH_SESSION_INSERT;}
});
