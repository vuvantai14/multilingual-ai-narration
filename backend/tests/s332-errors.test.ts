import test from 'node:test';
import assert from 'node:assert/strict';

Object.assign(process.env,{NODE_ENV:'test',MONGODB_URI:'mongodb://127.0.0.1:1/isolated_no_network',JWT_ACCESS_SECRET:'mock-access-only',JWT_REFRESH_SECRET:'mock-refresh-only',JWT_ACCESS_EXPIRES_IN:'15m',JWT_REFRESH_EXPIRES_IN:'1d',S32_E2E_TEST_RUN_ENABLED:'false'});
const {errorHandlerMiddleware}=await import('../src/middleware/error-handler.middleware.js');
const {AppError}=await import('../src/utils/app-error.js');
const {mapGeminiTranscript,GeminiSttError}=await import('../src/services/stt/gemini-stt.provider.js');

test('native scoped denial is HTTP409 with a fixed structured reason, not HTTP500',()=>{
  let http=0,body:unknown;
  const response={status(v:number){http=v;return this;},json(v:unknown){body=v;return this;}};
  errorHandlerMiddleware(new Error('S32_E2E_ACTUAL_WRITE_DENIED'),{method:'POST',originalUrl:'/api/projects'} as never,response as never,()=>{});
  assert.equal(http,409);assert.equal((body as {error:{code:string}}).error.code,'S32_E2E_ACTUAL_WRITE_DENIED');
});
test('structured STT error and no-retry message survive the HTTP boundary',()=>{
  let http=0,body:unknown;
  const response={status(v:number){http=v;return this;},json(v:unknown){body=v;return this;}};
  errorHandlerMiddleware(new AppError(502,'STT_INVALID_RESPONSE','Invalid timestamps; no retry.'),{method:'POST',originalUrl:'/api/projects'} as never,response as never,()=>{});
  assert.equal(http,502);assert.deepEqual((body as {error:unknown}).error,{code:'STT_INVALID_RESPONSE',message:'Invalid timestamps; no retry.'});
});
test('isolated equal timestamp at13.300s stays invalid; no timing/content fabricated',()=>{
  const word=(text:string,start:string,end:string)=>({type:'word_info',text,start_offset:start,end_offset:end});
  const response={status:'completed',output_text:'Mock transcript',steps:[{type:'model_output',content:[{type:'text',annotations:[word('Mock','0s','1s'),word('point','13.300s','13.300s')]}]}]};
  assert.throws(()=>mapGeminiTranscript(response,53.591655),e=>e instanceof GeminiSttError&&e.code==='STT_INVALID_RESPONSE'&&e.diagnostic?.code==='TIMESTAMP_INTERVAL_INVALID');
});
for(const code of ['S32_E2E_STORAGE_DENIED','S33_TARGET_CLAIM_DENIED','S32_E2E_ACTUAL_WRITE_DENIED:projects:$set:sourceLanguage','S32_E2E_TRANSACTION_UNCERTAIN','S32_QUOTA_COMMIT_UNCERTAIN'])test(`guard error is structured and sanitized: ${code}`,()=>{
  let http=0,body:unknown;const response={status(v:number){http=v;return this;},json(v:unknown){body=v;return this;}};
  errorHandlerMiddleware(new Error(code),{method:'POST',originalUrl:'/api/projects'} as never,response as never,()=>{});
  assert.equal(http,code.endsWith('UNCERTAIN')?503:409);const error=(body as {error:{code:string;message:string}}).error;
  assert.equal(error.code,code.includes(':')?'S32_E2E_ACTUAL_WRITE_DENIED':code);assert.equal(error.message.includes('sourceLanguage'),false);
});
