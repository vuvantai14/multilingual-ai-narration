import test from 'node:test';
import assert from 'node:assert/strict';
import { registerPreparedE2eBoundary,expectedE2eEmptyRead } from '../src/services/e2e-runtime-boundary.js';

const ownerId='2'.repeat(24),projectId='1'.repeat(24),base=`/api/projects/${projectId}`;
registerPreparedE2eBoundary({ownerId,projectId,runId:'empty-read-fixture',writer:async(_identity,work)=>work(),record:()=>{}});
test('test-run OFF does not introduce an error exception',()=>{
  delete process.env.S32_E2E_TEST_RUN_ENABLED;
  assert.equal(expectedE2eEmptyRead('GET',base+'/transcript',ownerId,404,'TRANSCRIPT_NOT_FOUND'),false);
});
test('only exact own new-project transcript/en missing reads are expected',()=>{
  process.env.S32_E2E_TEST_RUN_ENABLED='true';
  try{
    assert.equal(expectedE2eEmptyRead('GET',base+'/transcript',ownerId,404,'TRANSCRIPT_NOT_FOUND'),true);
    assert.equal(expectedE2eEmptyRead('GET',base+'/translations/en?format=groups-v1',ownerId,404,'TRANSLATION_NOT_FOUND'),true);
    for(const [method,path,owner,status,code]of[
      ['POST',base+'/transcript',ownerId,404,'TRANSCRIPT_NOT_FOUND'],
      ['GET',base+'/transcript','3'.repeat(24),404,'TRANSCRIPT_NOT_FOUND'],
      ['GET','/api/projects/'+ '4'.repeat(24)+'/transcript',ownerId,404,'TRANSCRIPT_NOT_FOUND'],
      ['GET',base+'/translations/ja',ownerId,404,'TRANSLATION_NOT_FOUND'],
      ['GET',base+'/transcript',ownerId,500,'TRANSCRIPT_NOT_FOUND'],
      ['GET',base+'/transcript',ownerId,401,'TOKEN_EXPIRED'],
      ['GET',base+'/transcript',ownerId,403,'FORBIDDEN'],
      ['GET',base+'/transcript',ownerId,429,'RATE_LIMITED'],
      ['GET',base+'/transcript',ownerId,404,'MEDIA_FILE_MISSING'],
      ['GET',base+'/transcript',ownerId,404,'PROJECT_NOT_FOUND'],
    ] as const)assert.equal(expectedE2eEmptyRead(method,path,owner,status,code),false);
  }finally{delete process.env.S32_E2E_TEST_RUN_ENABLED;}
});
