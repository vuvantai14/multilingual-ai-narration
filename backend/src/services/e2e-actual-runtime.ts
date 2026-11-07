import { AsyncLocalStorage } from 'node:async_hooks';
import mongoose from 'mongoose';
import { resolve,relative,isAbsolute,sep,basename,dirname } from 'node:path';
import { mkdirSync,lstatSync,realpathSync } from 'node:fs';
import { installScopedWriteGuard, exclusiveWriteJournal, nativeWriteFingerprint } from './scoped-write-guard.js';
import { customerTranslationQuota } from '../config/customer-translation-quota.js';
import { QuotaNativePolicy, type QuotaIdentity, type QuotaSession } from './e2e-quota-transaction.js';
import type { E2eRuntimeBinding } from './e2e-runtime-boundary.js';
import { registerPreparedE2eBoundary, attestComposedStartup } from './e2e-runtime-boundary.js';
import { registerE2eInferenceObserver, registerE2eInferenceFailureObserver, registerE2eStopObserver, stopE2eOnRequestError, type E2eStage } from './e2e-test-run.js';
import { GeminiSttError } from './stt/gemini-stt.provider.js';
import { AppError } from '../utils/app-error.js';
import { digest,revision,candidateGroups,validatePlan,outputDigest } from './translation/group-plan.js';
import { translationProviderInput,assertSimpleInput } from './translation/gemini-simple-contract.js';
import { customerTranslationModel } from '../config/translation-model.js';
import { E2eActualStorage, type ActualTools } from './e2e-actual-storage.js';
import { MANUAL_RUN_CONTRACT, ManualRunSelections } from './e2e-manual-policy.js';
import { resolveTranscribedLanguage, type SourceLanguageState, type LanguageDetection } from './source-language-contract.js';

export interface ActualSession extends QuotaSession { endSession():Promise<void> }
export type Data = Record<string,unknown>;
export type ActualManifest = {
  runId:string;projectId:string;ownerId:string;koreVoiceId:string;
  media?:{sha256:string;bytes:number;duration:number};
  contract?:typeof MANUAL_RUN_CONTRACT;
};
export interface ActualReads {
  one(collection:string,filter:Data,session?:unknown,majority?:boolean):Promise<Data|null>;
  many(collection:string,filter:Data,session?:unknown):Promise<Data[]>;
}
export type E2eActualAssets = E2eActualStorage;
const id=(v:unknown)=>v instanceof mongoose.mongo.ObjectId?v.toHexString():String(v??'');
const row=(v:unknown):Data=>v && typeof v==='object'&&!Array.isArray(v)?v as Data:{};
export const cloneData=<T>(v:T):T=>mongoose.mongo.BSON.deserialize(mongoose.mongo.BSON.serialize({v})).v as T;
const same=(a:unknown,b:unknown)=>nativeWriteFingerprint('value',[a])===nativeWriteFingerprint('value',[b]);
const denied=()=>new Error('S32_E2E_ACTUAL_WRITE_DENIED');
const uncertain=()=>new Error('S32_E2E_TRANSACTION_UNCERTAIN');
const safeFilter=(value:unknown):void=>{
  if(value==null||typeof value!=='object'||value instanceof mongoose.mongo.ObjectId||value instanceof Date)return;
  if(Array.isArray(value)){for(const child of value)safeFilter(child);return;}
  for(const[k,v]of Object.entries(value)){if(k.startsWith('$')&&!['$and','$or','$eq','$ne','$in','$nin','$lt','$lte','$gt','$gte','$exists'].includes(k)||!k.startsWith('$')&&!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(k))throw denied();safeFilter(v);}
};
const MODELS:Record<string,string>={projects:'Project',media:'Media',processingjobs:'ProcessingJob',transcripts:'Transcript',transcriptsegments:'TranscriptSegment',translationattempts:'TranslationAttempt',translations:'Translation',narrations:'Narration',results:'Result',activitylogs:'ActivityLog'};
const WRITERS:Record<string,string[]>={Project:['projects','activitylogs'],Media:['media','projects','activitylogs'],STT:['projects','processingjobs','transcripts','transcriptsegments','activitylogs'],Source:['projects','transcripts'],Translation:['projects','translationattempts'],Approval:['projects','transcripts','translations','translationattempts','activitylogs'],TTS:['projects','processingjobs','transcripts','translations','narrations','activitylogs'],Result:['projects','processingjobs','transcripts','translations','narrations','results','activitylogs']};
const ORDER=['Project','Media','STT','Source','Translation','Approval','TTS','Result'];
const FIELDS:Record<string,string[]>={projects:['status','progress','sourceLanguageMode','sourceLanguage','sourceLanguageStatus','detectedSourceLanguage','targetOperation','updatedAt'],media:['originalName','fileName','mediaType','mimeType','fileSize','storagePath','duration','updatedAt','createdAt','__v'],processingjobs:['status','progress','errorMessage','completedAt','diagnostics','updatedAt','sttEvidence'],transcripts:['languageCode','sourceLanguageStatus','fullText','status','revision','updatedAt'],translationattempts:['phase','state','draftJson','updatedAt','diagnosticCode','providerHttpStatus','executionVersion','transportDiagnostic','providerDiagnostic','quotaReserved','quotaDay','failedAt'],translations:['revision','updatedAt'],narrations:['revision','updatedAt']};
type Lease={name:string;active:boolean;audits:Array<()=>Promise<void>>;session?:ActualSession;stamp?:string;touched:Map<string,{collection:string;id:unknown;expected:Data}>;writes:number;quota?:QuotaNativePolicy};

/** The actual service/driver coordinator. Native grants are compiled once from
 * independently read fresh records + captured provider output, then fingerprinted
 * before delegation. No request may register a writer or arbitrary operation. */
