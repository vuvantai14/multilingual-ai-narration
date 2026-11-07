import assert from 'node:assert/strict';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeSync,writeFileSync,symlinkSync,readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import mongoose from 'mongoose';
import { memoryNative } from './e2e-memory-native.js';
import { prepareActualRun, type ActualPreparation, type Data } from '../../src/services/e2e-actual-runtime.js';

const scenario=process.argv[2]??'good',oid=(s:string)=>new mongoose.mongo.ObjectId(s);
mkdirSync('.tmp',{recursive:true});const root=mkdtempSync(resolve('.tmp','actual-final-')),runId='actual_'+randomUUID().replaceAll('-',''),projectId='1'.repeat(24),ownerId='2'.repeat(24),voiceId='3'.repeat(24),languageId='4'.repeat(24);
const mp4=Buffer.from([0,0,0,16,102,116,121,112,109,112,52,50,0,0,0,0]),mp3=Buffer.alloc(417);mp3.set([255,251,144,0]);const wav=Buffer.alloc(46);wav.write('RIFF');wav.writeUInt32LE(38,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(2,40);
Object.assign(process.env,{NODE_ENV:'test',MONGODB_URI:'mongodb://127.0.0.1:1/memory_only',JWT_ACCESS_SECRET:randomBytes(32).toString('hex'),JWT_REFRESH_SECRET:randomBytes(32).toString('hex'),JWT_ACCESS_EXPIRES_IN:'15m',JWT_REFRESH_EXPIRES_IN:'1d',UPLOAD_DIR:root,STT_PROVIDER:'gemini',TRANSLATION_PROVIDER:'gemini',TTS_PROVIDER:'gemini',CUSTOMER_TRANSLATION_ENABLED:'true',CUSTOMER_TRANSLATION_METHOD:'GEMINI_SIMPLE_V1',CUSTOMER_TRANSLATION_THINKING:'DEFAULT',GEMINI_API_KEY:'synthetic-fixture-only',S32_E2E_RUN_ID:runId,S32_E2E_PROJECT_ID:projectId,S32_E2E_OWNER_ID:ownerId});
delete process.env.CONTROLLED_PROVIDER_MODE;
const db=memoryNative();db.seed('users',{_id:oid(ownerId),role:'CUSTOMER',name:'fixture',status:'ACTIVE'});db.seed('languages',{_id:oid(languageId),code:'en',name:'English',isActive:true});db.seed('voices',{_id:oid(voiceId),languageId:oid(languageId),provider:'gemini',providerVoiceId:'Kore',name:'Kore',gender:'FEMALE',isActive:true});
const oldId='e'.repeat(24),oldProject={_id:oid(oldId),userId:oid('d'.repeat(24)),name:'old fixture',status:'COMPLETED',progress:100};db.seed('projects',oldProject);
const oldUnchanged=()=>assert.deepEqual(db.documents('projects').find(d=>String(d._id)===oldId),oldProject);
mongoose.set('autoCreate',false);mongoose.set('autoIndex',false);mongoose.set('bufferCommands',false);
mongoose.connection.readyState=1;mongoose.connection.db={collection:(name:string)=>db.collection(name)} as unknown as NonNullable<typeof mongoose.connection.db>;
mongoose.startSession=async()=>new db.MemorySession() as unknown as mongoose.mongo.ClientSession;
mongoose.connection.startSession=mongoose.startSession;
let stt=0,translation=0,tts=0,extract=0,render=0;
const input:ActualPreparation={manifest:{runId,projectId,ownerId,koreVoiceId:voiceId,media:{sha256:createHash('sha256').update(mp4).digest('hex'),bytes:mp4.length,duration:53.591655}},reads:db.reads,driver:db.driver as unknown as ActualPreparation['driver'],journal:resolve(root,`${runId}.jsonl`),workspace:process.cwd(),uploadRoot:root,connect:async()=>{},tools:{
  async probe(path){const data=readFileSync(path),video=path.endsWith('.mp4');return{duration:53.591655,fileSize:data.length,format:video?'mov,mp4':'mp3',hasVideo:video,hasAudio:true,videoCodec:video?'h264':undefined,audioCodec:video?'aac':path.endsWith('.wav')?'pcm_s16le':'mp3',width:video?640:undefined,height:video?360:undefined};},
  async encode(kind,fd){if(kind==='extract'){extract++;writeSync(fd,wav);}else{render++;if(scenario==='render-fail')throw Error('S32_E2E_ACTUAL_STORAGE_DENIED');writeSync(fd,mp4);}},
  async convert(){return mp3;},
  async verifyAudio(){return scenario!=='silent-audio';},
}};
process.env.S32_E2E_TEST_RUN_ENABLED='true';
if(scenario==='missing-audio-verifier')delete input.tools.verifyAudio;
if(scenario==='preload-invalid'){
  let connected=false;await assert.rejects(prepareActualRun({...input,manifest:'{}',connect:async()=>{connected=true;}},true));await assert.rejects(new db.Collection('projects').insertOne({_id:oid(projectId)}));assert.equal(connected,false);oldUnchanged();console.log(JSON.stringify({scenario,denied:true}));process.exit(0);
}
if(scenario==='off'){
  delete process.env.S32_E2E_TEST_RUN_ENABLED;assert.equal(await prepareActualRun(input),undefined);const {create}=await import('../../src/services/project.service.js');await create(ownerId,{name:'ordinary fixture',sourceLanguage:'vi'});assert.equal(db.documents('projects').length,2);assert.equal(db.calls.includes('projects:insertOne'),true);oldUnchanged();console.log(JSON.stringify({scenario,offUnchanged:true}));process.exit(0);
}
const runtime=(await prepareActualRun(input,true))!;
// All providers use their actual adapter logic with fake network transports.
const {GeminiSttProvider}=await import('../../src/services/stt/gemini-stt.provider.js');const {setSttProviderForTests}=await import('../../src/services/stt/stt.service.js');
setSttProviderForTests(new GeminiSttProvider({checkModel:async()=>{},upload:async path=>{assert.equal(path.startsWith(runtime.assets.directory),true);return{name:'fixture-file',uri:'fixture://audio',state:'ACTIVE'};},getFile:async()=>{throw Error('no poll expected');},deleteFile:async()=>{},transcribe:async()=>{stt++;return{status:'completed',output_text:'Di sản bảo tàng.',steps:[{type:'model_output',content:[{type:'text',text:'Di sản bảo tàng.',annotations:[{type:'word_info',text:'Di sản bảo tàng.',start_offset:'0s',end_offset:'2s'}]}]}]};}}));
const {GeminiTtsProvider}=await import('../../src/services/tts/gemini-tts.provider.js');const {setTtsProviderForTests}=await import('../../src/services/tts/tts.service.js');
setTtsProviderForTests(new GeminiTtsProvider({dispatch:async()=>{tts++;return{output_audio:{data:wav.toString('base64'),mime_type:'audio/wav'}};}}));
const {GeminiGroupTranslationProvider}=await import('../../src/services/translation/gemini-group-translation.provider.js');const {GroupTranslationService}=await import('../../src/services/translation/group-translation.service.js');const {GroupDraftStore}=await import('../../src/services/translation/group-draft-store.js');
const service=new GroupTranslationService(new GeminiGroupTranslationProvider({metadata:async()=>({supportedActions:['generateContent']}),generate:async(_model,value)=>{translation++;return{text:JSON.stringify({outcome:'translated',groups:value.groups.map(g=>({groupId:g.groupId,translatedText:'Museum heritage.'}))}),finishReason:'STOP'};}}),new GroupDraftStore());
const project=await import('../../src/services/project.service.js'),transcript=await import('../../src/services/transcription.service.js'),source=await import('../../src/services/source-language.service.js'),narration=await import('../../src/services/narration.service.js'),result=await import('../../src/services/result.service.js');
if(scenario==='preclaim-http-stop'){
  const {errorHandlerMiddleware:handler}=await import('../../src/middleware/error-handler.middleware.js'),{AppError}=await import('../../src/utils/app-error.js'),{snapshotE2eRun}=await import('../../src/services/e2e-test-run.js');
  let status=0;const response={status(value:number){status=value;return this;},json(){return this;}};
  handler(new AppError(404,'MEDIA_NOT_FOUND','fixture only'),{method:'GET',originalUrl:`/api/projects/${oldId}/media?token=must-not-be-recorded`,user:{id:ownerId}} as never,response as never,()=>{});
  assert.equal(status,404);await assert.rejects(project.create(ownerId,{name:'must not create',sourceLanguageMode:'AUTO'}));
  const state=snapshotE2eRun();assert.equal(state.stopped,true);assert.equal(state.initialized,false);assert.equal(state.evidenceRecorded,true);assert.equal(state.firstStop?.code,'MEDIA_NOT_FOUND');
  const journal=readFileSync(input.journal,'utf8');assert.match(journal,/ACTUAL_FIRST_REQUEST_STOP_/);assert.equal(journal.includes('must-not-be-recorded'),false);
  assert.equal(db.documents('projects').length,1);assert.equal(stt+translation+tts,0);oldUnchanged();console.log(JSON.stringify({scenario,denied:true,stt,translation,tts}));process.exit(0);
}
await project.create(ownerId,{name:'isolated fixture',sourceLanguageMode:'AUTO'});
if(scenario==='wrong-owner'){await assert.rejects(transcript.transcribe(projectId,'5'.repeat(24)));console.log(JSON.stringify({scenario,denied:true,stt}));process.exit(0);}
if(scenario==='wrong-project'){await assert.rejects(transcript.transcribe(oldId,ownerId));oldUnchanged();console.log(JSON.stringify({scenario,denied:true,stt}));process.exit(0);}
if(scenario==='unregistered'){await assert.rejects(runtime.writer('NotRegistered',{projectId,ownerId},async()=>assert.fail()));await assert.rejects(new db.Collection('projects').updateOne({_id:oid(oldId)},{$set:{status:'FAILED'}}));oldUnchanged();console.log(JSON.stringify({scenario,denied:true,stt}));process.exit(0);}
if(scenario==='payload-tamper'){
  const {Project}=await import('../../src/models/Project.js');await assert.rejects(runtime.writer('Media',{projectId,ownerId},()=>Project.updateOne({_id:oid(projectId)},{$set:{userId:oid('5'.repeat(24))}})));assert.equal(String(db.documents('projects').find(p=>String(p._id)===projectId)!.userId),ownerId);oldUnchanged();console.log(JSON.stringify({scenario,denied:true}));process.exit(0);
}
if(scenario==='concurrent'){
  let entered!:()=>void,release!:()=>void;const waiting=new Promise<void>(r=>{entered=r;}),blocked=new Promise<void>(r=>{release=r;});
  const one=db.reads.one.bind(db.reads);db.reads.one=async(...args)=>{if(args[0]==='users'){entered();await blocked;}return one(...args);};
  const first=runtime.writer('Media',{projectId,ownerId},async()=>{});const stopped=assert.rejects(first);await waiting;
  await assert.rejects(runtime.writer('Media',{projectId,ownerId},async()=>assert.fail('concurrent writer ran')));release();await stopped;
  assert.equal(db.documents('media').length,0);oldUnchanged();console.log(JSON.stringify({scenario,denied:true}));process.exit(0);
}
if(scenario==='no-lease'){
  await assert.rejects(runtime.assets.render('input.mp4','audio.mp3',runtime.assets.path('video')));assert.equal(render,0);oldUnchanged();console.log(JSON.stringify({scenario,denied:true}));process.exit(0);
}
if(scenario==='symlink-upload'){
  const outside=resolve(root,'isolated-outside'),parent=resolve(runtime.assets.directory,'..');mkdirSync(outside);mkdirSync(parent,{recursive:true});symlinkSync(outside,runtime.assets.directory,'junction');
}
if(scenario==='upload-attestation'){
  const many=db.reads.many.bind(db.reads);db.reads.many=async(...args)=>args[0]==='media'?[]:many(...args);
}
const {default:express}=await import('express');const {projectRouter}=await import('../../src/routes/project.routes.js');const {errorHandlerMiddleware}=await import('../../src/middleware/error-handler.middleware.js');const {signAccessToken}=await import('../../src/utils/jwt.js');
const app=express();app.use(express.json());app.use('/api/projects',projectRouter);app.use(errorHandlerMiddleware);const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
try{
  const address=server.address() as {port:number},form=new FormData(),body=Buffer.from(mp4);if(scenario==='hash-upload')body[15]=1;form.append('file',new Blob([body],{type:'video/mp4'}),'fixture.mp4');
  const response=await fetch('http://127.0.0.1:'+address.port+'/api/projects/'+projectId+'/media',{method:'POST',headers:{authorization:'Bearer '+signAccessToken(ownerId,'CUSTOMER')},body:form});const data=await response.json();if(['hash-upload','symlink-upload','upload-attestation'].includes(scenario)){assert.ok(response.status>=400);assert.equal(db.documents('media').length,scenario==='upload-attestation'?1:0);}else assert.equal(response.status,201,JSON.stringify(data));
}finally{await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));}
if(['hash-upload','symlink-upload','upload-attestation'].includes(scenario)){if(scenario==='symlink-upload')assert.equal(readdirSync(resolve(root,'isolated-outside')).length,0);oldUnchanged();console.log(JSON.stringify({scenario,denied:true,stt,translation,tts}));process.exit(0);}

