import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
for(const scenario of ['mp3-auto','mp4-audio','mp4-timestamp51','mp4-small-overlap','mp4-duplicate-times','mp4-stt429','mp4-stt-timeout','mp4-stt-missing','mp4-stt-large-overlap','mp4-stt-negative','mp4-stt-beyond','mp4-no-audio','mp4-translation-invalid','mp4-translation503','mp4-corrupt-tts','mp4-silent-tts','mp4-tts-timeout','mp4-tts-network','mp4-render-failed'])test(`stabilized actual scoped pipeline: ${scenario}`,()=>{
  const child=spawnSync(process.execPath,['--import','tsx','tests/helpers/s33-manual-guard-scenario.ts',scenario],{encoding:'utf8',windowsHide:true,timeout:60000});
  assert.equal(child.status,0,child.stderr||child.stdout);
  const result=JSON.parse(child.stdout.trim().split(/\r?\n/).at(-1)!);
  assert.ok(['COMPLETE','SAFE_STOP','UNCERTAIN_STOP','DENIED'].includes(result.status));
});