export class ActualE2eRuntime {
  readonly binding:E2eRuntimeBinding;
  readonly assets:E2eActualStorage;
  private readonly ctx=new AsyncLocalStorage<Lease>();
  private readonly records=new Map<string,string>();
  private readonly grants=new Set<string>();
  private readonly inserted=new Map<string,number>();
  private readonly completed=new Set<string>();
  private readonly facts=new Map<string,unknown>();
  private sttFailure?:{code:string;evidence:NonNullable<GeminiSttError['evidence']>};
  private terminalFailure?:{writer:string;details:Data};
  private queue:Promise<unknown>=Promise.resolve();
  private leased=false;private halted=false;private ready=false;private connected=false;
  private quotaUsed=false; private projectLock=new Set<string>();
  private readonly selection?:ManualRunSelections;
  constructor(readonly manifest:Readonly<ActualManifest>,private readonly reads:ActualReads,private readonly record:(event:string)=>void,workspace:string,uploadRoot:string,tools:ActualTools){
    this.records.set(manifest.projectId,'projects');
    if(manifest.contract===MANUAL_RUN_CONTRACT)this.selection=new ManualRunSelections(record);
    this.assets=new E2eActualStorage(workspace,uploadRoot,manifest,record,tools,()=>this.current().name);
    this.binding={...manifest,writer:(scope,work,name)=>this.writer(name,scope,work),record,diagnostics:()=>this.snapshot(),
      transaction:(s,w,o)=>this.transaction(s,w,o),audit:w=>this.audit(w),assets:this.assets,
      quota:(s,i,w)=>this.quota(s,i,w),quotaAttested:(s,i)=>this.current().quota!.attestCommit(s,i),
      failure:(name,details)=>this.attestFailure(name,details),
    };
  }
  private current():Lease {const ctx=this.ctx.getStore();if(!this.ready||this.halted||!ctx?.active)throw denied();return ctx;}
  private target(){const value=this.selection?.target??(!this.selection?'en':undefined);if(!value)throw denied();return value;}
  private source(){const value=this.selection?.source??(!this.selection?'vi':undefined);if(!value)throw denied();return value;}
  private voice(){const value=this.selection?.voiceId??(!this.selection?this.manifest.koreVoiceId:undefined);if(!value)throw denied();return value;}
  snapshot(){return{ready:this.healthy(),stopped:this.halted,completed:[...this.completed],source:this.selection?.source??null,target:this.selection?.target??null,voiceClaimed:!!this.selection?.voiceId,mediaClaimed:this.assets.claimed()};}
  healthy(){return this.ready&&!this.halted;}
  async initialize(connect:()=>Promise<void>):Promise<void>{
    if(this.ready||this.connected)throw denied();
    this.ready=true;this.record('ACTUAL_READY');
    registerPreparedE2eBoundary(this.binding);attestComposedStartup(this.binding,()=>this.healthy());
    registerE2eInferenceObserver((s,v)=>this.capture(s,v));
    registerE2eInferenceFailureObserver(async(stage,error)=>{
      if(stage!=='STT')return; // Other stage policies are unchanged by this fix.
      // Attest only an actual provider-adapter failure inside the active STT
      // lease. No request payload or arbitrary writer can mint terminal grants.
      const ctx=this.current();
      if(ctx.name!=='STT'||this.sttFailure||this.facts.has('STT'))throw denied();
      if(!(error instanceof GeminiSttError)||!error.evidence)return;
      const e=error.evidence;
      if(e.contract!=='GEMINI_STT_EVIDENCE_V1'||!['FAILED_PRE_DISPATCH','FAILED_RESPONSE','UNCERTAIN'].includes(e.outcome)||e.retryAllowed!==false)throw denied();
      this.sttFailure={code:error.code,evidence:cloneData(e)};
      this.record(`ACTUAL_STT_FAILURE_${error.code}_${e.outcome}`);
    });
    // Reuse the already-open native journal. A pre-project HTTP failure must
    // leave evidence WITHOUT initializing/claiming the inference run.
    registerE2eStopObserver(f=>{this.halted=true;this.record(`ACTUAL_FIRST_REQUEST_STOP_${JSON.stringify(f)}`);});
    try{await connect();this.connected=true;this.record('ACTUAL_CONNECTED');}catch(e){this.halted=true;throw e;}
  }
  async writer<T>(name:string|undefined,scope:{projectId:string;ownerId:string},work:()=>Promise<T>):Promise<T>{
    if(scope.projectId!==this.manifest.projectId||scope.ownerId!==this.manifest.ownerId||!name||!WRITERS[name]||!this.connected||this.halted)throw denied();
    const inherited=this.ctx.getStore();
    if(inherited?.active&&inherited.name===name)return work(); // Multer + metadata share ONE request lease.
    if(this.leased||ORDER[this.completed.size]!==name)throw denied();
    const lease:Lease={name,active:true,audits:[],touched:new Map(),writes:0};this.leased=true;
    try{const actor=await this.reads.one('users',{_id:new mongoose.mongo.ObjectId(this.manifest.ownerId)});if(actor?.role!=='CUSTOMER'||actor.status!=='ACTIVE'||actor.deletedAt!=null)throw denied();
      if(name==='TTS'&&!this.selection){const voice=await this.reads.one('voices',{_id:new mongoose.mongo.ObjectId(this.manifest.koreVoiceId)}),language=voice?await this.reads.one('languages',{_id:voice.languageId}):null;if(voice?.provider!=='gemini'||voice.providerVoiceId!=='Kore'||voice.isActive!==true||language?.code!=='en'||language.isActive!==true)throw denied();}
      return await this.ctx.run(lease,async()=>{
      this.record(`ACTUAL_WRITER_${name}`);const result=await work();for(const audit of lease.audits)await audit();await this.queue;
      if(lease.session||!lease.writes)throw denied();await this.verifyStage(name);this.record(`ACTUAL_DONE_${name}`);this.completed.add(name);if(name==='STT'&&this.selection){const p=await this.project();if(p.sourceLanguageStatus==='CONFIRMED'){this.selection.claimSource(p.sourceLanguage);this.completed.add('Source');}}return result;
    });}catch(e){this.halted=true;const value=e instanceof AppError?e.code:e instanceof Error?e.message:'';const reason=/^[A-Z][A-Z0-9_]{0,79}$/.test(value)?value:'S33_WRITER_FAILED';stopE2eOnRequestError({method:'POST',code:reason,status:e instanceof AppError?e.statusCode:undefined});try{this.record(`ACTUAL_STOP_${name}_${reason}`);}catch{/*stopped*/}throw e;}finally{lease.active=false;this.leased=false;}
  }
  async audit(work:()=>Promise<unknown>):Promise<void>{
    const ctx=this.current();return new Promise<void>((resolve,reject)=>{ctx.audits.push(async()=>{try{await work();resolve();}catch(e){reject(e);throw e;}});});
  }
  private attestFailure(writer:string,details:Data):void{
    const ctx=this.current();
    if(ctx.name!==writer||ctx.session||ctx.quota||this.terminalFailure)throw denied();
    const allowed:Record<string,readonly string[]>={
      TTS:['TTS_NOT_CONFIGURED','TTS_TIMEOUT','TTS_UNCERTAIN','TTS_CONVERSION_TIMEOUT','TTS_CONVERSION_FAILED','TTS_INVALID_RESPONSE','TTS_TEXT_TOO_LARGE','TTS_PROVIDER_ERROR'],
      Result:['FFMPEG_NOT_AVAILABLE','MEDIA_PROCESSING_TIMEOUT','MEDIA_PROCESSING_INVALID_OUTPUT','MEDIA_PROCESSING_SOURCE_CHANGED','MEDIA_PROCESSING_FAILED'],
    };
    if(writer==='Translation'){
      if(!['FAILED_PRE_DISPATCH','FAILED_RESPONSE','UNCERTAIN'].includes(String(details.state))||!/^TRANSLATION_[A-Z_]{1,64}$/.test(String(details.diagnosticCode)))throw denied();
      if(Object.keys(details).some(k=>!['state','phase','diagnosticCode','providerHttpStatus','providerDiagnostic','transportDiagnostic'].includes(k)))throw denied();
    }else if(!allowed[writer]?.includes(String(details.code))||Object.keys(details).some(k=>!['code','diagnostics'].includes(k)))throw denied();
    this.terminalFailure={writer,details:cloneData(details)};
    this.record(`ACTUAL_FAILURE_${writer}_${String(details.code??details.diagnosticCode)}_${String(details.state??'FAILED')}`);
  }
  async capture(stage:E2eStage,value:unknown):Promise<void>{
    const ctx=this.current();if(ctx.name!==({STT:'STT',TRANSLATION:'Translation',TTS:'TTS'} as const)[stage]||this.facts.has(stage))throw denied();
    this.facts.set(stage,cloneData(value));
    if(stage==='TTS')this.assets.verifyAudio(row(value).audio as Uint8Array);
  }
  async transaction<T>(session:ActualSession,work:()=>Promise<T>,options?:unknown):Promise<T>{
    const ctx=this.current();if(ctx.session||session.inTransaction())throw denied();ctx.session=session;ctx.touched.clear();
    try{
      session.startTransaction((options??{readConcern:{level:'snapshot'},writeConcern:{w:'majority',j:true}}) as Parameters<ActualSession['startTransaction']>[0]);
      ctx.stamp=String(session.serverSession?.txnNumber??'');if(!/^\d+$/.test(ctx.stamp))throw uncertain();
      const result=await work();await this.queue;this.record('ACTUAL_COMMIT_REQUESTED');await session.commitTransaction();
      if(session.inTransaction())throw uncertain();
      for(const value of ctx.touched.values()){const committed=await this.reads.one(value.collection,{_id:value.id},undefined,true);if(!committed||!same(committed,value.expected))throw uncertain();}
      this.record('ACTUAL_COMMITTED_ATTESTED');return result;
    }catch(error){this.halted=true;try{if(session.inTransaction())await session.abortTransaction();}catch{/*ambiguous*/}throw new Error('S32_E2E_TRANSACTION_UNCERTAIN',{cause:error});}finally{ctx.session=undefined;ctx.stamp=undefined;ctx.touched.clear();}
  }
  private async quota<T>(session:QuotaSession,identity:QuotaIdentity,work:()=>Promise<T>):Promise<T>{
    const ctx=this.current();if(ctx.name!=='Translation'||this.quotaUsed||identity.ownerId!==this.manifest.ownerId||identity.projectId!==this.manifest.projectId||identity.targetLanguage!==this.target())throw denied();this.quotaUsed=true;
    const key=digest(['CUSTOMER_TRANSLATION_V1',identity.ownerId,identity.projectId,this.target(),identity.sourceRevision]);
    if(this.records.get(key)!=='translationattempts')throw denied();
    const attempt=await this.reads.one('translationattempts',{_id:key});if(!attempt)throw denied();
    const limits=customerTranslationQuota();
    const policy=new QuotaNativePolicy({...identity,runId:this.manifest.runId,binding:String(attempt.binding),...limits},(id,s)=>this.reads.one('translationattempts',{_id:id},s),this.record);
    ctx.quota=policy;
    try{return await policy.run(session,identity,work);}finally{ctx.quota=undefined;}
  }
  async write<T>(db:string,col:string,method:string,args:readonly unknown[],work:()=>Promise<T>):Promise<T>{
    const ctx=this.current();
    if(db!=='multilingual_ai_narration'||!WRITERS[ctx.name]!.includes(col))throw denied();
    if(ctx.quota)return ctx.quota.write(db,col,method,args,work);
    // Serialize actual driver operations incl. best-effort audit inserts.
    const pending=this.queue.then(()=>this.checkedWrite(ctx,col,method,args,work)).catch(e=>{this.halted=true;throw e;});this.queue=pending.catch(()=>{});return pending;
  }
  private async checkedWrite<T>(ctx:Lease,col:string,method:string,args:readonly unknown[],work:()=>Promise<T>):Promise<T>{
    if(!ctx.active||this.halted||++ctx.writes>80||!['insertOne','insertMany','updateOne','findOneAndUpdate','deleteMany'].includes(method))throw denied();
    if(this.sttFailure&&(ctx.name!=='STT'||!['projects','processingjobs'].includes(col)||method!=='updateOne'||row(row(args[1]).$set).status!=='FAILED'))throw denied();
    if(this.terminalFailure){const t=this.terminalFailure;const update=row(row(args[1]).$set);
      if(ctx.name!==t.writer||method!=='updateOne'||(t.writer==='Translation'?col!=='translationattempts'||update.state!==t.details.state:!['projects','processingjobs'].includes(col)||update.status!=='FAILED'))throw denied();
    }
    const options=row(args[['insertOne','insertMany','deleteMany'].includes(method)?1:2]);
    if(method!=='insertOne'&&method!=='insertMany')safeFilter(args[0]);
    if(options.session!==ctx.session && options.session!==undefined || options.session===undefined&&ctx.session)throw denied();
    if(options.bypassDocumentValidation||options.writeConcern&&row(options.writeConcern).w===0||options.ordered===false)throw denied();
    if(method==='deleteMany'){
      const filter=row(args[0]);if(ctx.name!=='STT'||!ctx.session||Object.keys(filter).length!==1||this.records.get(id(filter.transcriptId))!=='transcripts'||(await this.reads.many('transcriptsegments',filter,ctx.session)).length)throw denied();
      const key='empty:'+id(filter.transcriptId);if(this.grants.has(key))throw denied();this.grants.add(key);this.record('ACTUAL_EMPTY_SEGMENTS');return{acknowledged:true,deletedCount:0} as T;
    }
    const filter=row(args[0]);let before:Data|null=null;let expected:Data|undefined;
    if(method==='insertMany'){
      if(ctx.name!=='STT'||col!=='transcriptsegments'||!ctx.session||!Array.isArray(args[0]))throw denied();
      const rows=args[0] as Data[],fact=row(this.facts.get('STT')),segments=fact.segments as Data[];
      if(!segments||rows.length!==segments.length||rows.length>20000||new Set(rows.map(d=>id(d._id))).size!==rows.length)throw denied();
      for(const[d,index]of rows.map((d,i)=>[d,i] as const)){
        if(this.records.get(id(d.transcriptId))!=='transcripts'||d.sequence!==index+1||d.text!==String(segments[index]!.text).trim()||d.startTime!==segments[index]!.start||d.endTime!==segments[index]!.end)throw denied();
        await this.validateInsert(col,d,ctx);
      }
    }else if(method==='insertOne')await this.validateInsert(col,filter,ctx);
    else {
      if(col==='media'&&options.upsert){
        if(ctx.name!=='Media'||id(filter.projectId)!==this.manifest.projectId||await this.reads.one(col,filter,ctx.session))throw denied();
        const identity=new mongoose.mongo.ObjectId();filter._id=identity;const update=row(args[1]);update.$setOnInsert={...row(update.$setOnInsert),_id:identity};
        expected=this.apply({...filter},update,true);await this.validateInsert(col,expected,ctx);
      }else{
        if(options.upsert)throw denied();
        before=await this.readScoped(col,filter,ctx.session);if(!before)throw denied();
        const update=row(args[1]);if(Object.keys(update).some(k=>!['$set','$unset','$inc','$setOnInsert'].includes(k)))throw denied();
        for(const[op,fields]of Object.entries(update)){const bad=Object.keys(row(fields)).find(k=>op==='$setOnInsert'?!['createdAt','__v'].includes(k):!FIELDS[col]?.includes(k));if(bad)throw new Error(`S32_E2E_ACTUAL_WRITE_DENIED:${col}:${op}:${bad.replace(/[^a-zA-Z0-9_.]/g,'').slice(0,60)}`);}
        expected=this.apply(before,update);await this.validateChange(col,before,expected,ctx);
        // Compile exact identity/state/revision CAS from independently read record.
        filter._id=before._id;if(before.revision!==undefined)filter.revision=before.revision;if(before.status!==undefined)filter.status=before.status;
        if(col==='projects')filter.userId=new mongoose.mongo.ObjectId(this.manifest.ownerId);
        else if(before.projectId!==undefined)filter.projectId=before.projectId;
      }
    }
    const key=ctx.name+':'+col+':'+method+':'+nativeWriteFingerprint(method,args);
    if(!ctx.active||ctx.session&&(!ctx.session.inTransaction()||ctx.stamp!==String(ctx.session.serverSession?.txnNumber)))throw denied();
    if(this.grants.has(key))throw denied();this.grants.add(key);this.record(`ACTUAL_NATIVE_${ctx.name}_${col}_${method}_${digest(key)}`);
    try{
      const result=await work(),ack=row(result);
      if(method==='insertMany'){
        const rows=args[0] as Data[];if(ack.acknowledged!==true||ack.insertedCount!==rows.length)throw uncertain();for(const doc of rows)await this.remember(col,doc._id,ctx);
      }else{
        if(method==='insertOne' ? ack.acknowledged!==true||id(ack.insertedId)!==id(filter._id) : method==='updateOne' ? ack.acknowledged!==true||ack.matchedCount!==1 : !result)throw uncertain();
        await this.remember(col,filter._id,ctx,expected??(method==='insertOne'?filter:undefined));
      }
      return result;
    }catch(e){this.halted=true;throw e;}
  }
  private apply(before:Data,update:Data,insert=false):Data{
    const after=cloneData(before);if(insert)for(const[k,v]of Object.entries(row(update.$setOnInsert)))if(after[k]===undefined)after[k]=v;
    for(const[k,v]of Object.entries(row(update.$set)))after[k]=v;for(const k of Object.keys(row(update.$unset)))delete after[k];
    for(const[k,v]of Object.entries(row(update.$inc))){if(typeof v!=='number')throw denied();after[k]=Number(after[k]??0)+v;}return after;
  }
  private async project(session?:unknown){const value=await this.reads.one('projects',{_id:new mongoose.mongo.ObjectId(this.manifest.projectId)},session);if(!value||id(value.userId)!==this.manifest.ownerId)throw denied();return value;}
  private async readScoped(col:string,filter:Data,session?:unknown):Promise<Data|null>{
    if(col==='projects'){if(id(filter._id)!==this.manifest.projectId)throw denied();}
    else if(filter._id!==undefined){if(this.records.get(id(filter._id))!==col)throw denied();}
    else if(id(filter.projectId)!==this.manifest.projectId)throw denied();
    const doc=await this.reads.one(col,filter,session);if(doc){await this.project(session);if(col!=='projects'&&id(doc.projectId)!==this.manifest.projectId)throw denied();}return doc;
  }
  private async validateInsert(col:string,doc:Data,ctx:Lease){
    if(!doc._id||this.records.has(id(doc._id))&&col!=='projects'||await this.reads.one(col,{_id:doc._id},ctx.session))throw denied();
    if(col==='projects'){
      if(ctx.name!=='Project'||id(doc._id)!==this.manifest.projectId||id(doc.userId)!==this.manifest.ownerId||doc.status!=='DRAFT')throw denied();
      if(this.selection){if(doc.sourceLanguageMode==='MANUAL'){this.selection.claimSource(doc.sourceLanguage);if(doc.sourceLanguageStatus!=='CONFIRMED')throw denied();}else if(doc.sourceLanguageMode!=='AUTO'||doc.sourceLanguage!=null||doc.sourceLanguageStatus!=='PENDING_DETECTION')throw denied();}
      else if(doc.sourceLanguageMode!=='AUTO'||doc.sourceLanguage!=null)throw denied();
    }else{
      await this.project(ctx.session);
      if(col==='activitylogs'){if(id(doc.userId)!==this.manifest.ownerId||!this.records.has(id(doc.entityId)))throw denied();}
      else if(col==='transcriptsegments'){if(this.records.get(id(doc.transcriptId))!=='transcripts')throw denied();}
      else if(id(doc.projectId)!==this.manifest.projectId)throw denied();
    }
    if(doc.ownerId!==undefined&&doc.ownerId!==this.manifest.ownerId||doc.userId!==undefined&&id(doc.userId)!==this.manifest.ownerId||doc.targetLanguage!==undefined&&doc.targetLanguage!==this.target())throw denied();
    for(const key of ['transcriptId','translationId','narrationId','sourceTranscriptId','sourceTranslationId','sourceNarrationId'])if(doc[key]!==undefined){
      const kind=key.toLowerCase().includes('transcript')?'transcripts':key.toLowerCase().includes('translation')?'translations':'narrations';
      if(this.records.get(id(doc[key]))!==kind)throw denied();
      const parent=await this.reads.one(kind,{_id:doc[key]},ctx.session);if(!parent||id(parent.projectId)!==this.manifest.projectId)throw denied();
      const revisionField=kind==='transcripts'?'sourceTranscriptRevision':kind==='translations'?'sourceTranslationRevision':'sourceNarrationRevision';
      if(doc[revisionField]!==undefined&&doc[revisionField]!==parent.revision)throw denied();
    }
    if(col==='transcripts'){const f=row(this.facts.get('STT'));const p=await this.project(ctx.session),source=resolveTranscribedLanguage(p as SourceLanguageState,f.languageDetection as LanguageDetection|undefined);if(!ctx.session||doc.revision!==1||doc.fullText!==String(f.text).trim()||doc.languageCode!==source.sourceLanguage||doc.sourceLanguageStatus!==source.sourceLanguageStatus)throw denied();}
    if(col==='media')this.assets.validateMetadata('input',doc);
    if(col==='translationattempts'){
      if(ctx.name!=='Translation'||doc.state!=='CLAIMED'||doc.phase!=='PREPARING'||doc.executionVersion!==1||!/^[a-f0-9]{64}$/.test(String(doc.binding)))throw denied();
      if(id(doc._id)!==digest(['CUSTOMER_TRANSLATION_V1',this.manifest.ownerId,this.manifest.projectId,this.target(),doc.sourceRevision]))throw denied();
      const {loadSource}=await import('./translation/group-translation.service.js');const source=await loadSource(this.manifest.projectId,ctx.session as mongoose.ClientSession|undefined),groups=candidateGroups(source),input=translationProviderInput(source,this.target(),groups);
      assertSimpleInput(input);
      const parts=[source.transcriptRevision,revision(source),digest(input),digest(input.groups.map(g=>g.groupId)),customerTranslationModel().model,'DEFAULT',8192,120000,0,'gemini','GEMINI_SIMPLE_V1'];
      if(source.languageCode!==this.source()||doc.sourceRevision!==revision(source)||doc.binding!==digest(parts))throw denied();
    }
    if(col==='translations'){
      const attempts=await this.reads.many('translationattempts',{projectId:this.manifest.projectId,targetLanguage:this.target()},ctx.session);const saved=attempts.find(a=>a.state==='DRAFT');let draft:Data;try{draft=JSON.parse(String(saved?.draftJson));}catch{throw denied();}
      const groups=(doc.groups as Data[]).map(g=>({...g,sourceSegmentIds:(g.sourceSegmentIds as unknown[]).map(id)}));
      if(ctx.name!=='Approval'||doc.sourceRevision!==draft.sourceRevision||!same(groups,draft.groups)||doc.fullText!==(draft.groups as Data[]).map(g=>g.translatedText).join(' ')||id(row(doc.review).reviewedBy)!==this.manifest.ownerId)throw denied();
    }
    if(col==='narrations'){if(ctx.name!=='TTS'||id(doc.voiceId)!==this.voice()||doc.languageCode!==this.target()||doc.provider!=='gemini')throw denied();this.assets.validateMetadata('audio',doc);}
    if(col==='results'){if(ctx.name!=='Result'||doc.languageCode!==this.target())throw denied();this.assets.validateMetadata('video',doc);}
    const cap=col==='processingjobs'?3:col==='activitylogs'?30:col==='transcriptsegments'?20000:1;
    const count=this.inserted.get(col)??0;if(count>=cap)throw denied();this.inserted.set(col,count+1);
    if(col==='processingjobs'&&ctx.name==='TTS'&&this.selection){const voice=await this.reads.one('voices',{_id:doc.voiceId},ctx.session),language=voice?await this.reads.one('languages',{_id:voice.languageId},ctx.session):null;if(voice?.provider!=='gemini'||voice.isActive!==true||language?.isActive!==true)throw denied();this.selection.claimVoice(id(doc.voiceId),voice.providerVoiceId,language.code);}
    if(col==='processingjobs'&&(({STT:'TRANSCRIPTION',TTS:'TTS',Result:'VIDEO_PROCESSING'} as Record<string,string>)[ctx.name]!==doc.type||doc.status!=='PROCESSING'))throw denied();
    const Model=mongoose.models[MODELS[col]!];if(!Model)throw denied();
    const allowed=new Set(Object.keys(Model.schema.paths).map(k=>k.split('.')[0]));if(Object.keys(doc).some(k=>!allowed.has(k)))throw denied();await new Model(doc).validate();
  }
  private async validateChange(col:string,before:Data,after:Data,ctx:Lease){
    if(this.terminalFailure){
      const {writer,details}=this.terminalFailure;
      if(writer!==ctx.name||ctx.session||after.progress!==before.progress)throw denied();
      if(writer==='Translation'){
        if(col!=='translationattempts'||before.state!=='CLAIMED'||before.ownerId!==this.manifest.ownerId||before.projectId!==this.manifest.projectId||before.targetLanguage!==this.target()||before.phase!==details.phase||after.state!==details.state)throw denied();
        const mutable=['state','failedAt','updatedAt',...Object.keys(details)];
        if(Object.keys({...before,...after}).some(k=>!mutable.includes(k)&&!same(before[k],after[k])))throw denied();
        for(const[k,v]of Object.entries(details))if(v!=null&&!same(after[k],v))throw denied();
        if(!(after.failedAt instanceof Date)||!Number.isFinite(after.failedAt.getTime()))throw denied();
      }else{
        if(!['projects','processingjobs'].includes(col)||after.status!=='FAILED')throw denied();
        const fields=col==='projects'?['status','updatedAt']:['status','errorMessage','completedAt','diagnostics','updatedAt'];
        if(Object.keys({...before,...after}).some(k=>!fields.includes(k)&&!same(before[k],after[k])))throw denied();
        const type=writer==='TTS'?'TTS':'VIDEO_PROCESSING',status=writer==='TTS'?'GENERATING_AUDIO':'PROCESSING_VIDEO';
        if(col==='processingjobs'){
          if(before.type!==type||before.status!=='PROCESSING'||before.targetLanguage!==this.target()||after.errorMessage!==details.code||!(after.completedAt instanceof Date)||!Number.isFinite(after.completedAt.getTime()))throw denied();
          if(details.diagnostics&&!same(after.diagnostics,details.diagnostics))throw denied();
        }else{
          const jobs=await this.reads.many('processingjobs',{projectId:new mongoose.mongo.ObjectId(this.manifest.projectId)});
          if(before.status!==status||!jobs.some(j=>this.records.get(id(j._id))==='processingjobs'&&j.type===type&&j.status==='FAILED'&&j.errorMessage===details.code))throw denied();
        }
      }
      const Model=mongoose.models[MODELS[col]!];if(!Model)throw denied();await new Model(after).validate();return;
    }
    if(ctx.name==='STT'&&after.status==='FAILED'&&['projects','processingjobs'].includes(col)){
      // Terminal evidence is the only exceptional failure write: still exact
      // run/owner/project/job, CAS and one-use grants, never new artifacts/retry.
      const failure=this.sttFailure;
      if(!failure||ctx.session||this.facts.has('STT')||after.progress!==before.progress)throw denied();
      const fields=col==='projects'?['status','updatedAt']:['status','errorMessage','completedAt','sttEvidence','updatedAt'];
      if(Object.keys({...before,...after}).some(k=>!fields.includes(k)&&!same(before[k],after[k])))throw denied();
      if(col==='processingjobs'){
        if(before.type!=='TRANSCRIPTION'||before.status!=='PROCESSING'||after.errorMessage!==failure.code||!same(after.sttEvidence,failure.evidence)||!(after.completedAt instanceof Date)||!Number.isFinite(after.completedAt.getTime()))throw denied();
      }else{
        const jobs=await this.reads.many('processingjobs',{projectId:new mongoose.mongo.ObjectId(this.manifest.projectId)});
        if(before.status!=='TRANSCRIBING'||!jobs.some(j=>this.records.get(id(j._id))==='processingjobs'&&j.status==='FAILED'&&j.errorMessage===failure.code&&same(j.sttEvidence,failure.evidence)))throw denied();
      }
      const Model=mongoose.models[MODELS[col]!];if(!Model)throw denied();await new Model(after).validate();return;
    }
    if(col==='projects'){
      if(after.sourceLanguageMode!==before.sourceLanguageMode)throw denied();
      if(this.selection? !['AUTO','MANUAL'].includes(String(after.sourceLanguageMode)):after.sourceLanguageMode!=='AUTO')throw denied();
      if(after.status!==before.status){const legal:Record<string,string[]>={Media:['DRAFT>UPLOADED'],STT:['UPLOADED>TRANSCRIBING','TRANSCRIBING>TRANSCRIBED'],Approval:['TRANSCRIBED>TRANSLATED'],TTS:['TRANSLATED>GENERATING_AUDIO',...(this.selection&&!this.assets.metadata('input').probe.hasVideo?['GENERATING_AUDIO>COMPLETED']:[])],Result:['GENERATING_AUDIO>PROCESSING_VIDEO','PROCESSING_VIDEO>COMPLETED']};if(!legal[ctx.name]?.includes(`${before.status}>${after.status}`))throw denied();if(after.status==='COMPLETED'&&ctx.name==='TTS'&&(!this.facts.has('TTS')||!ctx.session))throw denied();}
      if(ctx.name==='STT'&&this.facts.has('STT')){const f=row(this.facts.get('STT')),expected=resolveTranscribedLanguage(before as SourceLanguageState,f.languageDetection as LanguageDetection|undefined);if(after.status!=='TRANSCRIBED'||after.sourceLanguage!==expected.sourceLanguage||after.sourceLanguageStatus!==expected.sourceLanguageStatus||after.detectedSourceLanguage!==expected.detectedSourceLanguage)throw denied();}
      else if(after.sourceLanguage!==before.sourceLanguage&&ctx.name!=='Source')throw denied();
      if(ctx.name==='Source'){if(this.selection)this.selection.claimSource(after.sourceLanguage);if(after.sourceLanguage!==this.source()||after.sourceLanguageStatus!=='CONFIRMED'||after.detectedSourceLanguage!=null)throw denied();}
      if(ctx.name!=='Source'&&!(ctx.name==='STT'&&this.facts.has('STT'))&&['sourceLanguage','sourceLanguageStatus','detectedSourceLanguage'].some(k=>!same(before[k],after[k])))throw denied();
      if(after.targetOperation&&!before.targetOperation){if(this.projectLock.has(ctx.name))throw denied();if(this.selection&&ctx.name==='Translation')this.selection.claimTarget(row(after.targetOperation).targetLanguage);if(row(after.targetOperation).targetLanguage!==this.target())throw denied();this.projectLock.add(ctx.name);}
    }
    if(col==='processingjobs'&&(before.status!=='PROCESSING'||after.status!=='COMPLETED'))throw denied();
    if(col==='processingjobs'&&!same(before.sttEvidence,after.sttEvidence)){
      const fact=row(this.facts.get('STT')).evidence;
      if(ctx.name!=='STT'||after.status!=='COMPLETED'||!fact||row(fact).outcome!=='SUCCEEDED'||!same(fact,after.sttEvidence))throw denied();
    }
    if(col==='transcripts'){
      if(ctx.name==='Source'){if(this.selection)this.selection.claimSource(after.languageCode);if(before.revision!==1||after.revision!==2||after.languageCode!==this.source()||before.languageCode!=null||after.fullText!==before.fullText)throw denied();}
      else if(after.revision!==before.revision||after.fullText!==before.fullText||after.languageCode!==before.languageCode)throw denied();
    }
    if(col==='translations'||col==='narrations'){if(after.revision!==before.revision)throw denied();}
    if(col==='translationattempts'&&(before.ownerId!==this.manifest.ownerId||before.targetLanguage!==this.target()||after.quotaReserved!==before.quotaReserved||after.quotaDay!==before.quotaDay))throw denied();
    if(col==='translationattempts'){
      const phases=['PREPARING','METADATA_DISPATCHING','METADATA_RECEIVED','GENERATION_DISPATCHING','GENERATION_RECEIVED','SAVING'];
      if(after.phase!==before.phase&&phases.indexOf(String(after.phase))!==phases.indexOf(String(before.phase))+1)throw denied();
      if(after.state!==before.state&&!(before.state==='CLAIMED'&&before.phase==='SAVING'&&after.state==='DRAFT'))throw denied();
      if(after.draftJson!==before.draftJson){
        let draft:Data;try{draft=JSON.parse(String(after.draftJson));}catch{throw denied();}
        const {loadSource}=await import('./translation/group-translation.service.js');const source=await loadSource(this.manifest.projectId,ctx.session as mongoose.ClientSession|undefined);
        const groups=draft.groups as Data[];if(!Array.isArray(groups)||draft.ownerId!==this.manifest.ownerId||draft.projectId!==this.manifest.projectId||draft.targetLanguage!==this.target()||draft.sourceLanguage!==this.source()||draft.transcriptId!==source.transcriptId||draft.transcriptRevision!==source.transcriptRevision||draft.sourceRevision!==revision(source)||draft.outputDigest!==outputDigest(revision(source),this.target(),groups as never))throw denied();
        const plan=validatePlan(source,groups.map(g=>(g.sourceSegmentIds as unknown[]).map(id))),translated=this.facts.get('TRANSLATION') as Data[];
        if(!translated||translated.length!==groups.length||groups.some((g,i)=>g.groupId!==plan[i]!.groupId||g.groupId!==translated[i]!.groupId||g.translatedText!==translated[i]!.translatedText||g.sourceText!==plan[i]!.sourceText))throw denied();
      }
    }
    const Model=mongoose.models[MODELS[col]!];if(Model)await new Model(after).validate();
  }
  private async verifyStage(name:string){
    const project=await this.project();
    const required:Record<string,string>={Media:'media',STT:'transcripts',Source:'transcripts',Translation:'translationattempts',Approval:'translations',TTS:'narrations',Result:'results'};
    if(required[name]){const rows=await this.reads.many(required[name]!,{projectId:required[name]==='translationattempts'?this.manifest.projectId:new mongoose.mongo.ObjectId(this.manifest.projectId)});if(rows.length!==1)throw denied();
      const doc=rows[0]!;
      if(name==='STT'&&(!this.facts.has('STT')||!['NEEDS_CONFIRMATION','CONFIRMED'].includes(String(doc.sourceLanguageStatus))||project.status!=='TRANSCRIBED'))throw denied();
      if(name==='Source'&&(doc.languageCode!==this.source()||doc.revision!==2||project.sourceLanguageStatus!=='CONFIRMED'))throw denied();
      if(name==='Translation'&&(!this.facts.has('TRANSLATION')||doc.state!=='DRAFT'||doc.quotaReserved!==true))throw denied();
      if(name==='TTS'){this.assets.validateMetadata('audio',doc);if(this.selection&&!this.assets.metadata('input').probe.hasVideo&&project.status!=='COMPLETED')throw denied();}
      if(name==='Result'){this.assets.validateMetadata('video',doc);if(project.status!=='COMPLETED')throw denied();}
    }
  }
  private async remember(col:string,identity:unknown,ctx:Lease,expected?:Data){
    const actual=await this.reads.one(col,{_id:identity},ctx.session);if(!actual||expected&&!same(actual,expected))throw uncertain();
    this.records.set(id(identity),col);if(ctx.session)ctx.touched.set(col+':'+id(identity),{collection:col,id:identity,expected:cloneData(actual)});
  }
}

