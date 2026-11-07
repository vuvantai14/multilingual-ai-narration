import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { ManualRunSelections } from '../src/services/e2e-manual-policy.js';
import { E2eTestRun } from '../src/services/e2e-test-run.js';

const cases = [
  ['mp3-auto','en','Kore','vi'], ['mp4-manual','ja','Fenrir','en'],
  ['mp3-manual','ko','Kore','ja'], ['mp4-auto','zh','Fenrir','ko'],
  ['mp3-manual','en','Fenrir','zh'],
  ...['wrong-owner','restart','bad-file','corrupt','bad-mime','too-long','oversize','second-file','second-project','cross-write','target-change','voice-change','uncertain','commit-unknown'].map(s=>['mp4-'+s,'en','Kore','vi']),
];
for(const args of cases)test(`S33 manual native guard + real isolated FFmpeg: ${args.join('/')}`,()=>{
  const child=spawnSync(process.execPath,['--import','tsx','tests/helpers/s33-manual-guard-scenario.ts',...args],{encoding:'utf8',timeout:45000,windowsHide:true});
  assert.equal(child.status,0,child.stderr||child.stdout);
  const evidence=JSON.parse(child.stdout.trim().split(/\r?\n/).at(-1)!);
  const stopped=args[0]!.includes('uncertain')||args[0]!.includes('commit-unknown');
  assert.equal(evidence.status,stopped?'UNCERTAIN_STOP':args[0]!.endsWith('auto')||args[0]!.endsWith('manual')?'COMPLETE':'DENIED');
  if(evidence.status==='COMPLETE')assert.deepEqual(evidence.dispatches,[1,1,1]);
});
test('immutable source/target/voice selection rejects invalid/mismatched choices without adding dispatches',()=>{
  const events:string[]=[],selection=new ManualRunSelections(e=>events.push(e));
  assert.throws(()=>selection.claimTarget('en'));assert.throws(()=>selection.claimSource('fr'));
  selection.claimSource('ja');assert.throws(()=>selection.claimSource('vi'));assert.throws(()=>selection.claimTarget('ja'));
  selection.claimTarget('zh');assert.throws(()=>selection.claimTarget('en'));assert.throws(()=>selection.claimVoice('1'.repeat(24),'Kore','en'));
  selection.claimVoice('1'.repeat(24),'Fenrir','zh');assert.throws(()=>selection.claimVoice('2'.repeat(24),'Kore','zh'));
  assert.equal(events.length,3);
});
test('non-English dispatch target is bound once; duplicates, concurrency, fourth inference and changed TTS target denied',async()=>{
  const events:string[]=[],scope={ownerId:'owner',projectId:'project',targetLanguage:'ko'};
  const run=new E2eTestRun(scope,e=>events.push(e),['en','ja','ko','zh']);run.claimProject(scope.ownerId);
  await run.run('STT',scope,async()=>{});await run.run('TRANSLATION',scope,async()=>{});
  await assert.rejects(run.run('TTS',{...scope,targetLanguage:'en'},async()=>assert.fail()));
  await run.run('TTS',scope,async()=>{});await assert.rejects(run.run('TTS',scope,async()=>assert.fail()));
  assert.deepEqual(events.filter(e=>e.startsWith('CLAIM_')),['CLAIM_STT','CLAIM_TRANSLATION','CLAIM_TTS']);
});
test('GET/HEAD including media404 and authentication errors do not stop or initialize a run; first mutation STOP stays immutable',()=>{
  const code=`import assert from 'node:assert/strict';import{snapshotE2eRun,stopE2eOnRequestError,registerE2eStopObserver}from'./src/services/e2e-test-run.ts';const records=[];registerE2eStopObserver(e=>records.push(e));for(const method of ['GET','HEAD'])for(const status of [400,401,403,404,429,500])stopE2eOnRequestError({method,path:'/api/projects/'+ '1'.repeat(24)+'/media',status,code:status===404?'MEDIA_NOT_FOUND':'READ_REJECTED'});assert.equal(snapshotE2eRun().stopped,false);assert.equal(snapshotE2eRun().initialized,false);assert.equal(records.length,0);stopE2eOnRequestError({method:'POST',path:'/api/projects',status:403,code:'SCOPE_DENIED'});stopE2eOnRequestError({method:'DELETE',path:'/api/projects',status:500,code:'LATER'});assert.equal(records.length,1);assert.equal(snapshotE2eRun().firstStop.code,'SCOPE_DENIED');assert.equal(snapshotE2eRun().projectClaimed,false);assert.deepEqual(snapshotE2eRun().dispatches,{STT:0,TRANSLATION:0,TTS:0});`;
  const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',code],{encoding:'utf8',windowsHide:true,env:{...process.env,S32_E2E_TEST_RUN_ENABLED:'true'}});assert.equal(result.status,0,result.stderr);
});
