import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {GeminiSttProvider,GeminiSttError,type GeminiTransport} from '../src/services/stt/gemini-stt.provider.js';
import type {SttEvidence} from '../src/services/stt/stt-evidence.js';

const good=()=>({id:'interaction_mock_1',status:'completed',output_text:'Mock speech',steps:[{type:'model_output',content:[{type:'text',text:'Mock speech',annotations:[{type:'word_info',text:'Mock speech',start_offset:'0s',end_offset:'1s'}]}]}]});
const failure=()=>Object.assign(Error(JSON.stringify({error:{status:'UNAVAILABLE',code:503,message:'Bearer synthetic-private'}})),{status:503});
for(const failedStage of ['MODEL_VALIDATION','FILE_UPLOAD','FILE_POLL','TRANSCRIPTION','RESPONSE_VALIDATION','AUDIO_EXTRACTION','SUCCESS','CLEANUP','TIMEOUT'] as const){
  test(`actual Gemini adapter evidence: ${failedStage}, no network or FFmpeg`,async(t)=>{
    process.env.GEMINI_API_KEY='synthetic-only';process.env.GEMINI_STT_MODEL='gemini-3.5-transcribe';
    t.mock.method(globalThis,'fetch',async()=>{throw Error('NETWORK_FORBIDDEN');});
    const dir=await mkdtemp(resolve('stt-mock-')),file=resolve(dir,'fixture.mp3');await writeFile(file,Buffer.from([1,2]));
    const evidence:SttEvidence[]=[];let calls=0,cleanup=0;
    const transport:GeminiTransport={
      async checkModel(){if(failedStage==='MODEL_VALIDATION')throw failure();},
      async upload(){if(failedStage==='FILE_UPLOAD')throw failure();return{name:'mock-file',uri:'mock-uri',state:failedStage==='FILE_POLL'?'PROCESSING':'ACTIVE'};},
      async getFile(){throw failure();},
      async deleteFile(){cleanup++;if(failedStage==='CLEANUP')throw failure();},
      async transcribe(_model,_uri,_mime,_language,_signal,onResponse){calls++;if(failedStage==='TRANSCRIPTION')throw failure();if(failedStage==='TIMEOUT')throw Object.assign(Error('synthetic'),{name:'APIConnectionTimeoutError'});onResponse?.({status:200,headers:{'x-request-id':'req_success_mock'}});return failedStage==='RESPONSE_VALIDATION'?{...good(),steps:[]}:good();},
    };
    const provider=new GeminiSttProvider(transport,async()=>({duration:2,hasAudio:true,hasVideo:true,format:'mp3'}),async()=>{throw Error('MOCK_EXTRACTION_FAILED');});
    try{
      const input={filePath:file,mimeType:failedStage==='AUDIO_EXTRACTION'?'video/mp4':'audio/mpeg',sourceLanguageMode:'AUTO' as const,onEvidence:(v:SttEvidence)=>{evidence.push(v);}};
      if(failedStage==='SUCCESS'||failedStage==='CLEANUP'){
        const result=await provider.transcribe(input);assert.equal(result.evidence?.outcome,'SUCCEEDED');assert.equal(result.evidence?.providerAccepted,'YES');assert.equal(result.evidence?.requestId,'req_success_mock');assert.equal(result.evidence?.operationId,'interaction_mock_1');assert.equal(result.evidence?.cleanupFailed,failedStage==='CLEANUP');assert.equal(calls,1);
      }else await assert.rejects(provider.transcribe(input),(error:unknown)=>{
        assert.ok(error instanceof GeminiSttError);const e=evidence.at(-1)!;assert.equal(e.stage,failedStage==='TIMEOUT'?'TRANSCRIPTION':failedStage);
        const after=['TRANSCRIPTION','TIMEOUT','RESPONSE_VALIDATION'].includes(failedStage);assert.equal(calls,Number(after));assert.equal(e.outcome,failedStage==='RESPONSE_VALIDATION'?'FAILED_RESPONSE':after?'UNCERTAIN':'FAILED_PRE_DISPATCH');assert.equal(e.retryAllowed,false);assert.equal(Boolean(e.inferenceDispatchAt),after);
        if(failedStage==='TIMEOUT')assert.equal(error.code,'STT_TIMEOUT');if(['MODEL_VALIDATION','FILE_UPLOAD','FILE_POLL','TRANSCRIPTION'].includes(failedStage)){assert.equal(e.httpStatus,503);assert.equal(e.providerErrorCode,'UNAVAILABLE');}
        return true;
      });
      const encoded=JSON.stringify(evidence);for(const privateValue of ['synthetic-private','synthetic-only','mock-uri','Mock speech',file])assert.equal(encoded.includes(privateValue),false);assert.ok(cleanup<=1);
    }finally{await rm(dir,{recursive:true,force:true});}
  });
}