async function expectedEmpty(path:string,code:string){
  const listener=app.listen(0,'127.0.0.1');await new Promise<void>(r=>listener.once('listening',r));
  try{const response=await fetch('http://127.0.0.1:'+(listener.address() as {port:number}).port+'/api/projects/'+projectId+path,{headers:{authorization:'Bearer '+signAccessToken(ownerId,'CUSTOMER')}});assert.equal(response.status,404);assert.equal((await response.json()).error.code,code);}
  finally{await new Promise<void>((r,j)=>listener.close(e=>e?j(e):r()));}
}
if(scenario==='browser-empty-reads')await expectedEmpty('/transcript','TRANSCRIPT_NOT_FOUND');

if(scenario==='batch-cross'){
  const {TranscriptSegment}=await import('../../src/models/TranscriptSegment.js');const original=TranscriptSegment.insertMany.bind(TranscriptSegment);TranscriptSegment.insertMany=((rows:Data[],options:unknown)=>original(rows.map(d=>({...d,transcriptId:oid(oldId)})),options as never)) as typeof TranscriptSegment.insertMany;
  await assert.rejects(transcript.transcribe(projectId,ownerId));assert.equal(db.documents('transcriptsegments').length,0);oldUnchanged();console.log(JSON.stringify({scenario,denied:true,stt,translation,tts}));process.exit(0);
}
const transcribed=await transcript.transcribe(projectId,ownerId);assert.equal(transcribed.project.status,'TRANSCRIBED');
await source.confirmSourceLanguage(projectId,ownerId,'vi',transcribed.transcript.revision);
if(scenario==='browser-empty-reads')await expectedEmpty('/translations/en?format=groups-v1','TRANSLATION_NOT_FOUND');
if(scenario.startsWith('commit-unknown'))db.commitUnknown(true,scenario==='commit-unknown-applied');
let draft;
try{draft=await service.customerGenerate(projectId,ownerId,'en');}catch(error){if(!scenario.startsWith('commit-unknown'))throw error;assert.equal(translation,0);assert.equal(db.documents('narrations').length,0);oldUnchanged();console.log(JSON.stringify({scenario,uncertain:true,stt,translation,tts}));process.exit(0);}
await service.approve(projectId,ownerId,draft.draftId,{outputDigest:draft.outputDigest,reviewed:true});
if(scenario==='overwrite'){
  const path=runtime.assets.path('audio');writeFileSync(path,'old audio');await assert.rejects(narration.generate(projectId,ownerId,'en',voiceId));assert.equal(readFileSync(path,'utf8'),'old audio');assert.equal(tts,0);oldUnchanged();console.log(JSON.stringify({scenario,denied:true,tts}));process.exit(0);
}
if(['silent-audio','missing-audio-verifier'].includes(scenario)){
  await assert.rejects(narration.generate(projectId,ownerId,'en',voiceId));assert.equal(tts,1);assert.equal(db.documents('narrations').length,0);assert.equal(db.documents('results').length,0);oldUnchanged();console.log(JSON.stringify({scenario,denied:true,tts}));process.exit(0);
}
const audio=await narration.generate(projectId,ownerId,'en',voiceId);
if(scenario==='outside-cleanup'){
  const oldPath=resolve(root,'old.mp4');writeFileSync(oldPath,'keep');await assert.rejects(runtime.writer('Result',{projectId,ownerId},async()=>{runtime.assets.cleanup(oldPath);}));assert.equal(readFileSync(oldPath,'utf8'),'keep');oldUnchanged();console.log(JSON.stringify({scenario,denied:true}));process.exit(0);
}
if(scenario==='outside-output'){
  const path=resolve(root,'outside.mp4');writeFileSync(path,'keep');await assert.rejects(runtime.writer('Result',{projectId,ownerId},()=>runtime.assets.render(runtime.assets.metadata('input').path,runtime.assets.metadata('audio').path,path)));assert.equal(render,0);assert.equal(readFileSync(path,'utf8'),'keep');oldUnchanged();console.log(JSON.stringify({scenario,denied:true}));process.exit(0);
}
if(scenario==='render-fail'){await assert.rejects(result.process(projectId,ownerId,audio.narration.id));assert.equal(db.documents('results').length,0);oldUnchanged();console.log(JSON.stringify({scenario,denied:true,stt,translation,tts,render}));process.exit(0);}
const final=await result.process(projectId,ownerId,audio.narration.id);
assert.equal(final.project.status,'COMPLETED');assert.equal(stt,1);assert.equal(translation,1);assert.equal(tts,1);assert.equal(extract,1);assert.equal(render,1);assert.equal(db.calls.includes('DESTRUCTIVE_DELETE'),false);
const persisted=db.documents('results')[0]!;assert.equal(readFileSync(resolve(root,String(persisted.videoPath))).equals(mp4),true);
await assert.rejects(narration.generate(projectId,ownerId,'en',voiceId));await assert.rejects(prepareActualRun(input,true));oldUnchanged();
console.log(JSON.stringify({scenario,status:'COMPLETE',stt,translation,tts,extract,render,projects:db.documents('projects').filter(p=>String(p._id)===projectId).length,jobs:db.documents('processingjobs').map(j=>j.status),quota:db.documents('translationattempts').filter(a=>a.kind==='QUOTA').map(a=>a.count),sourcePath:relative(root,runtime.assets.metadata('input').path)}));
