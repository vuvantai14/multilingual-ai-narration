import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const scenarios=process.env.E2E_ACTUAL_SCENARIOS?.split(',')??['good','wrong-owner','wrong-project','unregistered','payload-tamper','batch-cross','commit-unknown','commit-unknown-applied','outside-cleanup','outside-output','overwrite','hash-upload','render-fail','preload-invalid','off','concurrent','no-lease','symlink-upload','upload-attestation','browser-empty-reads','preclaim-http-stop'];
for(const scenario of scenarios){
  test(`actual services/native guard, isolated scenario: ${scenario}`,()=>{
    const result=spawnSync(process.execPath,['--import','tsx','tests/helpers/e2e-actual-scenario.ts',scenario],{encoding:'utf8',timeout:25000,windowsHide:true});
    assert.equal(result.status,0,result.stderr||result.stdout);const line=result.stdout.trim().split(/\r?\n/).at(-1)!;const evidence=JSON.parse(line);assert.equal(evidence.scenario,scenario);
    if(scenario==='good'||scenario==='browser-empty-reads'){assert.equal(evidence.status,'COMPLETE');assert.equal(evidence.projects,1);assert.deepEqual(evidence.jobs,['COMPLETED','COMPLETED','COMPLETED']);assert.deepEqual(evidence.quota,[1,1]);for(const k of ['stt','translation','tts','extract','render'])assert.equal(evidence[k],1);}
    else if(scenario.startsWith('commit-unknown')){assert.equal(evidence.uncertain,true);assert.equal(evidence.translation,0);assert.equal(evidence.tts,0);}
    else if(scenario==='off')assert.equal(evidence.offUnchanged,true);
    else assert.equal(evidence.denied,true);
  });
}
