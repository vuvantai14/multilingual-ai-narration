import test from 'node:test';
import assert from 'node:assert/strict';
import { SttTrace,safeSttMetadata } from '../src/services/stt/stt-evidence.js';

const base=Date.parse('2026-11-06T14:56:47.901Z');
function clocked(){let time=base;return{trace:new SttTrace(()=>new Date(time)),advance(ms:number){time+=ms;}};}

test('STT evidence starts without a fabricated inference or provider acceptance',()=>{
  const {trace}=clocked(),e=trace.snapshot();
  assert.equal(e.contract,'GEMINI_STT_EVIDENCE_V1');assert.equal(e.stage,'LOCAL_VALIDATION');
  assert.equal(e.startedAt,new Date(base).toISOString());assert.equal(e.inferenceState,'NOT_DISPATCHED');
  assert.equal(e.outcome,'IN_PROGRESS');assert.equal(e.providerAccepted,'NO');assert.equal(e.retryAllowed,false);
  assert.equal(e.inferenceDispatchAt,undefined);assert.equal(e.inferenceResponseAt,undefined);
});

for(const stage of ['LOCAL_VALIDATION','MEDIA_PROBE','MODEL_VALIDATION','AUDIO_EXTRACTION','AUDIO_PROBE','FILE_UPLOAD','FILE_POLL'] as const){
  test(`503 before transcription at ${stage} is FAILED_PRE_DISPATCH, never an inference claim`,()=>{
    const {trace,advance}=clocked();advance(200);trace.enter(stage);advance(100);
    trace.fail({status:503,error:{status:'UNAVAILABLE'},headers:new Headers({'x-request-id':'req_before_1'})});
    const e=trace.snapshot();assert.equal(e.stage,stage);assert.equal(e.httpStatus,503);
    assert.equal(e.inferenceState,'NOT_DISPATCHED');assert.equal(e.outcome,'FAILED_PRE_DISPATCH');
    assert.equal(e.providerAccepted,'NO');assert.equal(e.retryAllowed,false);assert.equal(e.inferenceDispatchAt,undefined);
    assert.equal(e.inferenceResponseAt,undefined);assert.equal(e.requestId,'req_before_1');
  });
}

test('inference invocation timestamp is distinct from receiving a response',()=>{
  const {trace,advance}=clocked();trace.enter('TRANSCRIPTION');advance(500);trace.dispatch();
  const e=trace.snapshot();assert.equal(e.inferenceState,'INVOKED');assert.equal(e.inferenceDispatchAt,new Date(base+500).toISOString());
  assert.equal(e.providerAccepted,'UNKNOWN');assert.equal(e.inferenceResponseAt,undefined);assert.equal(e.retryAllowed,false);
});

for(const error of [{status:503,error:{status:'UNAVAILABLE'}},{name:'APIConnectionTimeoutError'},{name:'APIUserAbortError'},{name:'TypeError',message:'fetch failed'}]){
  test(`post-invocation ${'status'in error?'503':error.name} stays UNCERTAIN without an acceptance claim`,()=>{
    const {trace,advance}=clocked();trace.enter('TRANSCRIPTION');trace.dispatch();advance(120000);trace.fail(error);
    const e=trace.snapshot();assert.equal(e.stage,'TRANSCRIPTION');assert.equal(e.outcome,'UNCERTAIN');
    assert.equal(e.inferenceState,'status'in error?'RESPONSE_RECEIVED':'INVOKED');assert.equal(e.providerAccepted,'UNKNOWN');assert.equal(e.retryAllowed,false);
    assert.equal(e.inferenceResponseAt,'status'in error?new Date(base+120000).toISOString():undefined);
  });
}

test('returned interaction records response/id separately from request ID and timestamps',()=>{
  const {trace,advance}=clocked();trace.enter('TRANSCRIPTION');advance(250);trace.dispatch();advance(1750);
  trace.response({status:'completed',id:'interaction_1',created:'2026-11-06T14:56:48Z'},{status:200,headers:new Headers({'x-goog-request-id':'req_2'})});
  trace.enter('RESPONSE_VALIDATION');trace.success();const e=trace.snapshot();
  assert.equal(e.inferenceState,'RESPONSE_RECEIVED');assert.equal(e.outcome,'SUCCEEDED');assert.equal(e.providerAccepted,'YES');
  assert.equal(e.operationId,'interaction_1');assert.equal(e.requestId,'req_2');
  assert.equal(e.inferenceDispatchAt,new Date(base+250).toISOString());assert.equal(e.inferenceResponseAt,new Date(base+2000).toISOString());
  assert.equal(e.retryAllowed,false);
});

