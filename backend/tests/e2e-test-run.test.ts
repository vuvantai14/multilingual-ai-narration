import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { E2eTestRun, durableRun, e2eInference, e2eProjectId } from '../src/services/e2e-test-run.js';

const scope = { ownerId: 'owner', projectId: 'project', targetLanguage: 'en' };
test('one project and STT1/Translation1/TTS1; fourth, duplicate and other project denied', async () => {
  const events: string[] = [], run = new E2eTestRun(scope, s => events.push(s)); let calls=0;
  assert.equal(run.claimProject('owner'),'project'); assert.throws(()=>run.claimProject('owner'));
  await run.run('STT',scope,async()=>{calls++;});
  await assert.rejects(run.run('STT',scope,async()=>{calls++;}));
  await assert.rejects(run.run('TRANSLATION',{...scope,projectId:'other'},async()=>{calls++;}));
  await assert.rejects(run.run('TRANSLATION',{...scope,targetLanguage:'ja'},async()=>{calls++;}));
  await run.run('TRANSLATION',scope,async()=>{calls++;}); await run.run('TTS',scope,async()=>{calls++;});
  await assert.rejects(run.run('TTS',scope,async()=>{calls++;})); assert.equal(calls,3);
  assert.deepEqual(events.filter(e=>e.startsWith('CLAIM_')),['CLAIM_STT','CLAIM_TRANSLATION','CLAIM_TTS']);
});
test('owner, order and missing request context fail closed', async () => {
  const run = new E2eTestRun(scope,()=>{});assert.throws(()=>run.claimProject('other'));run.claimProject('owner');
  await assert.rejects(run.run('STT',undefined,async()=>assert.fail()));
  await assert.rejects(run.run('STT',{...scope,ownerId:'other'},async()=>assert.fail()));
  await assert.rejects(run.run('TTS',scope,async()=>assert.fail()));
});
test('no concurrent stages or double submission during in-flight work', async () => {
  const run=new E2eTestRun(scope,()=>{});run.claimProject('owner');let release!:()=>void;
  const first=run.run('STT',scope,()=>new Promise<void>(r=>{release=r;}));
  await assert.rejects(run.run('STT',scope,async()=>assert.fail()));await assert.rejects(run.run('TRANSLATION',scope,async()=>assert.fail()));release();await first;
});
test('UNCERTAIN or any provider failure stops all retries and later stages', async () => {
  for(const message of ['TTS_UNCERTAIN','STT_TIMEOUT','INVALID_RESPONSE']){
    const run=new E2eTestRun(scope,()=>{});run.claimProject('owner');let calls=0;
    await assert.rejects(run.run('STT',scope,async()=>{calls++;throw Error(message);}));
    for(const stage of ['STT','TRANSLATION','TTS'] as const)await assert.rejects(run.run(stage,scope,async()=>{calls++;}));assert.equal(calls,1);
  }
});
test('journal failure before dispatch blocks work permanently', async () => {
  let fail=false,calls=0;const run=new E2eTestRun(scope,()=>{if(fail)throw Error('disk full');});run.claimProject('owner');fail=true;
  await assert.rejects(run.run('STT',scope,async()=>{calls++;}));fail=false;await assert.rejects(run.run('STT',scope,async()=>{calls++;}));assert.equal(calls,0);
});
test('post-provider request failure stops later stages', async () => {
  const run=new E2eTestRun(scope,()=>{});run.claimProject('owner');await run.run('STT',scope,async()=>{});run.stop();
  await assert.rejects(run.run('TRANSLATION',scope,async()=>assert.fail()));
});
test('durable exclusive journal refuses another process/restart and never resumes', async () => {
  const root=resolve('.tmp');const dir=mkdtempSync(resolve(root,'control-')),file=resolve(dir,'run.jsonl');
  const run=durableRun(scope,file);run.claimProject('owner');await run.run('STT',scope,async()=>{});
  assert.throws(()=>durableRun(scope,file));assert.match(readFileSync(file,'utf8'),/CLAIM_STT/);
  const child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',`import {durableRun} from './src/services/e2e-test-run.ts';try{durableRun(${JSON.stringify(scope)},${JSON.stringify(file)});process.exitCode=1;}catch{console.log('RESTART_DENIED');}`],{encoding:'utf8'});
  assert.equal(child.status,0);assert.match(child.stdout,/RESTART_DENIED/);
});
test('opt-in OFF leaves ordinary work unchanged and creates no project identity', async () => {
  delete process.env.S32_E2E_TEST_RUN_ENABLED;let calls=0;assert.equal(e2eProjectId('any'),undefined);
  for(let i=0;i<4;i++)await e2eInference('STT',async()=>{calls++;});assert.equal(calls,4);
});
test('opt-in incomplete config blocks before callback and never enables itself', async () => {
  process.env.S32_E2E_TEST_RUN_ENABLED='true';
  try{await assert.rejects(e2eInference('STT',async()=>assert.fail()));}finally{delete process.env.S32_E2E_TEST_RUN_ENABLED;}
});
test('existing Atlas read-only preload still denies a business insert without connection', () => {
  const script=`import {createRequire} from 'node:module';const require=createRequire(import.meta.url);const {Collection}=require('mongoose').mongo;try{Collection.prototype.insertOne.call({dbName:'multilingual_ai_narration',collectionName:'projects'},{_id:'synthetic'});process.exitCode=1;}catch(e){if(e.message!=='S32_6A_READ_ONLY_WRITE_DENIED')throw e;console.log('BUSINESS_WRITE_DENIED');}`;
  const result=spawnSync(process.execPath,['--import',pathToFileURL(resolve('../.agents/runtime/s32-6a/read-only-preload.mjs')).href,'--input-type=module','-e',script],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/BUSINESS_WRITE_DENIED/);
});
