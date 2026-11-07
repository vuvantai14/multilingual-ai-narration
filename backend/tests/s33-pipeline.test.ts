import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
for (const kind of ['mp3', 'mp4', 'mp3-cover', 'mp4-audio', 'fail503', 'fail429', 'fail403', 'timeout', 'silent-tts', 'corrupt-tts']) test(`S33 actual HTTP/services/adapters and real isolated FFmpeg: ${kind} end-to-end`, () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'tests/helpers/s33-pipeline-scenario.ts', kind], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const evidence = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)!);
  if (['mp3', 'mp4', 'mp3-cover', 'mp4-audio'].includes(kind)) { assert.equal(evidence.status, 'COMPLETE'); assert.deepEqual(evidence.dispatches, [1, 1, 1]); }
  else assert.equal(evidence.status, 'SAFE_STOP');
});