test('response validation failure retains evidence that inference already returned',()=>{
  const {trace}=clocked();trace.enter('TRANSCRIPTION');trace.dispatch();trace.response({status:'completed',id:'interaction_2'});
  trace.enter('RESPONSE_VALIDATION');trace.fail({code:'STT_INVALID_RESPONSE'});const e=trace.snapshot();
  assert.equal(e.stage,'RESPONSE_VALIDATION');assert.equal(e.outcome,'FAILED_RESPONSE');assert.equal(e.providerAccepted,'YES');
  assert.equal(e.inferenceState,'RESPONSE_RECEIVED');assert.equal(e.operationId,'interaction_2');assert.equal(e.retryAllowed,false);
});

test('cleanup failure never replaces the primary failure stage/status or grants retry',()=>{
  const {trace}=clocked();trace.enter('FILE_UPLOAD');trace.fail({status:503});const before=trace.snapshot();
  trace.cleanupFailed();const after=trace.snapshot();assert.equal(after.cleanupFailed,true);assert.equal(after.stage,before.stage);
  assert.equal(after.httpStatus,before.httpStatus);assert.equal(after.outcome,before.outcome);assert.equal(after.providerAccepted,before.providerAccepted);
  assert.equal(after.retryAllowed,false);assert.equal(after.inferenceDispatchAt,undefined);
});

test('snapshots and captured scalar metadata are immutable and detached from SDK errors',()=>{
  const {trace}=clocked(),error={status:503,error:{status:'UNAVAILABLE'},headers:{'x-request-id':'req_immutable'}};
  trace.enter('MODEL_VALIDATION');trace.fail(error);error.status=401;error.error.status='UNAUTHENTICATED';error.headers['x-request-id']='changed';
  const e=trace.snapshot();assert.equal(e.httpStatus,503);assert.equal(e.requestId,'req_immutable');
  assert.equal(Object.isFrozen(e),true);assert.throws(()=>{(e as unknown as {retryAllowed:boolean}).retryAllowed=true;},TypeError);
  assert.equal(trace.snapshot().retryAllowed,false);
});

test('metadata supports modern status/statusCode headers and bounded legacy JSON status',()=>{
  const modern=safeSttMetadata({statusCode:503,error:{status:'UNAVAILABLE'},headers:new Headers({'x-request-id':'req_modern'})});
  assert.equal(modern.httpStatus,503);assert.equal(modern.providerErrorCode,'UNAVAILABLE');assert.equal(modern.requestId,'req_modern');
  const legacy=safeSttMetadata({status:503,message:JSON.stringify({error:{code:503,status:'UNAVAILABLE',message:'do not retain'}})});
  assert.equal(legacy.httpStatus,503);assert.equal(legacy.providerErrorCode,'UNAVAILABLE');assert.equal(JSON.stringify(legacy).includes('do not retain'),false);
});

test('metadata never serializes SDK raw body/response/cause/request or arbitrary error messages',()=>{
  const error={status:503,error:{status:'UNAVAILABLE',message:'provider transcript private'},body:'raw_private_body',
    rawResponse:{headers:{authorization:'Bearer private_token'}},cause:{apiKey:'AIzaPRIVATE_KEY'},
    headers:new Headers({'authorization':'Bearer private_token','x-goog-api-key':'AIzaPRIVATE_KEY','cookie':'private_cookie','x-request-id':'safe_req'}),
    request:{url:'https://example.test/?key=private_key',body:'private_media'},message:'password=private_password'};
  const e=safeSttMetadata(error),text=JSON.stringify(e);assert.equal(e.requestId,'safe_req');
  for(const secret of ['provider transcript','raw_private_body','private_token','AIzaPRIVATE_KEY','private_cookie','private_key','private_media','private_password','authorization'])assert.equal(text.includes(secret),false,secret);
});

test('secret-like, URL, oversized and malformed identifiers are omitted',()=>{
  for(const value of ['AIzaSyntheticSecret','sk-synthetic_secret','eyJSyntheticJWT','Bearer abc','https://example.test/key','x'.repeat(129),'bad id','line\nvalue']){
    const e=safeSttMetadata({headers:{'x-request-id':value,'x-goog-request-id':value},operationId:value,requestId:value});
    assert.equal(e.requestId,undefined,value);assert.equal(e.operationId,undefined,value);
  }
});

test('unknown provider error text, unbounded JSON and invalid HTTP statuses are omitted',()=>{
  for(const status of [NaN,199,600,'503',undefined])assert.equal(safeSttMetadata({status}).httpStatus,undefined);
  assert.equal(safeSttMetadata({status:200}).httpStatus,200);
  const e=safeSttMetadata({status:503,error:{status:'API_KEY_private_secret'},message:'x'.repeat(20000)});
  assert.equal(e.httpStatus,503);assert.equal(e.providerErrorCode,undefined);
  assert.deepEqual(safeSttMetadata(null),{});assert.deepEqual(safeSttMetadata('private string'),{});
});
