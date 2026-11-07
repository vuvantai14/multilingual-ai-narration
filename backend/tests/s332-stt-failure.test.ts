import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

for(const scenario of ['mp4-invalid-response','mp4-invalid-response-cleanup','mp4-invalid-response-delayed','mp4-uncertain','mp4-failure-forgery','mp4-auto']){
  test(`S33.2 real native failure path / ${scenario}`,()=>{
    const child=spawnSync(process.execPath,['--import','tsx','tests/helpers/s33-manual-guard-scenario.ts',scenario,'en','Kore','vi'],{encoding:'utf8',windowsHide:true,timeout:45000});
    assert.equal(child.status,0,child.stderr||child.stdout);
    const evidence=JSON.parse(child.stdout.trim().split(/\r?\n/).at(-1)!);
    assert.equal(evidence.status,scenario==='mp4-auto'?'COMPLETE':scenario==='mp4-failure-forgery'?'DENIED':'UNCERTAIN_STOP');
  });
}
