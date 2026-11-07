import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { existingAuthSessionPolicy } from '../src/services/e2e-auth-policy.js';
import mongoose from 'mongoose';
import { installScopedWriteGuard } from '../src/services/scoped-write-guard.js';

test('explicit preload OFF is inert; invalid ON cannot connect or start worker',()=>{
  mkdirSync('.tmp',{recursive:true});const cwd=mkdtempSync(resolve('.tmp','preload-final-')),module=pathToFileURL(resolve('src/e2e-preload.ts')).href;
  for(const on of [false,true]){
    const script=`import mongoose from 'mongoose';let network=0,worker=0;mongoose.connect=async()=>{network++;throw Error('NETWORK_FORBIDDEN');};mongoose.mongo.MongoClient.prototype.connect=async()=>{network++;throw Error('NETWORK_FORBIDDEN');};try{await import(${JSON.stringify(module)});if(${on})throw Error('unexpected startup');}catch(e){if(!${on})throw e;}if(!${on})worker++;if(network!==0||worker!==${on?0:1})throw Error('unsafe startup');console.log('PREFLIGHT_SAFE');`;
    const r=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd,env:{...process.env,S32_E2E_TEST_RUN_ENABLED:on?'true':'false',S32_E2E_MANIFEST_PATH:resolve(cwd,'missing.json')},encoding:'utf8',timeout:15000,windowsHide:true});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/PREFLIGHT_SAFE/);
  }
});
test('composed authsession policy retains exact legacy permissions',async()=>{
  const legacy=await import(pathToFileURL(resolve('../.agents/runtime/s32-6a/read-only-preload.mjs')).href);
  process.env.S32_ALLOW_AUTH_SESSION_INSERT='true';process.env.S32_ALLOW_AUTH_SESSION_LIFECYCLE='true';
  const c={dbName:'multilingual_ai_narration',collectionName:'authsessions'},doc={_id:new mongoose.mongo.ObjectId(),userId:new mongoose.mongo.ObjectId(),tokenHash:'a'.repeat(64),expiresAt:new Date(Date.now()+60000),revokedAt:null};
  try{
    for(const[method,args]of[['insertOne',[doc,{}]],['insertOne',[{...doc,unexpected:true},{}]],['findOneAndUpdate',[{_id:doc._id,userId:doc.userId,tokenHash:doc.tokenHash,revokedAt:null},{$set:{revokedAt:new Date()}},{}]],['deleteMany',[{},{}]],['deleteOne',[{_id:doc._id,userId:doc.userId,tokenHash:doc.tokenHash,expiresAt:{$lte:new Date(0)}},{}]]] as const){assert.equal(existingAuthSessionPolicy(c,method,args),legacy.allowedAuthSessionOperation(c,method,args[0],args[1],args[2]));}
    assert.equal(existingAuthSessionPolicy({...c,collectionName:'projects'},'insertOne',[doc,{}]),false);
  }finally{delete process.env.S32_ALLOW_AUTH_SESSION_INSERT;delete process.env.S32_ALLOW_AUTH_SESSION_LIFECYCLE;}
});
test('native read hello/ping remain usable; Db write aggregation and commands denied',()=>{
  class Collection{}class Db{aggregate(p:unknown){void p;return 'read';}command(c:unknown){void c;return 'metadata';}}class MongoClient{}class Admin{command(c:unknown){void c;return 'metadata';}}
  const restore=installScopedWriteGuard({Collection,Db,MongoClient,Admin} as unknown as Parameters<typeof installScopedWriteGuard>[0],{write:async()=>{throw Error('DENY');}});
  try{assert.equal(new Db().command({hello:1}),'metadata');assert.equal(new Admin().command({ping:1}),'metadata');assert.throws(()=>new Db().command({hello:1,drop:'projects'}));assert.throws(()=>new Db().aggregate([{$documents:[]},{$merge:'projects'}]));assert.throws(()=>new Db().aggregate([{$out:'projects'}]));}finally{restore();}
});
