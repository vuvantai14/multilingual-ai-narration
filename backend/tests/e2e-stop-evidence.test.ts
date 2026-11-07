import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Separate process per case: never import a live runtime, reset a singleton,
// connect a database or dispatch a provider to inspect stop evidence.
function isolated(script:string,enabled=true):void {
  const imports=`import assert from 'node:assert/strict';
    import {existsSync} from 'node:fs';
    import {resolve} from 'node:path';
    import {registerE2eStopObserver,snapshotE2eRun,stopE2eOnRequestError,e2eProjectId} from './src/services/e2e-test-run.ts';`;
  const child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',imports+'\n'+script+"\nconsole.log('STOP_EVIDENCE_SAFE');"],{
    encoding:'utf8',timeout:15000,windowsHide:true,
    env:{...process.env,NODE_OPTIONS:'',NODE_ENV:'test',S32_E2E_TEST_RUN_ENABLED:enabled?'true':'false'},
  });
  assert.equal(child.status,0,child.stderr||child.stdout);
  assert.match(child.stdout,/STOP_EVIDENCE_SAFE/);
}

test('stop evidence OFF is inert and does not initialize or consume a run',()=>{
  isolated(`let observed=0;registerE2eStopObserver(()=>{observed++;});
    stopE2eOnRequestError({method:'POST',path:'/api/auth/me',status:401,code:'TOKEN_EXPIRED'});
    const state=snapshotE2eRun();assert.equal(state.enabled,false);assert.equal(state.stopped,false);
    assert.equal(state.initialized,false);assert.equal(state.projectClaimed,false);assert.equal(state.busy,false);
    assert.deepEqual(state.dispatches,{STT:0,TRANSLATION:0,TTS:0});assert.equal(state.firstStop,null);
    assert.equal(state.evidenceRecorded,false);assert.equal(observed,0);assert.equal(e2eProjectId('fixture'),undefined);`,false);
});

test('preclaim stop records evidence once without allocating a project or inference journal',()=>{
  isolated(`process.env.S32_E2E_RUN_ID='stop-proof-'+process.pid;
    const journal=resolve('.e2e-control',process.env.S32_E2E_RUN_ID+'.jsonl');assert.equal(existsSync(journal),false);
    const events=[];registerE2eStopObserver(e=>{events.push(e);});
    stopE2eOnRequestError({method:'POST',path:'/api/auth/me',status:401,code:'TOKEN_EXPIRED'});
    const state=snapshotE2eRun();assert.equal(state.enabled,true);assert.equal(state.stopped,true);
    assert.equal(state.initialized,false);assert.equal(state.projectClaimed,false);assert.equal(state.busy,false);
    assert.deepEqual(state.dispatches,{STT:0,TRANSLATION:0,TTS:0});assert.equal(state.evidenceRecorded,true);
    assert.deepEqual(state.firstStop,{method:'POST',route:'/api/auth/me',status:401,code:'TOKEN_EXPIRED'});
    assert.equal(events.length,1);assert.deepEqual(events[0],state.firstStop);
    assert.throws(()=>e2eProjectId('2'.repeat(24)),e=>e.code==='E2E_TEST_RUN_BLOCKED');
    assert.equal(existsSync(journal),false);assert.equal(snapshotE2eRun().initialized,false);`);
});

test('a later blocked request preserves the original immutable stop cause',()=>{
  isolated(`let captured;let calls=0;registerE2eStopObserver(e=>{captured=e;calls++;});
    const first={method:'POST',path:'/api/auth/me?access_token=synthetic-secret',status:401,code:'TOKEN_EXPIRED'};
    stopE2eOnRequestError(first);first.method='POST';first.path='/api/projects';first.status=409;first.code='E2E_TEST_RUN_BLOCKED';
    const state=snapshotE2eRun();assert.equal(Object.isFrozen(state.firstStop),true);assert.equal(Object.isFrozen(captured),true);
    assert.throws(()=>{state.firstStop.code='CHANGED';},TypeError);
    stopE2eOnRequestError({method:'POST',path:'/api/projects',status:409,code:'E2E_TEST_RUN_BLOCKED'});
    assert.equal(calls,1);assert.deepEqual(snapshotE2eRun().firstStop,{method:'POST',route:'/api/auth/me',status:401,code:'TOKEN_EXPIRED'});
    assert.equal(JSON.stringify(state).includes('synthetic-secret'),false);assert.equal(snapshotE2eRun().stopped,true);`);
});

test('failed stop-evidence sink leaves the run stopped and never retries the sink',()=>{
  isolated(`let calls=0;registerE2eStopObserver(()=>{calls++;throw Error('synthetic disk failure');});
    stopE2eOnRequestError({method:'POST',path:'/api/projects',status:400,code:'VALIDATION_ERROR'});
    const state=snapshotE2eRun();assert.equal(state.stopped,true);assert.equal(state.initialized,false);
    assert.equal(state.evidenceRecorded,false);assert.equal(state.firstStop.code,'VALIDATION_ERROR');
    stopE2eOnRequestError({method:'POST',path:'/api/projects',status:409,code:'E2E_TEST_RUN_BLOCKED'});
    assert.equal(calls,1);assert.equal(snapshotE2eRun().firstStop.code,'VALIDATION_ERROR');
    assert.throws(()=>e2eProjectId('2'.repeat(24)),e=>e.code==='E2E_TEST_RUN_BLOCKED');`);
});

test('duplicate evidence-sink registration is denied without replacing the first sink',()=>{
  isolated(`let first=0,second=0;registerE2eStopObserver(()=>{first++;});
    assert.throws(()=>registerE2eStopObserver(()=>{second++;}));
    stopE2eOnRequestError({method:'POST',path:'/api/auth/me',status:401,code:'TOKEN_EXPIRED'});
    assert.equal(first,1);assert.equal(second,0);assert.equal(snapshotE2eRun().stopped,true);`);
});

test('stop evidence sanitizes unknown paths, codes, status and untrusted extra fields',()=>{
  isolated(`let captured;registerE2eStopObserver(e=>{captured=e;});
    stopE2eOnRequestError({method:'SECRET_METHOD',path:'/private/synthetic-secret?token=synthetic-token',status:200,
      code:'password=synthetic-password',headers:{authorization:'synthetic-bearer'},body:{password:'synthetic-password'}});
    assert.deepEqual(captured,{method:'OTHER',route:'OTHER',status:0,code:'REQUEST_FAILED'});
    assert.deepEqual(snapshotE2eRun().firstStop,captured);
    const encoded=JSON.stringify(snapshotE2eRun());for(const value of ['synthetic-secret','synthetic-token','synthetic-password','synthetic-bearer','authorization'])assert.equal(encoded.includes(value),false);`);
});

test('known project routes mask document identity and discard query parameters',()=>{
  for(const suffix of ['','/media','/transcript','/transcription','/translations/en','/narrations','/process']){
    isolated(`let captured;registerE2eStopObserver(e=>{captured=e;});
      stopE2eOnRequestError({method:'POST',path:'/api/projects/'+ 'a'.repeat(24)+${JSON.stringify(suffix)}+'?secret=synthetic',status:404,code:'NOT_FOUND'});
      assert.deepEqual(captured,{method:'POST',route:${JSON.stringify('/api/projects/:id'+suffix)},status:404,code:'NOT_FOUND'});
      assert.equal(JSON.stringify(captured).includes('a'.repeat(24)),false);assert.equal(JSON.stringify(captured).includes('synthetic'),false);`);
  }
});