export type ActualPreparation={manifest:ActualManifest|string;reads:ActualReads;driver:Parameters<typeof installScopedWriteGuard>[0];journal:string;workspace:string;uploadRoot:string;tools:ActualTools;connect:()=>Promise<void>;authAllowed?:Parameters<typeof installScopedWriteGuard>[2]};
export async function prepareActualRun(input:ActualPreparation,optIn=false):Promise<ActualE2eRuntime|undefined>{
  if(!optIn)return;let installed=false;
  installScopedWriteGuard(input.driver,{write:async(db,c,m,a,w)=>{if(!installed)throw denied();return runtime.write(db,c,m,a,w);}},input.authAllowed);
  const m:ActualManifest=typeof input.manifest==='string'?JSON.parse(input.manifest):structuredClone(input.manifest);if(m.media)Object.freeze(m.media);Object.freeze(m);
  if(m.contract!==undefined&&m.contract!==MANUAL_RUN_CONTRACT)throw denied();
  if(!/^[a-zA-Z0-9_-]{8,64}$/.test(m.runId)||![m.ownerId,m.projectId,m.koreVoiceId].every(v=>/^[a-f0-9]{24}$/.test(v))||(m.contract===MANUAL_RUN_CONTRACT?m.media!==undefined:!m.media||!/^[a-f0-9]{64}$/.test(m.media.sha256)||!Number.isSafeInteger(m.media.bytes)||m.media.bytes<=0||m.media.bytes>200*1024*1024||m.media.duration!==53.591655))throw denied();
  const user=await input.reads.one('users',{_id:new mongoose.mongo.ObjectId(m.ownerId)}),voice=await input.reads.one('voices',{_id:new mongoose.mongo.ObjectId(m.koreVoiceId)});
  if(user?.role!=='CUSTOMER'||user.status!=='ACTIVE'||user.deletedAt!=null||voice?.provider!=='gemini'||voice.providerVoiceId!=='Kore'||voice.isActive!==true||await input.reads.one('projects',{_id:new mongoose.mongo.ObjectId(m.projectId)}))throw denied();
  const lang=await input.reads.one('languages',{_id:voice.languageId});if(lang?.code!=='en'||lang.isActive!==true)throw denied();
  const rel=relative(resolve(input.workspace),resolve(input.journal));if(!rel||isAbsolute(rel)||rel==='..'||rel.startsWith(`..${sep}`)||![`${m.runId}.jsonl`,`${m.runId}.native.jsonl`].includes(basename(input.journal))||lstatSync(dirname(input.journal)).isSymbolicLink()||realpathSync(dirname(input.journal))!==resolve(dirname(input.journal)))throw denied();
  const storageRel=relative(resolve(input.workspace),resolve(input.uploadRoot));if(!storageRel||isAbsolute(storageRel)||storageRel==='..'||storageRel.startsWith(`..${sep}`)||lstatSync(input.workspace).isSymbolicLink())throw denied();
  let cursor=resolve(input.workspace);for(const part of storageRel.split(sep)){cursor=resolve(cursor,part);try{const s=lstatSync(cursor);if(s.isSymbolicLink()||!s.isDirectory())throw denied();}catch(e){if(!(e&&typeof e==='object'&&'code'in e&&e.code==='ENOENT'))throw e;mkdirSync(cursor);}}if(realpathSync(input.uploadRoot)!==resolve(input.uploadRoot))throw denied();
  const lock=exclusiveWriteJournal(m.contract===MANUAL_RUN_CONTRACT?resolve(dirname(input.journal),m.runId+'.scope.lock'):resolve(input.uploadRoot,'.e2e-active.lock'));lock(`RUN_${m.runId}`); // No second run/automatic restart, even with a different runId.
  const record=exclusiveWriteJournal(input.journal);record(`ACTUAL_SCOPE_${digest(m)}`);const runtime=new ActualE2eRuntime(m,input.reads,record,input.workspace,input.uploadRoot,input.tools);installed=true;await runtime.initialize(input.connect);return runtime;
}
