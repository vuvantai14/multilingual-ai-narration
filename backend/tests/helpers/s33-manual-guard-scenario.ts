import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import mongoose from 'mongoose';
import { memoryNative } from './e2e-memory-native.js';

const scenario=process.argv[2]??'mp4-auto',kind=scenario.startsWith('mp3')?'mp3':scenario==='mp4-audio'?'mp4-audio':'mp4',mode=scenario.includes('manual')?'MANUAL':'AUTO',target=process.argv[3]??'en',voiceName=process.argv[4]??'Kore',sourceLanguage=process.argv[5]??(target==='en'?'vi':'en');
const audioOnly = ['mp3', 'mp3-cover', 'mp4-audio'].includes(kind), mp3Input = ['mp3', 'mp3-cover'].includes(kind);
mkdirSync('.tmp', { recursive: true });
const externalFetch=globalThis.fetch;globalThis.fetch=(url,init)=>{const endpoint=new URL(typeof url==='string'?url:url instanceof URL?url.href:url.url);if(endpoint.hostname!=='127.0.0.1')throw Error('EXTERNAL_NETWORK_FORBIDDEN');return externalFetch(url,init);};
const root = mkdtempSync(resolve('.tmp', 's331-')), oid = (v: string) => new mongoose.mongo.ObjectId(v);
Object.assign(process.env, { NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:1/isolated_no_network', JWT_ACCESS_SECRET: randomBytes(32).toString('hex'), JWT_REFRESH_SECRET: randomBytes(32).toString('hex'), JWT_ACCESS_EXPIRES_IN: '15m', JWT_REFRESH_EXPIRES_IN: '1d', UPLOAD_DIR: root, STT_PROVIDER: 'gemini', TTS_PROVIDER: 'gemini', TRANSLATION_PROVIDER: 'gemini', CUSTOMER_TRANSLATION_ENABLED: 'true', CUSTOMER_TRANSLATION_METHOD: 'GEMINI_SIMPLE_V1', GEMINI_API_KEY: 'isolated-synthetic-key', MAX_UPLOAD_SIZE_MB: '2' });
for (const key of ['S32_E2E_TEST_RUN_ENABLED', 'CONTROLLED_PROVIDER_MODE', 'GROUP_TRANSLATION_ENABLED', 'TTS_MODEL', 'GEMINI_STT_MODEL']) delete process.env[key];
const db = memoryNative(), ownerId = '2'.repeat(24), voiceId = '3'.repeat(24), languageId = '4'.repeat(24);
db.seed('users', { _id: oid(ownerId), name: 'Isolated fixture', role: 'CUSTOMER', status: 'ACTIVE' });
db.seed('languages', { _id: oid(languageId), code: 'en', name: 'English', isActive: true });
db.seed('voices', { _id: oid(voiceId), provider: 'gemini', providerVoiceId: 'Kore', languageId: oid(languageId), name: 'Kore', gender: 'FEMALE', isActive: true });
const old = { _id: oid('e'.repeat(24)), userId: oid('d'.repeat(24)), name: 'Protected old project', status: 'COMPLETED', progress: 100 };
db.seed('projects', old);
mongoose.set('autoCreate', false); mongoose.set('autoIndex', false); mongoose.set('bufferCommands', false);
mongoose.connection.readyState = 1; mongoose.connection.db = { collection: (name: string) => db.collection(name) } as never;
mongoose.startSession = async () => new db.MemorySession() as never; mongoose.connection.startSession = mongoose.startSession;
const { resolveMediaExecutable } = await import('../../src/services/media-processing/media-executable.js');
const ffmpeg = resolveMediaExecutable('ffmpeg');
function encode(args: string[], path: string) { execFileSync(ffmpeg, ['-nostdin', '-v', 'error', '-n', ...args, path], { timeout: 15000, windowsHide: true, stdio: 'pipe' }); }
const input = resolve(root, 'fixture.' + (mp3Input ? 'mp3' : 'mp4'));
if(scenario==='mp4-no-audio')encode(['-f','lavfi','-i','color=c=purple:s=160x120:d=2','-c:v','libx264','-pix_fmt','yuv420p'],input);
else encode(kind === 'mp3-cover' ? ['-f', 'lavfi', '-i', `sine=frequency=600:duration=${scenario.includes('timestamp51')?14:2}`, '-f', 'lavfi', '-i', 'color=c=purple:s=160x120:d=0.04', '-map', '0:a', '-map', '1:v', '-c:a', 'libmp3lame', '-c:v', 'mjpeg', '-id3v2_version', '3', '-disposition:v', 'attached_pic']
  : audioOnly ? ['-f', 'lavfi', '-i', `sine=frequency=600:duration=${scenario.includes('timestamp51')?14:2}`, '-c:a', mp3Input ? 'libmp3lame' : 'aac'] : ['-f', 'lavfi', '-i', `color=c=purple:s=160x120:d=${scenario.includes('timestamp51')?14:2}`, '-f', 'lavfi', '-i', `sine=frequency=600:duration=${scenario.includes('timestamp51')?14:2}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest'], input);
const bytes = readFileSync(input), hash = createHash('sha256').update(bytes).digest('hex');
const wav = resolve(root, 'provider.wav'); encode(['-f', 'lavfi', '-i', scenario.includes('silent-tts') ? 'anullsrc=r=24000:cl=mono:d=1.5' : 'sine=frequency=800:duration=1.5', '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le'], wav);
const selectedLanguage=new mongoose.mongo.ObjectId(),selectedVoice=new mongoose.mongo.ObjectId();
if(target!=='en')db.seed('languages',{_id:selectedLanguage,code:target,name:target,isActive:true});
if(target!=='en'||voiceName!=='Kore')db.seed('voices',{_id:selectedVoice,provider:'gemini',providerVoiceId:voiceName,languageId:target==='en'?oid(languageId):selectedLanguage,name:voiceName,gender:voiceName==='Kore'?'FEMALE':'MALE',isActive:true});
const chosenVoiceId=target==='en'&&voiceName==='Kore'?voiceId:String(selectedVoice);
const {prepareActualRun}=await import('../../src/services/e2e-actual-runtime.js'),{productionActualTools}=await import('../../src/services/e2e-actual-storage.js');
const runId='manual_'+randomBytes(12).toString('hex'),reservedProjectId='1'.repeat(24);
Object.assign(process.env,{S32_E2E_TEST_RUN_ENABLED:'true',S33_MANUAL_RUN:'true',S32_E2E_RUN_ID:runId,S32_E2E_PROJECT_ID:reservedProjectId,S32_E2E_OWNER_ID:ownerId});
const preparation={manifest:{contract:'S33_MANUAL_RUN_V1',runId,projectId:reservedProjectId,ownerId,koreVoiceId:voiceId},driver:db.driver as never,reads:db.reads,workspace:process.cwd(),uploadRoot:root,journal:resolve(root,runId+'.native.jsonl'),connect:async()=>{},tools:scenario==='mp4-too-long'?{...productionActualTools(),probe:async(path:string)=>({...await productionActualTools().probe(path),duration:1801})}:productionActualTools()} as const;
if(scenario==='mp4-render-failed'){
  const original=preparation.tools.encode;
  preparation.tools.encode=async(...args)=>{if(args[0]==='render')throw Error('MEDIA_PROCESSING_INVALID_OUTPUT');return original(...args);};
}
const runtime=(await prepareActualRun(preparation,true))!;
if(scenario==='mp4-restart'){await assert.rejects(prepareActualRun(preparation,true));assert.equal(db.documents('projects').length,1);console.log(JSON.stringify({scenario,status:'DENIED'}));process.exit(0);}
const {snapshotE2eRun}=await import('../../src/services/e2e-test-run.js');
if(scenario==='mp4-invalid-response-delayed'){
 const original=mongoose.Query.prototype.exec;
 mongoose.Query.prototype.exec=async function(...args:Parameters<typeof original>){
  if(this.model.modelName==='ProcessingJob'&&(this.getUpdate() as {$set?:{status?:string};status?:string})?.status==='FAILED')await new Promise(r=>setTimeout(r,40));
  return original.apply(this,args);
 };
}

let stt = 0, translation = 0, tts = 0;
const { GeminiSttProvider } = await import('../../src/services/stt/gemini-stt.provider.js');
const { setSttProviderForTests } = await import('../../src/services/stt/stt.service.js');
setSttProviderForTests(new GeminiSttProvider({ checkModel: async () => { if (kind === 'fail403') throw { status: 403, error: { status: 'PERMISSION_DENIED' } }; }, upload: async () => ({ name: 'fixture', uri: 'fixture://isolated', state: 'ACTIVE' }), getFile: async () => { throw Error('unexpected poll'); }, deleteFile: async () => {if(scenario==='mp4-invalid-response-cleanup')throw Error('MOCK_CLEANUP_FAILED');}, transcribe: async (_m, _u, _mime, language, _signal, onResponse) => { stt++; assert.equal(language, mode==='AUTO'?undefined:({vi:'vi-VN',en:'en-US',ja:'ja-JP',ko:'ko-KR',zh:'cmn-Hans-CN'} as Record<string,string>)[sourceLanguage]);if(scenario==='mp4-uncertain')throw{status:503,error:{status:'UNAVAILABLE'}}; if(scenario==='mp4-stt429')throw{status:429,error:{status:'RESOURCE_EXHAUSTED'}};
if(scenario==='mp4-stt-timeout')throw Object.assign(Error('mock timeout'),{name:'APIConnectionTimeoutError'});
if(scenario==='mp4-stt-missing')return{status:'completed',output_text:'Mock',steps:[]};
if(['mp4-stt-large-overlap','mp4-stt-negative','mp4-stt-beyond'].includes(scenario)){
 const times=scenario==='mp4-stt-negative'?[[-0.1,0.5]]:scenario==='mp4-stt-beyond'?[[0,999]]:[[0,1],[0.5,1.5]];onResponse?.({status:200});return{status:'completed',output_text:'Mock',steps:[{type:'model_output',content:[{type:'text',annotations:times.map(([start,end])=>({type:'word_info',text:'Mock',start_offset:start+'s',end_offset:end+'s'}))}]}]};
}

if(scenario.includes('timestamp51')||scenario==='mp4-small-overlap'||scenario==='mp4-duplicate-times'){
 const times:Array<[number,number]>=scenario.includes('timestamp51')?[...Array.from({length:50},(_,i)=>[i/4,(i+1)/4]as[number,number]),[12.5,13.28],[13.3,13.3],[13.31,13.6]]:scenario==='mp4-small-overlap'?[[0,0.8],[0.78,1.5]]:[[0,0.8],[0.8,0.8],[0.8,0.8],[0.8,1.5]];
 const text=times.map((_,i)=>'w'+i).join(' ');onResponse?.({status:200});return{status:'completed',output_text:text,steps:[{type:'model_output',content:[{type:'text',text,annotations:times.map(([start,end],i)=>({type:'word_info',text:'w'+i,start_offset:start+'s',end_offset:end+'s'}))}]}]};
}
 if(scenario.startsWith('mp4-invalid-response')){onResponse?.({status:200});return{status:'completed',output_text:'Mock valid then isolated point',steps:[{type:'model_output',content:[{type:'text',annotations:[{type:'word_info',text:'Mock valid',start_offset:'0s',end_offset:'0.5s'},{type:'word_info',text:'isolated point',start_offset:'1.300s',end_offset:'1.300s'}]}]}]};} if (kind === 'fail503' || kind === 'fail429') throw { status: Number(kind.slice(4)), error: { status: kind === 'fail503' ? 'UNAVAILABLE' : 'RESOURCE_EXHAUSTED' } }; if (kind === 'timeout') throw Object.assign(new Error('fixture transport deadline'), { name: 'APIConnectionTimeoutError' }); return { status: 'completed', output_text: 'Di sản bảo tàng.', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Di sản bảo tàng.', annotations: [{ type: 'word_info', text: 'Di sản bảo tàng.', start_offset: '0s', end_offset: '1.5s' }] }] }] }; } }));
const { GeminiTtsProvider } = await import('../../src/services/tts/gemini-tts.provider.js');
const { setTtsProviderForTests } = await import('../../src/services/tts/tts.service.js');
setTtsProviderForTests(new GeminiTtsProvider({ ...(scenario==='mp4-tts-timeout'?{deadlineMs:20}:{}),dispatch: async (text, voice) => { tts++; if(scenario==='mp4-tts-timeout')return new Promise(()=>{});if(scenario==='mp4-tts-network')throw Error('MOCK_TRANSPORT'); assert.ok(text.split('Museum heritage.').join('').trim()===''); assert.equal(voice, voiceName); return { output_audio: { data: (scenario.includes('corrupt-tts') ? Buffer.from('not audio') : readFileSync(wav)).toString('base64'), mime_type: 'audio/wav' } }; } }));
const { GeminiGroupTranslationProvider } = await import('../../src/services/translation/gemini-group-translation.provider.js');
const { GroupTranslationService } = await import('../../src/services/translation/group-translation.service.js');
const { GroupDraftStore } = await import('../../src/services/translation/group-draft-store.js');
const groups = new GroupTranslationService(new GeminiGroupTranslationProvider({ metadata: async () => ({ supportedActions: ['generateContent'] }), generate: async (_m, input) => { translation++;if(scenario==='mp4-translation-invalid')return{text:'{}',finishReason:'STOP'};if(scenario==='mp4-translation503')throw{status:503}; assert.equal(input.targetLanguage, target); return { text: JSON.stringify({ outcome: 'translated', groups: input.groups.map(g => ({ groupId: g.groupId, translatedText: 'Museum heritage.' })) }), finishReason: 'STOP' }; } }), new GroupDraftStore());
const project = await import('../../src/services/project.service.js'), narration = await import('../../src/services/narration.service.js'), result = await import('../../src/services/result.service.js');
const created = await project.create(ownerId, { name: 'S33 isolated fixture', sourceLanguageMode:mode,...(mode==='MANUAL'?{sourceLanguage}: {}) }), projectId = created.id;
const { app } = await import('../../src/app.js'), { signAccessToken } = await import('../../src/utils/jwt.js');
const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port, headers = { authorization: 'Bearer ' + signAccessToken(ownerId, 'CUSTOMER') };
try {
  const limits = await fetch(base + '/api/projects/media-limits', { headers }); assert.equal(limits.status, 200); assert.equal((await limits.json()).data.maxFileSize, 2 * 1024 * 1024);
  async function upload(data: Buffer, name: string, mime: string) { const form = new FormData(); form.append('file', new Blob([new Uint8Array(data)], { type: mime }), name); return fetch(base + '/api/projects/' + projectId + '/media', { method: 'POST', headers, body: form }); }
  const empty=await fetch(base+`/api/projects/${projectId}/media`,{headers});assert.equal(empty.status,404);assert.equal(snapshotE2eRun().stopped,false);assert.deepEqual(snapshotE2eRun().dispatches,{STT:0,TRANSLATION:0,TTS:0});
  if(['mp4-bad-file','mp4-corrupt','mp4-bad-mime','mp4-too-long','mp4-oversize','mp4-no-audio'].includes(scenario)){
    const invalidBytes=scenario==='mp4-corrupt'?Buffer.from([0,0,0,16,102,116,121,112,109,112,52,50,0,0,0,0]):scenario==='mp4-oversize'?Buffer.alloc(3*1024*1024):scenario==='mp4-bad-file'?Buffer.from('not media'):bytes;
    const invalid=await upload(invalidBytes,'invalid.mp4',scenario==='mp4-bad-mime'?'audio/mpeg':'video/mp4');assert.ok(invalid.status>=400);if(scenario==='mp4-no-audio'){assert.equal(invalid.status,422);assert.equal((await invalid.json()).error.code,'MEDIA_AUDIO_REQUIRED');}assert.equal(stt+translation+tts,0);assert.equal(runtime.assets.claimed(),false);assert.equal(db.documents('media').length,0);console.log(JSON.stringify({scenario,status:'DENIED',dispatches:snapshotE2eRun().dispatches}));process.exit(0);
  }
  if(scenario==='mp4-wrong-owner'){const other='5'.repeat(24);db.seed('users',{_id:oid(other),name:'other fixture',role:'CUSTOMER',status:'ACTIVE'});const form=new FormData();form.append('file',new Blob([bytes],{type:'video/mp4'}),'wrong-owner.mp4');const response=await fetch(base+'/api/projects/'+projectId+'/media',{method:'POST',headers:{authorization:'Bearer '+signAccessToken(other,'CUSTOMER')},body:form});assert.equal(response.status,404);assert.equal(runtime.assets.claimed(),false);assert.equal(db.documents('media').length,0);assert.equal(stt+translation+tts,0);console.log(JSON.stringify({scenario,status:'DENIED'}));process.exit(0);}
  if(scenario==='mp4-second-project'){
    const response=await fetch(base+'/api/projects',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({name:'must not create',sourceLanguageMode:'AUTO'})});assert.ok(response.status>=400);assert.equal(db.documents('projects').length,2);console.log(JSON.stringify({scenario,status:'DENIED'}));process.exit(0);
  }
  const uploaded = await upload(bytes, 'fixture.' + (mp3Input ? 'mp3' : 'mp4'), mp3Input ? 'audio/mpeg' : 'video/mp4'); const uploadedData = await uploaded.json(); assert.equal(uploaded.status, 201, JSON.stringify(uploadedData));
  assert.equal(runtime.assets.claimed(),true);
  assert.equal(uploadedData.data.media.mediaType, audioOnly ? 'AUDIO' : 'VIDEO');
  const sourcePlayback = await fetch(base + `/api/projects/${projectId}/media/file`, { headers: { ...headers, Range: 'bytes=0-63' } }); assert.equal(sourcePlayback.status, 206);
  if(scenario==='mp4-second-file'){
    const response=await upload(bytes,'again.mp4','video/mp4');assert.ok(response.status>=400);assert.equal(stt+translation+tts,0);assert.equal(db.documents('media').length,1);assert.equal(createHash('sha256').update(readFileSync(runtime.assets.metadata('input').path)).digest('hex'),hash);console.log(JSON.stringify({scenario,status:'DENIED'}));process.exit(0);
  }
  if(scenario==='mp4-cross-write'){
    const {Project}=await import('../../src/models/Project.js');await assert.rejects(Project.updateOne({_id:old._id},{$set:{status:'FAILED'}}));assert.deepEqual(db.documents('projects').find(p=>String(p._id)===String(old._id)),old);console.log(JSON.stringify({scenario,status:'DENIED'}));process.exit(0);
  }
  if(scenario==='mp4-failure-forgery'){
    const {Project}=await import('../../src/models/Project.js');
    await assert.rejects(runtime.writer('STT',{projectId,ownerId},()=>Project.updateOne({_id:projectId},{$set:{status:'FAILED'}}).exec()));
    assert.equal(db.documents('projects').find(p=>String(p._id)===projectId)!.status,'UPLOADED');assert.equal(stt,0);
    console.log(JSON.stringify({scenario,status:'DENIED'}));process.exit(0);
  }
  if(scenario==='mp4-uncertain'||scenario.startsWith('mp4-invalid-response')||['mp4-stt429','mp4-stt-timeout','mp4-stt-missing','mp4-stt-large-overlap','mp4-stt-negative','mp4-stt-beyond'].includes(scenario)){
    const response=await fetch(base+`/api/projects/${projectId}/transcription`,{method:'POST',headers});
    const body=await response.json();assert.equal(response.status,502);assert.equal(body.error.code,['mp4-uncertain','mp4-stt429','mp4-stt-timeout'].includes(scenario)?'STT_EXECUTION_UNCERTAIN':'STT_INVALID_RESPONSE');
    assert.match(body.error.message,['mp4-uncertain','mp4-stt429','mp4-stt-timeout'].includes(scenario)?/không gửi lại/:/mốc thời gian không hợp lệ/);
    const job=db.documents('processingjobs')[0]!;assert.equal(job.status,'FAILED');assert.equal(job.errorMessage,scenario==='mp4-stt429'?'STT_QUOTA_EXCEEDED':scenario==='mp4-stt-timeout'?'STT_TIMEOUT':scenario==='mp4-uncertain'?'STT_PROVIDER_ERROR':'STT_INVALID_RESPONSE');
    const evidence=job.sttEvidence as {outcome:string;cleanupFailed:boolean};assert.equal(evidence.outcome,['mp4-uncertain','mp4-stt429','mp4-stt-timeout'].includes(scenario)?'UNCERTAIN':'FAILED_RESPONSE');assert.equal(evidence.cleanupFailed,scenario.endsWith('cleanup'));
    assert.equal(db.documents('projects').find(p=>String(p._id)===projectId)!.status,'FAILED');
    assert.equal(db.documents('transcripts').length,0);assert.equal(db.documents('translations').length,0);assert.equal(db.documents('results').length,0);
    assert.deepEqual(db.documents('projects').find(p=>String(p._id)===String(old._id)),old);
    const state=await(await fetch(base+`/api/projects/${projectId}/transcription-state`,{headers})).json();assert.equal(state.data.state,['mp4-uncertain','mp4-stt429','mp4-stt-timeout'].includes(scenario)?'UNCERTAIN':'FAILED');assert.equal(state.data.retryAllowed,false);
    const first=snapshotE2eRun().firstStop;assert.equal(first?.code,body.error.code);assert.equal(first?.status,502);
    const retry=await fetch(base+`/api/projects/${projectId}/transcription`,{method:'POST',headers});assert.ok(retry.status>=400);assert.equal(stt,1);assert.deepEqual(snapshotE2eRun().firstStop,first);
    assert.equal(translation+tts,0);assert.equal(runtime.snapshot().stopped,true);
    console.log(JSON.stringify({scenario,status:'UNCERTAIN_STOP',dispatches:snapshotE2eRun().dispatches}));process.exit(0);
  }
  const sttResponse=await fetch(base+`/api/projects/${projectId}/transcription`,{method:'POST',headers});
  const sttBody=await sttResponse.json();assert.equal(sttResponse.status,200,JSON.stringify(sttBody));
  const transcribed=sttBody.data; assert.equal(transcribed.transcript.sourceLanguageStatus,mode==='AUTO'?'NEEDS_CONFIRMATION':'CONFIRMED');
  if(scenario.includes('timestamp51')){const stored=db.documents('transcripts')[0]!;assert.equal(String(stored.fullText),Array.from({length:53},(_,i)=>'w'+i).join(' '));const segments=db.documents('transcriptsegments');assert.equal(segments.map(s=>s.text).join(' '),stored.fullText);assert.equal(segments.length,52);assert.equal((db.documents('processingjobs')[0]!.sttEvidence as {timeline:{pointWords:number}}).timeline.pointWords,1);}
  if(mode==='AUTO'){
    const confirmed=await fetch(base+`/api/projects/${projectId}/source-language/confirm`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({sourceLanguage,expectedRevision:transcribed.transcript.revision})});
    assert.equal(confirmed.status,200,await confirmed.text());
  }
  if(scenario==='mp4-commit-unknown')db.commitUnknown(true,true);
  if(scenario==='mp4-commit-unknown'){await assert.rejects(groups.customerGenerate(projectId,ownerId,target));assert.equal(translation,0);assert.equal(tts,0);assert.equal(runtime.snapshot().stopped,true);console.log(JSON.stringify({scenario,status:'UNCERTAIN_STOP'}));process.exit(0);}
  if(scenario.startsWith('mp4-translation')){
    await assert.rejects(groups.customerGenerate(projectId,ownerId,target));
    const attempt=db.documents('translationattempts').find(a=>a.kind!=='QUOTA')!;
    assert.equal(attempt.state,scenario==='mp4-translation-invalid'?'FAILED_RESPONSE':'UNCERTAIN');assert.equal(translation,1);assert.equal(tts,0);
    assert.equal(db.documents('translations').length,0);assert.deepEqual(db.documents('translationattempts').filter(a=>a.kind==='QUOTA').map(a=>a.count),[1,1]);
    await assert.rejects(groups.customerGenerate(projectId,ownerId,target));assert.equal(translation,1);
    console.log(JSON.stringify({scenario,status:'SAFE_STOP'}));process.exit(0);
  }
  const draft = await groups.customerGenerate(projectId, ownerId, target);
  if(scenario==='mp4-target-change'){await assert.rejects(groups.customerGenerate(projectId,ownerId,target==='en'?'ja':'en'));assert.equal(translation,1);assert.equal(tts,0);console.log(JSON.stringify({scenario,status:'DENIED'}));process.exit(0);}
  const { withCustomerTranslation } = await import('../../src/services/translation/customer-scope.js');

  await withCustomerTranslation(() => groups.approve(projectId, ownerId, draft.draftId, { outputDigest: draft.outputDigest, reviewed: true }));
  if(scenario.includes('tts-')||scenario.includes('-tts')){
    await assert.rejects(narration.generate(projectId,ownerId,target,chosenVoiceId),e=>{assert.equal((e as {code:string}).code,scenario.includes('timeout')?'TTS_TIMEOUT':scenario.includes('network')?'TTS_UNCERTAIN':'TTS_INVALID_RESPONSE');return true;});
    const job=db.documents('processingjobs').find(j=>j.type==='TTS')!;assert.equal(job.status,'FAILED');assert.equal(db.documents('projects').find(p=>String(p._id)===projectId)!.status,'FAILED');
    assert.equal(db.documents('narrations').length,0);assert.equal(db.documents('results').length,0);assert.equal(tts,1);await assert.rejects(narration.generate(projectId,ownerId,target,chosenVoiceId));assert.equal(tts,1);
    assert.deepEqual(db.documents('projects').find(p=>String(p._id)===String(old._id)),old);
    console.log(JSON.stringify({scenario,status:'SAFE_STOP'}));process.exit(0);
  }
  const audio = await narration.generate(projectId, ownerId, target, chosenVoiceId);
  if(scenario==='mp4-voice-change'){await assert.rejects(narration.generate(projectId,ownerId,target,voiceId===chosenVoiceId?String(selectedVoice):voiceId));assert.equal(tts,1);console.log(JSON.stringify({scenario,status:'DENIED'}));process.exit(0);}
  const { FfmpegMediaProcessor } = await import('../../src/services/media-processing/ffmpeg-media-processor.js'); const processor = new FfmpegMediaProcessor();
  const audioRow = db.documents('narrations')[0]!, audioPath = resolve(root, String(audioRow.audioPath)), audioProbe = await processor.probe(audioPath);
  assert.equal(audioProbe.hasAudio, true); assert.equal(audioProbe.audioCodec, 'mp3'); assert.ok(audioProbe.duration > 0);
  const playback = await fetch(base + `/api/projects/${projectId}/narrations/${audio.narration.id}/audio`, { headers }); assert.equal(playback.status, 200); assert.match(playback.headers.get('content-type')!, /audio\/mpeg/); const downloadedAudio=Buffer.from(await playback.arrayBuffer());assert.ok(downloadedAudio.byteLength>100);assert.equal(createHash('sha256').update(downloadedAudio).digest('hex'),createHash('sha256').update(readFileSync(audioPath)).digest('hex'));assert.equal(audioRow.duration,audioProbe.duration);
  if(scenario==='mp4-render-failed'){
    await assert.rejects(result.process(projectId,ownerId,audio.narration.id));const job=db.documents('processingjobs').find(j=>j.type==='VIDEO_PROCESSING')!;
    assert.equal(job.status,'FAILED');assert.equal(job.errorMessage,'MEDIA_PROCESSING_INVALID_OUTPUT');assert.equal(db.documents('results').length,0);assert.equal(db.documents('projects').find(p=>String(p._id)===projectId)!.status,'FAILED');
    assert.equal(tts,1);assert.deepEqual(db.documents('projects').find(p=>String(p._id)===String(old._id)),old);console.log(JSON.stringify({scenario,status:'SAFE_STOP'}));process.exit(0);
  }
  if (audioOnly) { assert.equal(audio.project.status, 'COMPLETED'); assert.equal(db.documents('results').length, 0);  }
  else { const final = await result.process(projectId, ownerId, audio.narration.id); assert.equal(final.project.status, 'COMPLETED'); const row = db.documents('results')[0]!, probe = await processor.probe(resolve(root, String(row.videoPath))); assert.equal(probe.videoCodec, 'h264'); assert.equal(probe.audioCodec, 'aac'); const response = await fetch(base + `/api/projects/${projectId}/results/${row._id}/file`, { headers: { ...headers, Range: 'bytes=0-127' } }); assert.equal(response.status, 206); assert.match(response.headers.get('content-type')!, /video\/mp4/); const download=await fetch(base+`/api/projects/${projectId}/results/${row._id}/file`,{headers});assert.equal(download.status,200);const data=Buffer.from(await download.arrayBuffer());assert.equal(data.length,row.fileSize);assert.equal(createHash('sha256').update(data).digest('hex'),createHash('sha256').update(readFileSync(resolve(root,String(row.videoPath)))).digest('hex')); }
  assert.deepEqual([stt, translation, tts], [1, 1, 1]); assert.equal(createHash('sha256').update(readFileSync(input)).digest('hex'), hash);
  assert.deepEqual(db.documents('projects').find(p => String(p._id) === String(old._id)), old);
  assert.deepEqual(db.documents('translationattempts').filter(a => a.kind === 'QUOTA').map(a => a.count), [1, 1]);
  assert.equal(readdirSync(runtime.assets.directory).some(p => p.endsWith('.tmp')), false);
  assert.equal(runtime.snapshot().stopped,false);console.log(JSON.stringify({ scenario, mode,target,voiceName, status: 'COMPLETE', dispatches: [stt, translation, tts], media: audioOnly ? 'AUDIO_RESULT' : 'H264_AAC_MP4', realProvider: false, atlas: false }));
} finally { await new Promise<void>((r, j) => server.close(e => e ? j(e) : r())); }
